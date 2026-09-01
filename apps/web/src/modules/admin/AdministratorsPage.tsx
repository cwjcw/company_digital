import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusOutlined } from "@ant-design/icons";
import { Avatar, Button, Form, Modal, Popconfirm, Select, Space, Tabs, Tag, Typography, message } from "antd";
import { api } from "../../api";
import { PageHeader } from "../../shared/legacy-ui";
import { KdosDataTable } from "../../shared/KdosDataTable";

type ModuleOption = { code: string; label: string };
type AdministratorGrant = { id: string; systemAdmin: boolean; moduleCodes: string[]; version: number };
type AdministratorUser = {
  id: string; username: string; displayName: string; employeeNo?: string | null;
  departmentPaths?: string[][]; enabled: boolean; grant: AdministratorGrant | null;
};
type AdministratorResponse = {
  modules: ModuleOption[];
  users: AdministratorUser[];
  capabilities: { canManageSystemAdministrators: boolean; canManageModuleAdministrators: boolean };
};
type Editor = { kind: "SYSTEM" | "MODULE"; sourceUserId?: string; userId?: string; moduleCodes: string[]; expectedVersion: number | null };

const { Text } = Typography;

export function AdministratorsPage() {
  const queryClient = useQueryClient();
  const administrators = useQuery({ queryKey: ["administrators"], queryFn: () => api<AdministratorResponse>("/admin/administrators"), staleTime: 0 });
  const [activeTab, setActiveTab] = useState("system");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const data = administrators.data;
  const systemAdministrators = useMemo(() => (data?.users ?? []).filter((user) => user.grant?.systemAdmin), [data?.users]);
  const moduleAdministrators = useMemo(() => (data?.users ?? []).filter((user) => user.grant && !user.grant.systemAdmin), [data?.users]);
  const moduleMap = useMemo(() => new Map((data?.modules ?? []).map((module) => [module.code, module.label])), [data?.modules]);
  const availableUsers = (data?.users ?? []).filter((user) => user.enabled && (!user.grant || user.id === editor?.sourceUserId));

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["administrators"] }, { throwOnError: true });
  const save = async () => {
    if (!editor?.userId || savingRef.current) return;
    if (editor.kind === "MODULE" && !editor.moduleCodes.length) { message.error("请至少选择一个管理模块"); return; }
    savingRef.current = true; setSaving(true);
    try {
      const sourceUserId = editor.sourceUserId ?? editor.userId;
      await api(`/admin/administrators/${sourceUserId}`, {
        method: "PUT",
        body: JSON.stringify({
          systemAdmin: editor.kind === "SYSTEM",
          moduleCodes: editor.kind === "MODULE" ? editor.moduleCodes : [],
          expectedVersion: editor.expectedVersion,
          targetUserId: editor.sourceUserId && editor.userId !== editor.sourceUserId ? editor.userId : undefined
        })
      });
      await refresh(); message.success("管理员已保存"); setEditor(null);
    } catch (error) { message.error(error instanceof Error ? error.message : "保存失败"); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const remove = async (user: AdministratorUser) => {
    try {
      await api(`/admin/administrators/${user.id}`, {
        method: "PUT",
        body: JSON.stringify({ systemAdmin: false, moduleCodes: [], expectedVersion: user.grant?.version ?? null })
      });
      await refresh(); message.success("管理员已删除");
    } catch (error) { message.error(error instanceof Error ? error.message : "删除失败"); }
  };
  const personColumn = {
    title: "账号", dataIndex: "displayName", render: (value: string, user: AdministratorUser) => <Space>
      <Avatar>{value.slice(0, 1)}</Avatar><span><Text strong>{value}</Text><br /><Text type="secondary">{user.username}</Text></span>
    </Space>
  };
  const departmentColumn = { title: "部门", dataIndex: "departmentPaths", render: (paths: string[][]) => (paths ?? []).map((path) => path.join(" / ")).join("、") || "—" };

  const systemColumns = [personColumn, departmentColumn, {
    title: "状态", width: 120, render: (_: unknown, user: AdministratorUser) => user.username.toLowerCase() === "admin" ? <Tag color="gold">默认账号</Tag> : <Tag color="red">系统管理员</Tag>
  }, {
    title: "操作", width: 150, render: (_: unknown, user: AdministratorUser) => data?.capabilities.canManageSystemAdministrators && user.username.toLowerCase() !== "admin" ? <Space>
      <Button type="link" onClick={() => setEditor({ kind: "SYSTEM", sourceUserId: user.id, userId: user.id, moduleCodes: [], expectedVersion: user.grant!.version })}>修改</Button>
      <Popconfirm title="删除该系统管理员？" onConfirm={() => void remove(user)}><Button type="link" danger>删除</Button></Popconfirm>
    </Space> : <Text type="secondary">仅查看</Text>
  }];
  const moduleColumns = [personColumn, departmentColumn, {
    title: "管理模块", render: (_: unknown, user: AdministratorUser) => <Space wrap>{user.grant?.moduleCodes.map((code) => <Tag color="blue" key={code}>{moduleMap.get(code) ?? code}</Tag>)}</Space>
  }, {
    title: "操作", width: 150, render: (_: unknown, user: AdministratorUser) => data?.capabilities.canManageModuleAdministrators ? <Space>
      <Button type="link" onClick={() => setEditor({ kind: "MODULE", sourceUserId: user.id, userId: user.id, moduleCodes: user.grant!.moduleCodes, expectedVersion: user.grant!.version })}>修改</Button>
      <Popconfirm title="删除该模块管理员？" onConfirm={() => void remove(user)}><Button type="link" danger>删除</Button></Popconfirm>
    </Space> : <Text type="secondary">仅查看</Text>
  }];

  return <div className="administrator-page">
    <PageHeader title="管理员" subtitle="系统管理员与模块管理员" />
    <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
      { key: "system", label: "系统管理员", children: <>
        <div className="administrator-toolbar">
          <Text type="secondary">只有 admin 账号可以添加、修改和删除系统管理员。</Text>
          {data?.capabilities.canManageSystemAdministrators && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ kind: "SYSTEM", moduleCodes: [], expectedVersion: null })}>添加系统管理员</Button>}
        </div>
        <KdosDataTable simple systemFields={false} pagination={false} resource="administrators" rowKey="id" loading={administrators.isLoading} dataSource={systemAdministrators} columns={systemColumns} />
      </> },
      { key: "module", label: "模块管理员", children: <>
        <div className="administrator-toolbar">
          <Text type="secondary">只有系统管理员可以添加、修改和删除模块管理员。</Text>
          {data?.capabilities.canManageModuleAdministrators && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditor({ kind: "MODULE", moduleCodes: [], expectedVersion: null })}>添加模块管理员</Button>}
        </div>
        <KdosDataTable simple systemFields={false} pagination={false} resource="administrators" rowKey="id" loading={administrators.isLoading} dataSource={moduleAdministrators} columns={moduleColumns} />
      </> }
    ]} />
    <Modal title={`${editor?.sourceUserId ? "修改" : "添加"}${editor?.kind === "SYSTEM" ? "系统管理员" : "模块管理员"}`} open={Boolean(editor)} confirmLoading={saving} okText="保存" onOk={() => void save()} onCancel={() => !saving && setEditor(null)} closable={!saving} maskClosable={!saving}>
      <Form layout="vertical">
        <Form.Item label="账号" required><Select showSearch optionFilterProp="label" value={editor?.userId} onChange={(userId) => setEditor((current) => current && ({ ...current, userId }))} options={availableUsers.map((user) => ({ value: user.id, label: `${user.displayName}（${user.username}）` }))} placeholder="请选择账号" /></Form.Item>
        {editor?.kind === "MODULE" && <Form.Item label="管理模块" required><Select mode="multiple" value={editor.moduleCodes} onChange={(moduleCodes) => setEditor((current) => current && ({ ...current, moduleCodes }))} options={(data?.modules ?? []).map((module) => ({ value: module.code, label: module.label }))} placeholder="请选择模块" /></Form.Item>}
      </Form>
    </Modal>
  </div>;
}
