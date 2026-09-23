import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Modal, Select, Space, Tabs, Tag, Typography, message } from "antd";
import { EditOutlined, ReloadOutlined, SendOutlined } from "@ant-design/icons";
import { api } from "../../api";
import { KdosDataTable } from "../../shared/KdosDataTable";
import { PageHeader } from "../../shared/legacy-ui";

type Rule = { id: string; name: string; eventType: string; module: string; resource: string; resourceLabel: string; condition: string; recipientLabel: string; channelLabel: string; enabled: boolean; latestSendAt?: string | null; config?: { template?: string }; version: number };
type EventDefinition = { eventType: string; label: string; module: string; resource: string; resourceLabel: string; condition: string; channelLabel: string; recipientLabels: Record<string, string>; variables: string[] };
type Log = { id: string; sendTime: string; ruleName: string; module: string; resource: string; eventType: string; originalRecipient: string; actualRecipient: string; wechatUserId: string; status: string; retryCount: number; providerMessageId?: string | null; failureReason?: string | null; outboxId: string };

const statusLabel: Record<string, string> = { SENT: "已发送", FAILED: "失败", RETRY_PENDING: "待重试", SKIPPED_MISSING_WECHAT_ID: "缺少企业微信 UserId", SKIPPED_DISABLED: "用户已禁用", SKIPPED: "已跳过", PENDING: "待发送", PROCESSING: "处理中" };
const statusColor: Record<string, string> = { SENT: "success", FAILED: "error", RETRY_PENDING: "warning", SKIPPED_MISSING_WECHAT_ID: "warning", SKIPPED_DISABLED: "default", PENDING: "processing", PROCESSING: "processing" };
const formatTime = (value?: string | null) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";

export function NotificationCenterPage() {
  const queryClient = useQueryClient(); const [activeTab, setActiveTab] = useState("rules");
  const events = useQuery({ queryKey: ["notification-events"], queryFn: () => api<EventDefinition[]>("/notifications/events"), staleTime: 300_000 });
  const [module, setModule] = useState(""); const [resource, setResource] = useState(""); const [status, setStatus] = useState(""); const [eventType, setEventType] = useState("");
  const ruleQuery = `/notifications/rules?${new URLSearchParams(Object.fromEntries(Object.entries({ module, resource, status, eventType }).filter(([, value]) => value))).toString()}`;
  const rules = useQuery({ queryKey: ["notification-rules", module, resource, status, eventType], queryFn: () => api<Rule[]>(ruleQuery) });
  const [logRuleId, setLogRuleId] = useState(""); const [logStatus, setLogStatus] = useState(""); const [logResource, setLogResource] = useState(""); const [logRecipient, setLogRecipient] = useState(""); const [logFrom, setLogFrom] = useState(""); const [logTo, setLogTo] = useState("");
  const logQuery = new URLSearchParams(Object.fromEntries(Object.entries({ ruleId: logRuleId, status: logStatus, resource: logResource, recipient: logRecipient, from: logFrom, to: logTo }).filter(([, value]) => value))).toString();
  const logs = useQuery({ queryKey: ["notification-logs", activeTab, logQuery], queryFn: () => api<Log[]>(`${activeTab === "failures" ? "/notifications/failures" : "/notifications/delivery-logs"}${logQuery ? `?${logQuery}` : ""}`), enabled: activeTab !== "rules" });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["notification-rules"] }); void queryClient.invalidateQueries({ queryKey: ["notification-logs"] }); };
  const [editor, setEditor] = useState<Rule | null | undefined>(undefined); const [testRule, setTestRule] = useState<Rule>();
  const openEditor = (rule?: Rule) => setEditor(rule ?? null);
  const saveRule = async (values: { name: string; eventType: string; template?: string }) => {
    try {
      const selected = events.data?.find((item) => item.eventType === values.eventType); if (!selected) throw new Error("请选择已注册的通知事件");
      await api(editor ? `/notifications/rules/${editor.id}` : "/notifications/rules", { method: editor ? "PATCH" : "POST", body: JSON.stringify({ name: values.name, eventType: values.eventType, resource: selected.resource, template: values.template, expectedVersion: editor?.version }) });
      message.success(editor ? "消息规则已保存" : "消息规则已创建"); setEditor(undefined); refresh();
    } catch (error) { message.error((error as Error).message); }
  };
  const toggle = async (rule: Rule) => { try { await api(`/notifications/rules/${rule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !rule.enabled, expectedVersion: rule.version }) }); message.success(rule.enabled ? "规则已停用" : "规则已启用"); refresh(); } catch (error) { message.error((error as Error).message); } };
  const retry = async (row: Log) => { try { await api(`/notifications/outbox/${row.outboxId}/retry`, { method: "POST" }); message.success("通知已重新进入待发送队列"); refresh(); } catch (error) { message.error((error as Error).message); } };
  const ruleColumns = [
    { title: "规则名称", dataIndex: "name", width: 180 }, { title: "模块", dataIndex: "module", width: 100 }, { title: "资源/数据表", dataIndex: "resourceLabel", width: 150 },
    { title: "事件", dataIndex: "eventType", width: 240 }, { title: "触发条件", dataIndex: "condition", width: 270 }, { title: "接收人", dataIndex: "recipientLabel", width: 110 }, { title: "渠道", dataIndex: "channelLabel", width: 150 },
    { title: "状态", dataIndex: "enabled", width: 80, render: (value: boolean) => <Tag color={value ? "success" : "default"}>{value ? "启用" : "停用"}</Tag> }, { title: "最近发送", dataIndex: "latestSendAt", width: 160, render: formatTime },
    { title: "操作", key: "actions", fixed: "right" as const, width: 270, render: (_: unknown, row: Rule) => <Space><Button type="link" icon={<EditOutlined />} onClick={() => openEditor(row)}>编辑</Button><Button type="link" onClick={() => void toggle(row)}>{row.enabled ? "停用" : "启用"}</Button><Button type="link" onClick={() => { setLogRuleId(row.id); setActiveTab("logs"); }}>查看日志</Button><Button type="link" icon={<SendOutlined />} onClick={() => setTestRule(row)}>测试</Button></Space> }
  ];
  const logColumns = [
    { title: "发送时间", dataIndex: "sendTime", width: 170, render: formatTime }, { title: "规则", dataIndex: "ruleName", width: 160 }, { title: "模块", dataIndex: "module", width: 90 }, { title: "资源/数据表", dataIndex: "resource", width: 160 }, { title: "事件", dataIndex: "eventType", width: 230 },
    { title: "原始接收人", dataIndex: "originalRecipient", width: 110 }, { title: "实际接收人", dataIndex: "actualRecipient", width: 150 }, { title: "企业微信 UserId", dataIndex: "wechatUserId", width: 150 }, { title: "状态", dataIndex: "status", width: 150, render: (value: string) => <Tag color={statusColor[value]}>{statusLabel[value] ?? value}</Tag> }, { title: "重试次数", dataIndex: "retryCount", width: 90 }, { title: "Provider 消息 ID", dataIndex: "providerMessageId", width: 160, render: (value: string | null) => value || "—" }, { title: "失败原因", dataIndex: "failureReason", width: 220, render: (value: string | null, row: Log) => value || (row.status === "SKIPPED_MISSING_WECHAT_ID" ? "请先补充企业微信 UserId" : row.status === "SKIPPED_DISABLED" ? "该用户当前处于禁用状态" : "—") },
    ...(activeTab === "failures" ? [{ title: "操作", key: "actions", width: 100, render: (_: unknown, row: Log) => ["FAILED", "RETRY_PENDING"].includes(row.status) ? <Button type="link" onClick={() => void retry(row)}>重试</Button> : null }] : [])
  ];
  const eventOptions = (events.data ?? []).map((item) => ({ value: item.eventType, label: `${item.label}（${item.eventType}）` }));
  return <div className="notification-center-page">
    <PageHeader title="消息中心" subtitle="统一管理已注册的实时通知规则、发送记录和失败消息" actions={<Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>} />
    <Alert type="warning" showIcon message="当前处于企业微信测试模式，实际企业微信消息仅发送给崔玮杰。" style={{ marginBottom: 16 }} />
    <Tabs activeKey={activeTab} onChange={setActiveTab} items={[{ key: "rules", label: "消息规则" }, { key: "logs", label: "发送记录" }, { key: "failures", label: "失败消息" }]} />
    {activeTab === "rules" ? <>
      <Space wrap style={{ marginBottom: 16 }}><Select allowClear placeholder="模块" value={module || undefined} onChange={(value) => setModule(value ?? "")} options={[{ value: "planning", label: "PMC中心" }]} style={{ width: 150 }} /><Select allowClear placeholder="资源/数据表" value={resource || undefined} onChange={(value) => setResource(value ?? "")} options={[...new Map((events.data ?? []).map((item) => [item.resource, { value: item.resource, label: item.resourceLabel }])).values()]} style={{ width: 190 }} /><Select allowClear placeholder="事件" value={eventType || undefined} onChange={(value) => setEventType(value ?? "")} options={eventOptions} style={{ width: 300 }} /><Select allowClear placeholder="状态" value={status || undefined} onChange={(value) => setStatus(value ?? "")} options={[{ value: "enabled", label: "启用" }, { value: "disabled", label: "停用" }]} style={{ width: 130 }} /><Button type="primary" onClick={() => openEditor()}>新增规则</Button></Space>
      {!events.isLoading && !events.data?.length && <Alert type="info" showIcon message="当前数据表暂未注册可用的实时通知事件。" />}
      {events.data?.length ? <Alert type="info" showIcon message={<span>已注册事件：{events.data.map((item) => `${item.resourceLabel} / ${item.eventType}`).join("、")}</span>} style={{ marginBottom: 16 }} /> : null}
      <KdosDataTable simple resource="notification-rules" rowKey="id" loading={rules.isLoading} dataSource={rules.data ?? []} columns={ruleColumns} scroll={{ x: 1700 }} pagination={{ pageSize: 20 }} />
    </> : <><Space wrap style={{ marginBottom: 16 }}><Select allowClear placeholder="规则" value={logRuleId || undefined} onChange={(value) => setLogRuleId(value ?? "")} options={(rules.data ?? []).map((item) => ({ value: item.id, label: item.name }))} style={{ width: 180 }} /><Select allowClear placeholder="状态" value={logStatus || undefined} onChange={(value) => setLogStatus(value ?? "")} options={Object.entries(statusLabel).map(([value, label]) => ({ value, label }))} style={{ width: 150 }} /><Input allowClear placeholder="资源/数据表" value={logResource} onChange={(event) => setLogResource(event.target.value)} style={{ width: 180 }} /><Input allowClear placeholder="接收人/UserId" value={logRecipient} onChange={(event) => setLogRecipient(event.target.value)} style={{ width: 180 }} /><Input type="date" value={logFrom} onChange={(event) => setLogFrom(event.target.value)} style={{ width: 150 }} /><Input type="date" value={logTo} onChange={(event) => setLogTo(event.target.value)} style={{ width: 150 }} /></Space><KdosDataTable simple resource="notification-delivery-logs" rowKey="id" loading={logs.isLoading} dataSource={logs.data ?? []} columns={logColumns} scroll={{ x: 2300 }} pagination={{ pageSize: 20 }} /></>}
    <RuleModal rule={editor} events={events.data ?? []} onCancel={() => setEditor(undefined)} onSave={saveRule} />
    <TestModal rule={testRule} onCancel={() => setTestRule(undefined)} />
  </div>;
}

function RuleModal({ rule, events, onCancel, onSave }: { rule: Rule | null | undefined; events: EventDefinition[]; onCancel: () => void; onSave: (values: { name: string; eventType: string; template?: string }) => Promise<void> }) {
  const [form] = Form.useForm(); const selectedEventType = Form.useWatch("eventType", form); const selectedEvent = events.find((item) => item.eventType === selectedEventType);
  if (rule === undefined) return null;
  return <Modal title={rule ? "编辑消息规则" : "新增消息规则"} open onCancel={onCancel} onOk={() => void form.validateFields().then(onSave)} okText="保存" width={760} destroyOnHidden>
    <Form form={form} layout="vertical" initialValues={{ name: rule?.name, eventType: rule?.eventType, template: rule?.config?.template }}>
      <Form.Item name="name" label="规则名称" rules={[{ required: true, message: "请输入规则名称" }]}><Input /></Form.Item>
      <Form.Item name="eventType" label="实时通知事件" rules={[{ required: true, message: "请选择已注册事件" }]}><Select options={events.map((item) => ({ value: item.eventType, label: `${item.label}（${item.eventType}）` }))} /></Form.Item>
      <Form.Item label="模块 / 资源"><Input value={selectedEvent ? `${selectedEvent.module} / ${selectedEvent.resourceLabel}` : rule ? `${rule.module} / ${rule.resourceLabel}` : "请选择事件"} disabled /></Form.Item>
      <Form.Item label="接收人 / 渠道"><Input value="设备责任人 / 企业微信工作通知" disabled /></Form.Item>
      <Form.Item name="template" label="消息模板" extra="仅允许使用服务端提供的 {{变量名}}，不支持 JavaScript、SQL 或表达式。"><Input.TextArea autoSize={{ minRows: 5, maxRows: 12 }} placeholder="例如：设备 {{equipmentCode}} 故障时长从 {{oldFaultMinutes}} 变为 {{newFaultMinutes}} 分钟" /></Form.Item>
      {selectedEvent && <Typography.Text type="secondary">可用变量：{selectedEvent.variables.map((item) => `{{${item}}}`).join("、")}</Typography.Text>}
    </Form>
  </Modal>;
}

function TestModal({ rule, onCancel }: { rule?: Rule; onCancel: () => void }) {
  const [payload, setPayload] = useState(`{\n  "equipmentId": "",\n  "equipmentCode": "",\n  "equipmentName": "",\n  "divisionName": "",\n  "oldFaultMinutes": 0,\n  "newFaultMinutes": 60,\n  "faultReason": "",\n  "actorName": "",\n  "occurredAt": ""\n}`); const [loading, setLoading] = useState(false);
  if (!rule) return null;
  const send = async () => { try { const parsed = JSON.parse(payload); setLoading(true); await api(`/notifications/rules/${rule.id}/test`, { method: "POST", body: JSON.stringify({ payload: parsed }) }); message.success("测试通知已进入发送队列"); onCancel(); } catch (error) { message.error((error as Error).message); } finally { setLoading(false); } };
  return <Modal title={`测试消息：${rule.name}`} open onCancel={onCancel} onOk={() => void send()} confirmLoading={loading} okText="发送测试消息"><Alert type="warning" showIcon message="当前处于企业微信测试模式，实际企业微信消息仅发送给崔玮杰。" style={{ marginBottom: 12 }} /><Input.TextArea value={payload} onChange={(event) => setPayload(event.target.value)} autoSize={{ minRows: 12, maxRows: 20 }} /></Modal>;
}
