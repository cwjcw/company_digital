import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Card, DatePicker, Descriptions, Drawer, Empty, Flex, Form, Input,
  InputNumber, Modal, Select, Space, Statistic, Steps, Table, Tag, Timeline, Typography, message
} from "antd";
import dayjs from "dayjs";
import { api } from "../../api";
import { PageHeader } from "../../shared/legacy-ui";

const { Text, Paragraph } = Typography;

type Action = "EDIT_DRAFT" | "SUBMIT" | "WITHDRAW" | "RETURN" | "REQUESTER_APPROVE" | "ASSIGN" | "SUBMIT_PLAN" | "HANDLER_APPROVE";
type Person = { id: string; username: string; displayName: string; employeeNo?: string | null; position?: string | null; departmentPaths?: string[][]; managerIds: string[] };
type RequestRow = {
  id: string; requestNumber: string; title: string | null; category: string | null; description: string | null; businessValue?: string | null;
  urgency: string; desiredDate?: string | null; status: string; requesterId: string; requesterName: string;
  requesterManagerId?: string | null; requesterManagerName: string; handlerId?: string | null; handlerName?: string | null;
  handlerManagerId?: string | null; handlerManagerName?: string | null; requiredResources?: string | null;
  estimatedWorkdays?: string | null; plannedCompletionDate?: string | null; createdAt: string; updatedAt: string;
  availableActions: Action[]; returnTargets: Array<{ status: string; label: string }>;
  events?: Array<{ id: string; action: string; actorName: string; comment?: string | null; toStatus: string; createdAt: string }>;
};

const statusMeta: Record<string, { label: string; color: string; step: number }> = {
  DRAFT: { label: "草稿", color: "default", step: 0 },
  PENDING_REQUESTER_APPROVAL: { label: "待填写人上级审批", color: "gold", step: 1 },
  PENDING_ADMIN_ASSIGNMENT: { label: "待管理员分配", color: "blue", step: 2 },
  PENDING_HANDLER_PLAN: { label: "待处理人评估", color: "cyan", step: 3 },
  PENDING_HANDLER_MANAGER_APPROVAL: { label: "待处理人上级审批", color: "purple", step: 4 },
  APPROVED_FOR_DEVELOPMENT: { label: "已批准开发", color: "green", step: 5 }
};
const actionLabels: Record<Action, string> = {
  EDIT_DRAFT: "编辑草稿", SUBMIT: "提交审批", WITHDRAW: "撤回", RETURN: "退回前序环节",
  REQUESTER_APPROVE: "上级通过", ASSIGN: "分配处理人", SUBMIT_PLAN: "填写资源与工期", HANDLER_APPROVE: "开发审批通过"
};
const eventLabels: Record<string, string> = {
  SAVE_DRAFT: "保存需求草稿", SUBMIT: "填写人提交需求", RESUBMIT: "填写人修改后重提",
  WITHDRAW: "提交人撤回", RETURN: "当前处理人退回前序环节", REQUESTER_APPROVE: "填写人上级审批通过",
  ASSIGN: "管理员分配处理人员", SUBMIT_PLAN: "处理人提交资源与工期", HANDLER_APPROVE: "处理人上级审批通过"
};
const urgencyMeta: Record<string, { label: string; color: string }> = {
  LOW: { label: "低", color: "default" }, NORMAL: { label: "普通", color: "blue" }, HIGH: { label: "高", color: "orange" }, URGENT: { label: "紧急", color: "red" }
};

function personLabel(person: Person) {
  const department = person.departmentPaths?.[0]?.slice(-2).join(" / ");
  return `${person.displayName}（${person.employeeNo ?? person.username}${person.position ? ` · ${person.position}` : ""}${department ? ` · ${department}` : ""}）`;
}

export function DevelopmentRequestsPage() {
  const queryClient = useQueryClient();
  const currentUser = JSON.parse(localStorage.getItem("sessionUser") ?? "{}");
  const [scope, setScope] = useState("all");
  const [search, setSearch] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const [editingDraft, setEditingDraft] = useState<RequestRow>();
  const [detailId, setDetailId] = useState<string>();
  const [decision, setDecision] = useState<{ row: RequestRow; action: "REQUESTER_APPROVE" | "HANDLER_APPROVE" }>();
  const [assigning, setAssigning] = useState<RequestRow>();
  const [planning, setPlanning] = useState<RequestRow>();
  const [movement, setMovement] = useState<{ row: RequestRow; action: "WITHDRAW" | "RETURN" }>();
  const [saving, setSaving] = useState(false);
  const [requestForm] = Form.useForm();
  const [decisionForm] = Form.useForm();
  const [assignForm] = Form.useForm();
  const [planForm] = Form.useForm();
  const [movementForm] = Form.useForm();
  const people = useQuery({ queryKey: ["development-people"], queryFn: () => api<Person[]>("/development-requests/people") });
  const requests = useQuery({ queryKey: ["development-requests", scope, search], queryFn: () => api<RequestRow[]>(`/development-requests?scope=${scope}&search=${encodeURIComponent(search)}`) });
  const detail = useQuery({ queryKey: ["development-request", detailId], queryFn: () => api<RequestRow>(`/development-requests/${detailId}`), enabled: Boolean(detailId) });
  const rows = useMemo(() => requests.data ?? [], [requests.data]);
  const personOptions = (people.data ?? []).map((person) => ({ value: person.id, label: personLabel(person) }));

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["development-requests"] });
    if (detailId) await queryClient.invalidateQueries({ queryKey: ["development-request", detailId] });
  };
  const submit = async (path: string, body: unknown, success: string, method = "POST") => {
    setSaving(true);
    try {
      await api(path, { method, body: JSON.stringify(body) });
      message.success(success);
      setDecision(undefined); setAssigning(undefined); setPlanning(undefined); setMovement(undefined); setRequestOpen(false); setEditingDraft(undefined);
      decisionForm.resetFields(); assignForm.resetFields(); planForm.resetFields(); movementForm.resetFields(); requestForm.resetFields();
      await refresh();
    } catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };
  const requestPayload = (values: any, submitForApproval: boolean) => ({
    ...values, submit: submitForApproval, desiredDate: values.desiredDate?.format?.("YYYY-MM-DD") ?? values.desiredDate ?? null
  });
  const saveRequest = async (submitForApproval: boolean) => {
    const values = submitForApproval ? await requestForm.validateFields() : requestForm.getFieldsValue();
    return submit(
      editingDraft ? `/development-requests/${editingDraft.id}/draft` : "/development-requests",
      requestPayload(values, submitForApproval),
      submitForApproval ? "需求已提交给上级领导审批" : "需求草稿已保存",
      editingDraft ? "PATCH" : "POST"
    );
  };
  const openNew = () => {
    const me = (people.data ?? []).find((person) => person.id === currentUser.sub);
    setEditingDraft(undefined); requestForm.resetFields();
    requestForm.setFieldsValue({ category: "系统功能", urgency: "NORMAL", requesterManagerId: me?.managerIds?.[0] }); setRequestOpen(true);
  };
  const openDraft = (row: RequestRow) => {
    setEditingDraft(row); requestForm.setFieldsValue({ ...row, desiredDate: row.desiredDate ? dayjs(row.desiredDate) : null }); setRequestOpen(true);
  };
  const openPlan = (row: RequestRow) => {
    setPlanning(row); planForm.setFieldsValue({ requiredResources: row.requiredResources, estimatedWorkdays: row.estimatedWorkdays ? Number(row.estimatedWorkdays) : undefined, plannedCompletionDate: row.plannedCompletionDate ? dayjs(row.plannedCompletionDate) : undefined });
  };
  const startAction = (row: RequestRow, action: Action) => {
    if (action === "EDIT_DRAFT") return openDraft(row);
    if (action === "SUBMIT") return submit(`/development-requests/${row.id}/submit`, {}, "需求已提交给上级领导审批");
    if (action === "ASSIGN") { setAssigning(row); assignForm.resetFields(); return; }
    if (action === "SUBMIT_PLAN") return openPlan(row);
    if (action === "WITHDRAW" || action === "RETURN") { movementForm.resetFields(); setMovement({ row, action }); return; }
    decisionForm.resetFields(); setDecision({ row, action });
  };
  const counters = useMemo(() => ({
    total: rows.length, todo: rows.filter((row) => row.availableActions.length).length,
    mine: rows.filter((row) => row.requesterId === currentUser.sub).length,
    approved: rows.filter((row) => row.status === "APPROVED_FOR_DEVELOPMENT").length
  }), [currentUser.sub, rows]);
  const columns = [
    { title: "需求编号", dataIndex: "requestNumber", width: 160, fixed: "left" as const, render: (value: string, row: RequestRow) => <Button type="link" onClick={() => setDetailId(row.id)}>{value}</Button> },
    { title: "需求标题", dataIndex: "title", width: 240, ellipsis: true, render: (value: string | null) => value || "未命名草稿" },
    { title: "类型", dataIndex: "category", width: 100, render: (value: string | null) => value || "—" },
    { title: "紧急程度", dataIndex: "urgency", width: 95, render: (value: string) => <Tag color={urgencyMeta[value]?.color}>{urgencyMeta[value]?.label ?? value}</Tag> },
    { title: "当前状态", dataIndex: "status", width: 170, render: (value: string) => <Tag color={statusMeta[value]?.color}>{statusMeta[value]?.label ?? value}</Tag> },
    { title: "填写人", dataIndex: "requesterName", width: 100 },
    { title: "填写人上级", dataIndex: "requesterManagerName", width: 110 },
    { title: "处理人员", dataIndex: "handlerName", width: 100, render: (value: string | null) => value ?? "待分配" },
    { title: "处理人上级", dataIndex: "handlerManagerName", width: 110, render: (value: string | null) => value ?? "—" },
    { title: "预计工作日", dataIndex: "estimatedWorkdays", width: 105, render: (value: string | null) => value ? `${Number(value)} 天` : "—" },
    { title: "计划完成", dataIndex: "plannedCompletionDate", width: 105, render: (value: string | null) => value ?? "—" },
    { title: "更新时间", dataIndex: "updatedAt", width: 150, render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm") },
    { title: "操作", key: "actions", fixed: "right" as const, width: 340, render: (_: unknown, row: RequestRow) => <Space size={4} wrap>
      <Button size="small" onClick={() => setDetailId(row.id)}>详情</Button>
      {row.availableActions.map((action) => <Button key={action} size="small" type={["SUBMIT", "REQUESTER_APPROVE", "HANDLER_APPROVE", "ASSIGN", "SUBMIT_PLAN"].includes(action) ? "primary" : "default"} danger={action === "RETURN"} onClick={() => startAction(row, action)}>{actionLabels[action]}</Button>)}
    </Space> }
  ];
  const detailRow = detail.data;
  const currentStep = statusMeta[detailRow?.status ?? ""]?.step ?? 0;

  return <div className="development-page">
    <PageHeader title="需求与开发" subtitle="需求提报、领导审批、管理员分配、开发资源与工期评估的统一工作台" actions={<Button type="primary" onClick={openNew}>提报新需求</Button>} />
    <div className="development-stats">
      <Card><Statistic title="当前可见需求" value={counters.total} /></Card>
      <Card><Statistic title="待我处理" value={counters.todo} valueStyle={{ color: counters.todo ? "#cf6b18" : undefined }} /></Card>
      <Card><Statistic title="我提报的需求" value={counters.mine} /></Card>
      <Card><Statistic title="已批准开发" value={counters.approved} valueStyle={{ color: "#238657" }} /></Card>
    </div>
    <Card className="development-workbench" bordered={false}>
      <Flex justify="space-between" align="center" gap={12} wrap>
        <Select value={scope} onChange={setScope} style={{ width: 170 }} options={[{ value: "all", label: "全部可见需求" }, { value: "todo", label: "待我处理" }, { value: "mine", label: "我提报的需求" }]} />
        <Input.Search allowClear placeholder="搜索编号、标题、类型或需求说明" onSearch={setSearch} style={{ width: 360 }} />
      </Flex>
      <Table style={{ marginTop: 14 }} rowKey="id" dataSource={rows} loading={requests.isLoading} columns={columns} pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }} scroll={{ x: 1930, y: "calc(100vh - 410px)" }} />
    </Card>

    <Modal title={editingDraft ? `编辑需求草稿 · ${editingDraft.requestNumber}` : "提报新需求"} width={720} open={requestOpen} onCancel={() => { setRequestOpen(false); setEditingDraft(undefined); }} footer={<Space>
      <Button onClick={() => { setRequestOpen(false); setEditingDraft(undefined); }}>取消</Button>
      <Button loading={saving} onClick={() => void saveRequest(false)}>保存草稿</Button>
      <Button loading={saving} type="primary" onClick={() => void saveRequest(true)}>提交审批</Button>
    </Space>}>
      <Alert type="info" showIcon message="可以先保存未填写完整的草稿；提交后，在上级处理前可以撤回。" style={{ marginBottom: 16 }} />
      <Form form={requestForm} layout="vertical">
        <Form.Item name="title" label="需求标题" rules={[{ required: true, whitespace: true }]}><Input maxLength={200} showCount /></Form.Item>
        <Flex gap={14}><Form.Item name="category" label="需求类型" rules={[{ required: true }]} style={{ flex: 1 }}><Select options={["系统功能", "流程优化", "数据报表", "接口集成", "移动端", "其他"].map((value) => ({ value }))} /></Form.Item><Form.Item name="urgency" label="紧急程度" rules={[{ required: true }]} style={{ flex: 1 }}><Select options={Object.entries(urgencyMeta).map(([value, meta]) => ({ value, label: meta.label }))} /></Form.Item><Form.Item name="desiredDate" label="期望完成日期" style={{ flex: 1 }}><DatePicker style={{ width: "100%" }} /></Form.Item></Flex>
        <Form.Item name="requesterManagerId" label="填写人的上级审批领导" rules={[{ required: true, message: "请选择上级审批领导" }]}><Select allowClear showSearch optionFilterProp="label" options={personOptions.filter((option) => option.value !== currentUser.sub)} placeholder="已根据通讯录自动推荐；保存草稿时可暂不选择" /></Form.Item>
        <Form.Item name="description" label="需求说明" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={5} maxLength={10000} showCount placeholder="请说明当前问题、使用场景、期望效果和验收标准" /></Form.Item>
        <Form.Item name="businessValue" label="业务价值"><Input.TextArea rows={3} maxLength={5000} showCount placeholder="例如节省工时、降低错误、提升交付效率等" /></Form.Item>
      </Form>
    </Modal>

    <Modal title={decision ? `${actionLabels[decision.action]} · ${decision.row.requestNumber}` : "审批"} open={Boolean(decision)} confirmLoading={saving} okText={decision ? actionLabels[decision.action] : "提交"} onCancel={() => setDecision(undefined)} onOk={() => decisionForm.validateFields().then((values) => {
      if (!decision) return;
      const requester = decision.action === "REQUESTER_APPROVE";
      return submit(`/development-requests/${decision.row.id}/${requester ? "requester-decision" : "handler-manager-decision"}`, { approved: true, comment: values.comment }, "审批已通过");
    })}>
      <Paragraph>{decision?.row.title}</Paragraph>
      <Form form={decisionForm} layout="vertical"><Form.Item name="comment" label="审批意见"><Input.TextArea rows={4} maxLength={2000} placeholder="可选填审批意见；如需退回，请关闭后使用“退回前序环节”" /></Form.Item></Form>
    </Modal>

    <Modal title={movement ? `${actionLabels[movement.action]} · ${movement.row.requestNumber}` : "流程操作"} open={Boolean(movement)} confirmLoading={saving} okButtonProps={{ danger: movement?.action === "RETURN" }} okText={movement?.action === "RETURN" ? "确认退回" : "确认撤回"} onCancel={() => setMovement(undefined)} onOk={() => movementForm.validateFields().then((values) => movement && submit(`/development-requests/${movement.row.id}/${movement.action === "RETURN" ? "return" : "withdraw"}`, values, movement.action === "RETURN" ? "已退回到指定前序环节" : "已撤回到上一环节"))}>
      <Alert type="warning" showIcon message={movement?.action === "RETURN" ? "当前环节处理人可以退回到此前任一环节，目标环节及其后续流程需要重新处理。" : "仅在后一级尚未处理时允许撤回。"} style={{ marginBottom: 16 }} />
      <Form form={movementForm} layout="vertical">
        {movement?.action === "RETURN" && <Form.Item name="targetStatus" label="退回到" rules={[{ required: true, message: "请选择退回环节" }]}><Select options={movement.row.returnTargets.map((target) => ({ value: target.status, label: target.label }))} /></Form.Item>}
        <Form.Item name="comment" label={movement?.action === "RETURN" ? "退回原因" : "撤回说明"} rules={movement?.action === "RETURN" ? [{ required: true, whitespace: true, message: "请填写退回原因" }] : []}><Input.TextArea rows={4} maxLength={2000} /></Form.Item>
      </Form>
    </Modal>

    <Modal title={assigning ? `分配处理人员 · ${assigning.requestNumber}` : "分配处理人员"} open={Boolean(assigning)} confirmLoading={saving} okText="确认分配" onCancel={() => setAssigning(undefined)} onOk={() => assignForm.validateFields().then((values) => assigning && submit(`/development-requests/${assigning.id}/assign`, values, "已分配处理人员"))}>
      <Alert type="info" showIcon message="处理人员完成资源和工期评估后，将提交给其上级领导审批。" style={{ marginBottom: 16 }} />
      <Form form={assignForm} layout="vertical" onValuesChange={(changed) => { if (!changed.handlerId) return; const handler = (people.data ?? []).find((person) => person.id === changed.handlerId); assignForm.setFieldValue("handlerManagerId", handler?.managerIds?.[0]); }}>
        <Form.Item name="handlerId" label="处理人员" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={personOptions} /></Form.Item>
        <Form.Item name="handlerManagerId" label="处理人员的上级审批领导" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={personOptions.filter((option) => option.value !== assignForm.getFieldValue("handlerId"))} placeholder="已根据通讯录自动推荐；请管理员确认" /></Form.Item>
        <Form.Item name="comment" label="分配说明"><Input.TextArea rows={3} maxLength={2000} /></Form.Item>
      </Form>
    </Modal>

    <Modal title={planning ? `填写开发资源与工期 · ${planning.requestNumber}` : "填写开发资源与工期"} width={650} open={Boolean(planning)} confirmLoading={saving} okText="提交上级审批" onCancel={() => setPlanning(undefined)} onOk={() => planForm.validateFields().then((values) => planning && submit(`/development-requests/${planning.id}/plan`, { ...values, plannedCompletionDate: values.plannedCompletionDate.format("YYYY-MM-DD") }, "开发评估已提交给上级领导审批"))}>
      <Form form={planForm} layout="vertical">
        <Form.Item name="requiredResources" label="开发所需资源" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={5} maxLength={10000} showCount placeholder="人员、软件、设备、数据、接口、预算及跨部门配合等" /></Form.Item>
        <Flex gap={16}><Form.Item name="estimatedWorkdays" label="开发所需时间（工作日）" rules={[{ required: true }]} style={{ flex: 1 }}><InputNumber min={0.5} max={9999} step={0.5} precision={1} style={{ width: "100%" }} /></Form.Item><Form.Item name="plannedCompletionDate" label="计划完成日期" rules={[{ required: true }]} style={{ flex: 1 }}><DatePicker style={{ width: "100%" }} /></Form.Item></Flex>
      </Form>
    </Modal>

    <Drawer title={detailRow ? `${detailRow.requestNumber} · ${detailRow.title || "未命名草稿"}` : "需求详情"} width={760} open={Boolean(detailId)} onClose={() => setDetailId(undefined)}>
      {detail.isLoading ? <Alert type="info" showIcon message="正在加载需求详情" /> : !detailRow ? <Empty /> : <Space direction="vertical" size={18} style={{ width: "100%" }}>
        <Steps current={currentStep} size="small" items={[{ title: "创建" }, { title: "填写人上级审批" }, { title: "管理员分配" }, { title: "资源工期评估" }, { title: "处理人上级审批" }, { title: "待开发" }]} />
        <Descriptions bordered size="small" column={2} items={[
          { key: "status", label: "状态", children: <Tag color={statusMeta[detailRow.status]?.color}>{statusMeta[detailRow.status]?.label}</Tag> },
          { key: "urgency", label: "紧急程度", children: urgencyMeta[detailRow.urgency]?.label },
          { key: "category", label: "需求类型", children: detailRow.category },
          { key: "desired", label: "期望完成", children: detailRow.desiredDate ?? "—" },
          { key: "requester", label: "填写人", children: detailRow.requesterName },
          { key: "requesterManager", label: "填写人上级", children: detailRow.requesterManagerName },
          { key: "handler", label: "处理人员", children: detailRow.handlerName ?? "待分配" },
          { key: "handlerManager", label: "处理人上级", children: detailRow.handlerManagerName ?? "—" },
          { key: "workdays", label: "预计工作日", children: detailRow.estimatedWorkdays ? `${Number(detailRow.estimatedWorkdays)} 天` : "—" },
          { key: "completion", label: "计划完成", children: detailRow.plannedCompletionDate ?? "—" }
        ]} />
        <Card size="small" title="需求说明"><Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{detailRow.description || "尚未填写"}</Paragraph></Card>
        {detailRow.businessValue && <Card size="small" title="业务价值"><Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{detailRow.businessValue}</Paragraph></Card>}
        {detailRow.requiredResources && <Card size="small" title="开发所需资源"><Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{detailRow.requiredResources}</Paragraph></Card>}
        <Card size="small" title="流程记录">{detailRow.events?.length ? <Timeline items={detailRow.events.map((event) => ({ color: event.action === "RETURN" ? "red" : event.action === "WITHDRAW" ? "orange" : event.action.includes("APPROVE") ? "green" : "blue", children: <div><Text strong>{eventLabels[event.action] ?? event.action}</Text><br /><Text type="secondary">{event.actorName} · {dayjs(event.createdAt).format("YYYY-MM-DD HH:mm")}</Text>{event.comment && <Paragraph style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{event.comment}</Paragraph>}</div> }))} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无流程记录" />}</Card>
      </Space>}
    </Drawer>
  </div>;
}
