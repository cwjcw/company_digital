import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Select, Space, Switch, Tag, Typography, message } from "antd";
import { api } from "../../api";
import { PageHeader } from "../../shared/legacy-ui";
import { KdosDataTable } from "../../shared/KdosDataTable";

type FlowConfig = {
  flowKey: string; name: string; enabled: boolean; allowDraft: boolean; allowWithdraw: boolean;
  returnMode: "ANY_PREVIOUS" | "PREVIOUS_ONLY"; rejectTargetMode: "DRAFT" | "PREVIOUS";
  approvalCommentRequired: boolean; adminRoleNames: string[]; nodeLabels: Record<string, string>;
  version: number; updatedAt: string; updatedBy: string;
};
type Role = { id: string; name: string };

const returnModeLabels = { ANY_PREVIOUS: "可退回任一前序环节", PREVIOUS_ONLY: "只能退回紧邻上一环节" };
const rejectTargetLabels = { DRAFT: "拒绝后回到创建草稿", PREVIOUS: "拒绝后回到紧邻上一环节" };

export function ApprovalFlowSettingsPage() {
  const currentUser = JSON.parse(localStorage.getItem("sessionUser") ?? "{}");
  const canManage = currentUser.isSystemAdmin === true || currentUser.moduleAdminCodes?.includes("workflow") || currentUser.roles?.includes("集团管理员");
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<FlowConfig>();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const flows = useQuery({ queryKey: ["approval-flow-configs"], queryFn: () => api<FlowConfig[]>("/approval-flow-configs"), enabled: canManage });
  const roles = useQuery({ queryKey: ["approval-flow-role-options"], queryFn: () => api<Role[]>("/approval-flow-configs/roles"), enabled: canManage });

  if (!canManage) return <Alert type="error" showIcon message="无权访问审批流程配置" description="仅系统管理员、流程审批模块管理员或集团管理员可以调整流程规则。" />;

  const openEdit = (flow: FlowConfig) => {
    setEditing(flow);
    form.setFieldsValue(flow);
  };
  const save = async () => {
    const values = await form.validateFields();
    if (!editing) return;
    setSaving(true);
    try {
      await api(`/approval-flow-configs/${editing.flowKey}`, { method: "PATCH", body: JSON.stringify(values) });
      message.success("流程配置已保存，新规则立即生效");
      setEditing(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["approval-flow-configs"] }),
        queryClient.invalidateQueries({ queryKey: ["development-flow-config"] }),
        queryClient.invalidateQueries({ queryKey: ["development-requests"] })
      ]);
    } catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };

  const columns = [
    { title: "流程名称", dataIndex: "name", render: (name: string, row: FlowConfig) => <Space><Typography.Text strong>{name}</Typography.Text><Typography.Text type="secondary">{row.flowKey}</Typography.Text></Space> },
    { title: "状态", dataIndex: "enabled", width: 90, render: (enabled: boolean) => <Tag color={enabled ? "green" : "default"}>{enabled ? "启用" : "停用"}</Tag> },
    { title: "表单能力", width: 190, render: (_: unknown, row: FlowConfig) => <Space><Tag color={row.allowDraft ? "blue" : "default"}>草稿{row.allowDraft ? "开启" : "关闭"}</Tag><Tag color={row.allowWithdraw ? "blue" : "default"}>撤回{row.allowWithdraw ? "开启" : "关闭"}</Tag></Space> },
    { title: "退回规则", dataIndex: "returnMode", render: (value: FlowConfig["returnMode"]) => returnModeLabels[value] },
    { title: "拒绝规则", dataIndex: "rejectTargetMode", render: (value: FlowConfig["rejectTargetMode"]) => rejectTargetLabels[value] },
    { title: "配置版本", dataIndex: "version", width: 90, render: (value: number) => `V${value}` },
    { title: "操作", width: 90, render: (_: unknown, row: FlowConfig) => <Button type="link" onClick={() => openEdit(row)}>配置</Button> }
  ];

  return <div>
    <PageHeader title="审批流程配置" subtitle="统一管理流程启停、表单能力、退回拒绝规则、处理角色和节点名称" />
    <Alert type="info" showIcon message="系统保护规则" description="退回和拒绝原因始终必填；配置页权限固定为系统管理员/集团管理员，避免误配置导致流程无法管理。流程停用只禁止新建，已有单据仍可继续处理。" style={{ marginBottom: 16 }} />
    <Card bordered={false}><KdosDataTable resource="approval-flow-configs" rowKey="flowKey" loading={flows.isLoading} dataSource={flows.data ?? []} columns={columns} pagination={false} /></Card>

    <Modal title={editing ? `配置流程 · ${editing.name}` : "配置流程"} width={760} open={Boolean(editing)} confirmLoading={saving} okText="保存并立即生效" onCancel={() => setEditing(undefined)} onOk={() => void save()}>
      <Form form={form} layout="vertical">
        <Descriptions size="small" bordered column={2} style={{ marginBottom: 20 }} items={[
          { key: "key", label: "流程标识", children: editing?.flowKey },
          { key: "version", label: "当前版本", children: `V${editing?.version ?? 1}` }
        ]} />
        <Space size={36} wrap style={{ marginBottom: 10 }}>
          <Form.Item name="enabled" label="流程启用" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item>
          <Form.Item name="allowDraft" label="允许保存草稿" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="allowWithdraw" label="允许后续未处理时撤回" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="approvalCommentRequired" label="通过时审批意见必填" valuePropName="checked"><Switch /></Form.Item>
        </Space>
        <Space size={16} align="start" style={{ width: "100%" }}>
          <Form.Item name="returnMode" label="退回范围" rules={[{ required: true }]} style={{ width: 330 }}><Select options={Object.entries(returnModeLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
          <Form.Item name="rejectTargetMode" label="拒绝去向" rules={[{ required: true }]} style={{ width: 330 }}><Select options={Object.entries(rejectTargetLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
        </Space>
        <Form.Item name="adminRoleNames" label="管理员处理节点可用角色" rules={[{ required: true, type: "array", min: 1, message: "至少选择一个角色" }]}><Select mode="multiple" showSearch optionFilterProp="label" options={(roles.data ?? []).map((role) => ({ value: role.name, label: role.name }))} /></Form.Item>
        <Card size="small" title="节点显示名称">
          {Object.entries(editing?.nodeLabels ?? {}).map(([key]) => <Form.Item key={key} name={["nodeLabels", key]} label={key} rules={[{ required: true, whitespace: true, max: 100 }]}><Input maxLength={100} /></Form.Item>)}
        </Card>
      </Form>
    </Modal>
  </div>;
}
