import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  presetPermissionGroupTypes, presetTablePermissionDataScope, presetTablePermissionMatrix,
  tablePermissionActions, tableResourceRegistry, type PresetPermissionGroupType, type TablePermissionAction
} from "@kdos/contracts";
import {
  ArrowLeftOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SafetyCertificateOutlined,
  TeamOutlined
} from "@ant-design/icons";
import { Button, Card, Checkbox, Empty, Flex, Form, Modal, Select, Space, Tag, Typography, message } from "antd";
import { api } from "../../api";
import { PageHeader } from "../../shared/legacy-ui";

const { Paragraph, Text, Title } = Typography;

type PermissionRecord = Record<string, unknown> & {
  resource: string; fieldKey: string; read: boolean; create: boolean; copy: boolean; update: boolean;
  delete: boolean; batchPrint: boolean; batchUpdate: boolean; import: boolean; export: boolean;
};
type RoleRecord = {
  id: string; name: string; description?: string | null; permissions: PermissionRecord[];
  userIds: string[]; organizationUnitIds: string[];
};

const actionField: Record<TablePermissionAction, keyof PermissionRecord> = {
  read: "read", create: "create", copy: "copy", update: "update", delete: "delete",
  batch_print: "batchPrint", batch_update: "batchUpdate", import: "import", export: "export"
};
const actionLabel: Record<TablePermissionAction, string> = {
  read: "查看", create: "添加", copy: "复制", update: "编辑", delete: "删除",
  batch_print: "批量打印", batch_update: "批量修改", import: "导入", export: "导出"
};
const presetLabel: Record<PresetPermissionGroupType, string> = {
  ADD_ONLY: "仅添加数据", ADD_MANAGE_OWN: "添加并管理本人数据", ADD_VIEW_ALL: "添加并查看全部数据",
  MANAGE_ALL: "管理全部数据", VIEW_ALL: "查看全部数据"
};
const scopeLabel = { NONE: "仅提交，不进入数据管理页", OWN: "本人创建的数据", ALL: "当前表单全部数据" } as const;

function permissionFromActions(resource: string, actions: TablePermissionAction[]): PermissionRecord {
  const enabled = new Set(actions);
  return {
    resource, fieldKey: "*", read: enabled.has("read"), create: enabled.has("create"), copy: enabled.has("copy"),
    update: enabled.has("update"), delete: enabled.has("delete"), batchPrint: enabled.has("batch_print"),
    batchUpdate: enabled.has("batch_update"), import: enabled.has("import"), export: enabled.has("export")
  };
}

function actionsFromPermission(permission: PermissionRecord) {
  return tablePermissionActions.filter((action) => Boolean(permission[actionField[action]]));
}

function actionsFromPreset(type: PresetPermissionGroupType) {
  return tablePermissionActions.filter((action) => presetTablePermissionMatrix[type][action]);
}

function matchingPreset(permission: PermissionRecord) {
  return presetPermissionGroupTypes.find((type) => tablePermissionActions.every((action) =>
    Boolean(permission[actionField[action]]) === presetTablePermissionMatrix[type][action]
  ));
}

function safeReturnPath() {
  const value = new URLSearchParams(window.location.search).get("from");
  return value?.startsWith("/") && !value.startsWith("/permissions/") ? value : "/";
}

export function TablePermissionsPage({ resourceCode }: { resourceCode: string }) {
  const queryClient = useQueryClient();
  const resource = tableResourceRegistry.find((entry) => entry.code === resourceCode);
  const roles = useQuery({ queryKey: ["admin-roles"], queryFn: () => api<RoleRecord[]>("/admin/roles"), enabled: Boolean(resource) });
  const users = useQuery({ queryKey: ["admin-users", "permission-page"], queryFn: () => api<any[]>("/admin/users"), enabled: Boolean(resource) });
  const organizations = useQuery({ queryKey: ["organization-units"], queryFn: () => api<any[]>("/admin/organization-units"), enabled: Boolean(resource) });
  const [editing, setEditing] = useState<{ role?: RoleRecord; permission?: PermissionRecord }>();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const selectedPreset = Form.useWatch<PresetPermissionGroupType | "CUSTOM">("preset", form);

  const configured = useMemo(() => (roles.data ?? []).flatMap((role) => {
    const permission = role.permissions?.find((entry) => entry.resource === resourceCode && entry.fieldKey === "*");
    return permission ? [{ role, permission }] : [];
  }), [resourceCode, roles.data]);
  const inherited = useMemo(() => (roles.data ?? []).flatMap((role) => {
    const permission = role.permissions?.find((entry) => entry.resource === "*" && entry.fieldKey === "*");
    return permission ? [{ role, permission }] : [];
  }), [roles.data]);
  const userMap = useMemo(() => new Map((users.data ?? []).map((user) => [user.id, user])), [users.data]);
  const organizationMap = useMemo(() => new Map((organizations.data ?? []).map((unit) => [unit.id, unit.name])), [organizations.data]);

  if (!resource) return <Card><Empty description={`未知表单资源：${resourceCode}`} /><Button href={safeReturnPath()}>返回</Button></Card>;

  const openCreate = () => {
    setEditing({});
    form.resetFields();
    form.setFieldsValue({ preset: "VIEW_ALL", actions: actionsFromPreset("VIEW_ALL"), userIds: [], organizationUnitIds: [] });
  };
  const openEdit = (role: RoleRecord, permission: PermissionRecord) => {
    const preset = matchingPreset(permission) ?? "CUSTOM";
    setEditing({ role, permission });
    form.setFieldsValue({ roleId: role.id, preset, actions: actionsFromPermission(permission), userIds: role.userIds ?? [], organizationUnitIds: role.organizationUnitIds ?? [] });
  };
  const applyPreset = (type: PresetPermissionGroupType | "CUSTOM") => {
    if (type !== "CUSTOM") form.setFieldValue("actions", actionsFromPreset(type));
  };
  const save = async () => {
    try {
      const values = await form.validateFields();
      const role = editing?.role ?? roles.data?.find((entry) => entry.id === values.roleId);
      if (!role) throw new Error("请选择需要授权的角色");
      const actions = values.actions as TablePermissionAction[];
      const dependentActions: TablePermissionAction[] = ["copy", "update", "delete", "batch_update", "export"];
      if (!actions.includes("read") && dependentActions.some((action) => actions.includes(action))) throw new Error("复制、编辑、删除、批量修改和导出必须同时拥有查看权限");
      const nextPermission = permissionFromActions(resourceCode, actions);
      const permissions = [...(role.permissions ?? []).filter((entry) => !(entry.resource === resourceCode && entry.fieldKey === "*")), nextPermission];
      setSaving(true);
      await api(`/admin/roles/${role.id}`, { method: "PATCH", body: JSON.stringify({
        permissions, userIds: values.userIds ?? role.userIds ?? [], organizationUnitIds: values.organizationUnitIds ?? role.organizationUnitIds ?? []
      }) });
      message.success(`${resource.label}权限组已保存`);
      setEditing(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-roles"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-users"] })
      ]);
    } catch (error) {
      if (!(error && typeof error === "object" && "errorFields" in error)) message.error((error as Error).message);
    } finally { setSaving(false); }
  };
  const remove = (role: RoleRecord) => Modal.confirm({
    title: `移除“${role.name}”对${resource.label}的权限？`,
    content: "只移除当前表单权限，不会删除角色，也不会影响该角色在其他表单中的权限。",
    okText: "移除", okButtonProps: { danger: true },
    onOk: async () => {
      await api(`/admin/roles/${role.id}`, { method: "PATCH", body: JSON.stringify({
        permissions: (role.permissions ?? []).filter((entry) => !(entry.resource === resourceCode && entry.fieldKey === "*"))
      }) });
      message.success("当前表单权限已移除");
      await queryClient.invalidateQueries({ queryKey: ["admin-roles"] });
    }
  });

  return <div className="table-permissions-page">
    <PageHeader title={`${resource.label} · 权限管理`} subtitle={`${resource.module} / ${resource.label}；本页配置只作用于当前表单`} actions={<Space>
      <Button href={safeReturnPath()} icon={<ArrowLeftOutlined />}>返回原表</Button>
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加权限组</Button>
    </Space>} />
    <div className="permission-page-guidance"><SafetyCertificateOutlined /><div><Text strong>权限入口位置</Text><Paragraph>固定放在表格顶部工具栏最右侧，紧邻“字段显示”。权限修改由服务端保存并在重新登录后进入授权令牌；前端按钮不是授权边界。</Paragraph></div></div>
    {inherited.length > 0 && <section className="permission-section"><Title level={5}>系统继承权限</Title><div className="permission-card-grid">
      {inherited.map(({ role, permission }) => <Card key={role.id} className="permission-group-card inherited" title={role.name} extra={<Tag color="gold">全局继承</Tag>}>
        <Paragraph type="secondary">该角色拥有全局权限，不能在单张表内覆盖。</Paragraph>
        <Space wrap>{actionsFromPermission(permission).map((action) => <Tag key={action}>{actionLabel[action]}</Tag>)}</Space>
      </Card>)}
    </div></section>}
    <section className="permission-section"><Flex justify="space-between" align="center"><Title level={5}>当前表单权限组</Title><Text type="secondary">共 {configured.length} 组</Text></Flex>
      {configured.length ? <div className="permission-card-grid">{configured.map(({ role, permission }) => {
        const preset = matchingPreset(permission);
        const roleUsers = (role.userIds ?? []).map((id) => userMap.get(id)).filter(Boolean);
        return <Card key={role.id} className="permission-group-card" title={role.name} extra={<Space><Tag color={preset ? "blue" : "purple"}>{preset ? presetLabel[preset] : "自定义权限"}</Tag><Button type="text" icon={<EditOutlined />} aria-label={`编辑权限组-${role.name}`} onClick={() => openEdit(role, permission)} /><Button danger type="text" icon={<DeleteOutlined />} aria-label={`移除权限组-${role.name}`} onClick={() => remove(role)} /></Space>}>
          <Paragraph type="secondary">数据范围：{preset ? scopeLabel[presetTablePermissionDataScope[preset]] : "按角色现有服务端数据范围"}</Paragraph>
          <div className="permission-card-row"><Text strong>操作权限</Text><Space wrap>{actionsFromPermission(permission).map((action) => <Tag key={action} color="cyan">{actionLabel[action]}</Tag>)}</Space></div>
          <div className="permission-card-row"><Text strong>授权角色</Text><Tag color="geekblue">{role.name}</Tag></div>
          <div className="permission-card-row"><Text strong>授权成员</Text><Space wrap>{roleUsers.length ? roleUsers.slice(0, 8).map((user: any) => <Tag key={user.id} icon={<TeamOutlined />}>{user.displayName}</Tag>) : <Text type="secondary">未直接添加成员</Text>}{roleUsers.length > 8 && <Tag>+{roleUsers.length - 8}</Tag>}</Space></div>
          <div className="permission-card-row"><Text strong>授权部门</Text><Space wrap>{role.organizationUnitIds?.length ? role.organizationUnitIds.map((id) => <Tag key={id}>{organizationMap.get(id) ?? id}</Tag>) : <Text type="secondary">未添加部门</Text>}</Space></div>
        </Card>;
      })}</div> : <Card><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前表单还没有独立权限组"><Button type="primary" onClick={openCreate}>添加第一个权限组</Button></Empty></Card>}
    </section>

    <Modal width={760} title={editing?.role ? `编辑权限组：${editing.role.name}` : `为${resource.label}添加权限组`} open={Boolean(editing)} confirmLoading={saving} onCancel={() => setEditing(undefined)} onOk={() => void save()} destroyOnHidden>
      <Form form={form} layout="vertical">
        {!editing?.role && <Form.Item name="roleId" label="授权角色" rules={[{ required: true, message: "请选择角色" }]}><Select showSearch optionFilterProp="label" placeholder="选择一个角色作为权限组" options={(roles.data ?? []).filter((role) => !configured.some((entry) => entry.role.id === role.id)).map((role) => ({ value: role.id, label: role.name }))} /></Form.Item>}
        <Form.Item name="preset" label="权限模板" rules={[{ required: true }]}><Select onChange={applyPreset} options={[...presetPermissionGroupTypes.map((type) => ({ value: type, label: `${presetLabel[type]} · ${scopeLabel[presetTablePermissionDataScope[type]]}` })), { value: "CUSTOM", label: "自定义权限" }]} /></Form.Item>
        <Form.Item name="actions" label="操作权限" rules={[{ required: true, message: "至少选择一项操作权限" }]}>
          <Checkbox.Group disabled={selectedPreset !== "CUSTOM"} options={tablePermissionActions.map((action) => ({ value: action, label: actionLabel[action] }))} />
        </Form.Item>
        <Text type="secondary">系统预置模板的操作矩阵固定且全部禁止导入；选择“自定义权限”后才可调整操作项。批量打印仅保留权限定义，业务工具栏不显示打印入口。</Text>
        <Form.Item name="userIds" label="直接授权成员" style={{ marginTop: 18 }}><Select mode="multiple" showSearch optionFilterProp="label" placeholder="可选；成员使用稳定ID保存" options={(users.data ?? []).filter((user) => user.enabled).map((user) => ({ value: user.id, label: `${user.displayName}（${user.employeeNo ?? user.username}）` }))} /></Form.Item>
        <Form.Item name="organizationUnitIds" label="授权部门"><Select mode="multiple" showSearch optionFilterProp="label" placeholder="可选；部门成员关系动态生效" options={(organizations.data ?? []).filter((unit) => unit.enabled).map((unit) => ({ value: unit.id, label: unit.name }))} /></Form.Item>
      </Form>
    </Modal>
  </div>;
}
