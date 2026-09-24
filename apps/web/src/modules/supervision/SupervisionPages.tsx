import { useMemo, useState } from "react";
import {
  EllipsisOutlined, FileAddOutlined, FolderOpenOutlined, PlusOutlined, ReloadOutlined, UploadOutlined
} from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  supervisionDisplayStatusOptions, supervisionLifecycleStatusOptions, supervisionPriorityOptions,
  supervisionProgressUpdateTypeOptions, supervisionSourceTypeOptions
} from "@kdos/contracts";
import {
  Alert, App, Button, Card, Col, DatePicker, Drawer, Dropdown, Empty, Flex, Form, Input, InputNumber,
  Modal, Progress, Row, Select, Space, Statistic, Steps, Tabs, Tag, Typography, Upload
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { api } from "../../api";
import { KdosDataTable, TablePermissionButton, hasFieldPermission, hasResourcePermission, useKdosTableEditMode } from "../../shared/KdosDataTable";
import { blankPlatformQuery, platformRowsKey, platformRowsUrl, type PlatformTablePage, type PlatformTableQuery } from "../../shared/platform-table";
import type { AdvancedFilterGroup } from "../../shared/advanced-filter";

const { Title, Paragraph, Text } = Typography;
type Attachment = { key: string; name: string; contentType: string; size: number };
type Options = { users: Array<{ id: string; label: string }>; departments: Array<{ id: string; name: string; pathLabel?: string }>; projects: Array<{ id: string; projectCode: string; projectName: string; lifecycleStatus: string }> };
type ProjectRow = Record<string, any> & { id: string; version: number; projectCode: string; projectName: string; ownerId: string; supervisorId: string; dueDate: string; lifecycleStatus: string; displayStatus: string; progress: number };
type TaskRow = Record<string, any> & { id: string; version: number; taskCode: string; projectId: string; projectName: string; taskName: string; ownerId: string; dueDate: string; lifecycleStatus: string; displayStatus: string; progress: number };

const labelMap = (items: readonly { value: string; label: string }[]) => Object.fromEntries(items.map((item) => [item.value, item.label]));
const lifecycleLabels = labelMap(supervisionLifecycleStatusOptions);
const displayLabels = labelMap(supervisionDisplayStatusOptions);
const priorityLabels = labelMap(supervisionPriorityOptions);
const sourceLabels = labelMap(supervisionSourceTypeOptions);
const updateTypeLabels = labelMap(supervisionProgressUpdateTypeOptions);
const statusColor: Record<string, string> = { NORMAL: "green", OVERDUE: "red", COMPLETED: "blue", ABORTED: "default", NOT_STARTED: "default", IN_PROGRESS: "processing" };
const errorText = (error: unknown) => error instanceof Error ? error.message : "操作失败，请稍后重试";
const dateValue = (value: unknown) => value ? dayjs(String(value)) : null;
const dateText = (value: unknown) => value ? dayjs(String(value)).format("YYYY-MM-DD") : "—";
const userLabel = (options: Options | undefined, id: unknown) => options?.users.find((item) => item.id === id)?.label ?? (id ? "—" : "—");
const departmentLabel = (options: Options | undefined, id: unknown) => { const department = options?.departments.find((item) => item.id === id); return department?.pathLabel ?? department?.name ?? "—"; };

function useSupervisionOptions() {
  return useQuery({ queryKey: ["supervision-options"], queryFn: () => api<Options>("/supervision/options"), staleTime: 300_000 });
}

function usePlatformRows<T>(resource: string, initial?: PlatformTableQuery) {
  const [query, setQuery] = useState<PlatformTableQuery>(initial ?? blankPlatformQuery());
  const result = useQuery({ queryKey: platformRowsKey(resource, query), queryFn: () => api<PlatformTablePage<T>>(platformRowsUrl(resource, query)), placeholderData: (previous) => previous });
  return { query, setQuery, result };
}

function StatusTag({ value }: { value: string }) {
  return <Tag color={statusColor[value]}>{displayLabels[value] ?? lifecycleLabels[value] ?? value ?? "—"}</Tag>;
}

function PageHeading({ title, description, extra }: { title: string; description?: string; extra?: React.ReactNode }) {
  return <Flex justify="space-between" align="flex-start" gap={16} wrap className="supervision-page-heading"><div><Title level={3}>{title}</Title>{description && <Paragraph type="secondary">{description}</Paragraph>}</div>{extra}</Flex>;
}

function AttachmentInput({ value = [], onChange }: { value?: Attachment[]; onChange?: (value: Attachment[]) => void }) {
  const { message } = App.useApp(); const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    setUploading(true);
    try { const data = new FormData(); data.append("file", file); const attachment = await api<Attachment>("/supervision/attachments", { method: "POST", body: data }); onChange?.([...value, attachment]); message.success("附件已上传"); }
    catch (error) { message.error(errorText(error)); }
    finally { setUploading(false); }
    return false;
  };
  return <Space direction="vertical" style={{ width: "100%" }}>
    <Upload beforeUpload={(file) => void upload(file as File)} showUploadList={false} disabled={uploading || value.length >= 20}><Button icon={<UploadOutlined />} loading={uploading}>上传附件</Button></Upload>
    <Flex gap={8} wrap>{value.map((item, index) => <Tag closable key={item.key} onClose={() => onChange?.(value.filter((_entry, i) => i !== index))}>{item.name}</Tag>)}</Flex>
  </Space>;
}

export function SupervisionHowToPage() {
  return <div className="supervision-info-page"><PageHeading title="如何使用任务督办" description="用一个督办项目承载需要持续跟进、最终闭环的管理事项，再拆解为具体责任任务。" />
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={8}><Card title="督办项目" className="supervision-role-card"><Paragraph>经营会决议、战略项目、领导交办、专项工作或跨部门重点事项的管理容器。</Paragraph></Card></Col>
      <Col xs={24} lg={8}><Card title="督办任务" className="supervision-role-card"><Paragraph>项目拆解后的实际执行事项，具有明确责任人、截止日期、进度和完成标准。</Paragraph></Card></Col>
      <Col xs={24} lg={8}><Card title="进展记录" className="supervision-role-card"><Paragraph>每次更新形成独立历史，不覆盖旧记录；风险、下一步和截止日期调整均可追溯。</Paragraph></Card></Col>
    </Row>
    <Card title="三种角色" style={{ marginTop: 16 }}><Row gutter={[24, 16]}>
      <Col xs={24} md={8}><Title level={5}>项目负责人</Title><Paragraph>统筹目标、任务拆解与项目验收，确认项目最终完成。</Paragraph></Col>
      <Col xs={24} md={8}><Title level={5}>任务责任人</Title><Paragraph>执行任务、持续更新进展，对任务交付结果和截止日期负责。</Paragraph></Col>
      <Col xs={24} md={8}><Title level={5}>督办人</Title><Paragraph>关注风险和延期，推动责任人闭环，不替代任务责任人执行。</Paragraph></Col>
    </Row></Card>
    <Card title="标准使用流程" style={{ marginTop: 16 }}><Steps responsive items={["创建项目", "拆解任务", "指定责任人", "执行并更新进展", "系统判断延期", "完成验收", "项目关闭"].map((title) => ({ title }))} /></Card>
  </div>;
}

export function SupervisionFlowPage() {
  const steps = ["创建督办项目", "拆解执行任务", "分配责任人", "开始执行", "更新进度", "系统判断是否延期", "延期则督办跟进 / 正常则继续执行", "任务完成", "验收", "所有必要任务完成", "项目负责人完成项目", "归档查询"];
  return <div className="supervision-info-page"><PageHeading title="项目流程图" description="本阶段由业务状态与受控命令驱动，不引入额外 BPM 工作流引擎。" />
    <Card><div className="supervision-flow">{steps.map((step, index) => <div key={step} className={`supervision-flow-step${index === 5 ? " decision" : ""}`}><span>{index + 1}</span><strong>{step}</strong>{index < steps.length - 1 && <i>↓</i>}</div>)}</div></Card>
  </div>;
}

function ProjectRowActions({ row, onAction }: { row: ProjectRow; onAction: (action: string, row: ProjectRow) => void }) {
  const { editing } = useKdosTableEditMode(); if (!editing) return null;
  const items = [
    { key: "edit", label: "编辑项目", disabled: ["COMPLETED", "ABORTED"].includes(row.lifecycleStatus) },
    { key: "complete", label: "完成项目", disabled: ["COMPLETED", "ABORTED"].includes(row.lifecycleStatus) },
    { key: "abort", label: "中止项目", danger: true, disabled: ["COMPLETED", "ABORTED"].includes(row.lifecycleStatus) }
  ];
  return <Dropdown trigger={["click"]} menu={{ items, onClick: ({ key }) => onAction(key, row) }}><Button type="text" aria-label={`项目操作-${row.projectCode}`} icon={<EllipsisOutlined />} /></Dropdown>;
}

function TaskRowActions({ row, onAction }: { row: TaskRow; onAction: (action: string, row: TaskRow) => void }) {
  const { editing } = useKdosTableEditMode();
  const terminal = ["COMPLETED", "ABORTED"].includes(row.lifecycleStatus);
  const items = [
    { key: "history", label: "查看进展" },
    ...(editing ? [
      { key: "edit", label: "编辑任务", disabled: terminal },
      ...(hasResourcePermission("supervision-task-progress", "create") && hasFieldPermission("supervision-tasks", "progress", "update") ? [{ key: "progress", label: "更新进展", disabled: terminal }] : []),
      ...(hasFieldPermission("supervision-tasks", "dueDate", "update") ? [{ key: "due", label: "修改截止日期", disabled: terminal }] : []),
      { key: "complete", label: "完成任务", disabled: terminal }, { key: "abort", label: "中止任务", danger: true, disabled: terminal }
    ] : [])
  ];
  return <Dropdown trigger={["click"]} menu={{ items, onClick: ({ key }) => onAction(key, row) }}><Button type="text" aria-label={`任务操作-${row.taskCode}`} icon={<EllipsisOutlined />} /></Dropdown>;
}

function ProjectForm({ open, row, options, onClose, onSaved }: { open: boolean; row?: ProjectRow; options?: Options; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm(); const { message } = App.useApp(); const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState("");
  const canEdit = (field: string) => !row || hasFieldPermission("supervision-projects", field, "update");
  const initial = row ? { ...row, sourceDate: dateValue(row.sourceDate), plannedStartDate: dateValue(row.plannedStartDate), dueDate: dateValue(row.dueDate) } : { priority: "MEDIUM", participantIds: [], attachments: [] };
  const save = async () => { try { setSaveError(""); const values = await form.validateFields(); setSaving(true); const body: Record<string, unknown> = { ...values, ...(row ? { expectedVersion: row.version } : {}) }; if ("sourceDate" in values) body.sourceDate = values.sourceDate?.format("YYYY-MM-DD") ?? null; if ("plannedStartDate" in values) body.plannedStartDate = values.plannedStartDate?.format("YYYY-MM-DD"); if ("dueDate" in values) body.dueDate = values.dueDate?.format("YYYY-MM-DD"); await api(row ? `/supervision/projects/${row.id}` : "/supervision/projects", { method: row ? "PATCH" : "POST", body: JSON.stringify(body) }); message.success(row ? "项目已更新" : "项目已创建"); onSaved(); onClose(); } catch (error: any) { if (!error?.errorFields) { const text = errorText(error); setSaveError(text); message.error(text); } } finally { setSaving(false); } };
  return <Modal title={row ? `编辑项目 · ${row.projectCode}` : "创建督办项目"} open={open} width={900} onCancel={onClose} onOk={() => void save()} confirmLoading={saving} destroyOnHidden>
    {saveError && <Alert type="error" showIcon message={saveError} style={{ marginBottom: 16 }} />}<Form form={form} layout="vertical" initialValues={initial} requiredMark={false}><Row gutter={16}>
      {canEdit("projectName") && <Col span={24}><Form.Item name="projectName" label="项目名称" rules={[{ required: true, whitespace: true }]}><Input maxLength={300} /></Form.Item></Col>}
      {canEdit("sourceType") && <Col xs={24} md={8}><Form.Item name="sourceType" label="来源类型"><Select allowClear options={[...supervisionSourceTypeOptions]} /></Form.Item></Col>}
      {canEdit("sourceName") && <Col xs={24} md={8}><Form.Item name="sourceName" label="来源名称"><Input /></Form.Item></Col>}
      {canEdit("sourceDate") && <Col xs={24} md={8}><Form.Item name="sourceDate" label="来源日期"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>}
      {canEdit("ownerId") && <Col xs={24} md={8}><Form.Item name="ownerId" label="项目负责人" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={options?.users.map((item) => ({ value: item.id, label: item.label }))} /></Form.Item></Col>}
      {canEdit("supervisorId") && <Col xs={24} md={8}><Form.Item name="supervisorId" label="督办人" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={options?.users.map((item) => ({ value: item.id, label: item.label }))} /></Form.Item></Col>}
      {canEdit("departmentId") && <Col xs={24} md={8}><Form.Item name="departmentId" label="责任部门"><Select allowClear showSearch optionFilterProp="label" options={options?.departments.map((item) => ({ value: item.id, label: item.pathLabel ?? item.name }))} /></Form.Item></Col>}
      {canEdit("participantIds") && <Col xs={24} md={12}><Form.Item name="participantIds" label="参与人员"><Select mode="multiple" showSearch optionFilterProp="label" options={options?.users.map((item) => ({ value: item.id, label: item.label }))} /></Form.Item></Col>}
      {canEdit("priority") && <Col xs={24} md={12}><Form.Item name="priority" label="优先级"><Select options={[...supervisionPriorityOptions]} /></Form.Item></Col>}
      {canEdit("plannedStartDate") && <Col xs={24} md={12}><Form.Item name="plannedStartDate" label="计划开始日期" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></Col>}
      {canEdit("dueDate") && <Col xs={24} md={12}><Form.Item name="dueDate" label="项目交付日期" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></Col>}
      {canEdit("acceptanceCriteria") && <Col span={24}><Form.Item name="acceptanceCriteria" label="完成/验收标准" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} /></Form.Item></Col>}
      {canEdit("attachments") && <Col span={24}><Form.Item name="attachments" label="附件"><AttachmentInput /></Form.Item></Col>}
    </Row></Form>
  </Modal>;
}

function ProjectActionModal({ action, row, onClose, onSaved }: { action?: "complete" | "abort"; row?: ProjectRow; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm(); const { message } = App.useApp(); const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState(""); if (!action || !row) return null;
  const field = action === "complete" ? "completionSummary" : "stopReason";
  const save = async () => { try { setSaveError(""); const values = await form.validateFields(); setSaving(true); await api(`/supervision/projects/${row.id}/${action}`, { method: "POST", body: JSON.stringify({ ...values, expectedVersion: row.version }) }); message.success(action === "complete" ? "项目已完成" : "项目已中止"); onSaved(); onClose(); } catch (error: any) { if (!error?.errorFields) { const text = errorText(error); setSaveError(text); message.error(text); } } finally { setSaving(false); } };
  return <Modal title={action === "complete" ? "完成项目" : "中止项目"} open onCancel={onClose} onOk={() => void save()} confirmLoading={saving} okButtonProps={{ danger: action === "abort" }} destroyOnHidden><Alert showIcon type={action === "complete" ? "info" : "warning"} message={row.projectName} style={{ marginBottom: 16 }} />{saveError && <Alert type="error" showIcon message={saveError} style={{ marginBottom: 16 }} />}<Form form={form} layout="vertical"><Form.Item name={field} label={action === "complete" ? "完成说明" : "中止原因"} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={4} /></Form.Item></Form></Modal>;
}

export function SupervisionProjectsPage({ embedded = false, externalFilter }: { embedded?: boolean; externalFilter?: AdvancedFilterGroup }) {
  const options = useSupervisionOptions(); const { setQuery, result } = usePlatformRows<ProjectRow>("supervision-projects"); const queryClient = useQueryClient();
  const [statusView, setStatusView] = useState(embedded ? "ALL" : "OPEN");
  const [formRow, setFormRow] = useState<ProjectRow | null | undefined>(); const [action, setAction] = useState<{ action: "complete" | "abort"; row: ProjectRow }>();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["supervision-projects"] });
  const statusGroup: AdvancedFilterGroup = statusView === "ALL" ? { logic: "AND", rules: [] } : statusView === "OPEN"
    ? { logic: "OR", rules: [{ field: "displayStatus", operator: "eq", value: "NORMAL" }, { field: "displayStatus", operator: "eq", value: "OVERDUE" }] }
    : { logic: "AND", rules: [{ field: "displayStatus", operator: "eq", value: statusView }] };
  const onQuery = (next: PlatformTableQuery) => { const groups = [externalFilter, statusGroup, next.filterGroup].filter((group): group is AdvancedFilterGroup => Boolean(group && (group.rules.length || group.groups?.length))); setQuery({ ...next, filterGroup: groups.length ? { logic: "AND", rules: [], groups } : { logic: "AND", rules: [] } }); };
  const columns: any[] = [
    { title: "项目编号", dataIndex: "projectCode", width: 175, fixed: "left" }, { title: "项目名称", dataIndex: "projectName", width: 240 }, { title: "来源类型", dataIndex: "sourceType", width: 120, render: (v: string) => sourceLabels[v] ?? "—" },
    { title: "项目负责人", dataIndex: "ownerId", width: 130, render: (v: string) => userLabel(options.data, v) }, { title: "督办人", dataIndex: "supervisorId", width: 130, render: (v: string) => userLabel(options.data, v) },
    { title: "责任部门", dataIndex: "departmentId", width: 140, render: (v: string) => departmentLabel(options.data, v) }, { title: "优先级", dataIndex: "priority", width: 90, render: (v: string) => priorityLabels[v] ?? v },
    { title: "计划开始日期", dataIndex: "plannedStartDate", width: 130, render: dateText }, { title: "项目交付日期", dataIndex: "dueDate", width: 130, render: dateText },
    { title: "当前状态", dataIndex: "displayStatus", width: 110, render: (v: string) => <StatusTag value={v} /> }, { title: "项目进度", dataIndex: "progress", width: 150, render: (v: number) => <Progress percent={Number(v ?? 0)} size="small" /> },
    { title: "实际完成时间", dataIndex: "completedAt", width: 175, render: (v: string) => v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—" },
    { title: "", key: "__actions", width: 52, fixed: "right", render: (_: unknown, row: ProjectRow) => <ProjectRowActions row={row} onAction={(key, target) => key === "edit" ? setFormRow(target) : setAction({ action: key as "complete" | "abort", row: target })} /> }
  ];
  return <div>{!embedded && <PageHeading title="项目管理" description="默认聚焦未完成督办项目；已完成和已中止项目保留用于历史查询。" />}
    <Tabs activeKey={statusView} onChange={setStatusView} items={[{ key: "OPEN", label: "未完成" }, { key: "ALL", label: "全部" }, { key: "NORMAL", label: "正常推进" }, { key: "OVERDUE", label: "已延期" }, { key: "COMPLETED", label: "已完成" }, { key: "ABORTED", label: "已中止" }]} />
    <KdosDataTable resource="supervision-projects" viewKey={`status-${statusView}`} rowKey="id" editable columns={columns} dataSource={result.data?.rows} loading={result.isLoading} serverData={{ total: result.data?.total ?? 0, onQueryChange: onQuery }}
      toolbar={<>{hasResourcePermission("supervision-projects", "create") && <Button type="primary" icon={<PlusOutlined />} onClick={() => setFormRow(null)}>创建项目</Button>}<Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button></>} />
    {formRow !== undefined && <ProjectForm open row={formRow ?? undefined} options={options.data} onClose={() => setFormRow(undefined)} onSaved={refresh} />}
    <ProjectActionModal action={action?.action} row={action?.row} onClose={() => setAction(undefined)} onSaved={refresh} />
  </div>;
}

function TaskForm({ open, row, options, onClose, onSaved }: { open: boolean; row?: TaskRow; options?: Options; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm(); const { message } = App.useApp(); const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState("");
  const canEdit = (field: string) => !row || hasFieldPermission("supervision-tasks", field, "update");
  const initial = row ? { ...row, plannedStartDate: dateValue(row.plannedStartDate), nextFollowupDate: dateValue(row.nextFollowupDate), attachments: row.attachments ?? [] } : { priority: "MEDIUM", progress: 0, collaboratorIds: [], attachments: [] };
  const save = async () => { try { setSaveError(""); const values = await form.validateFields(); setSaving(true); const body: Record<string, unknown> = { ...values, ...(row ? { expectedVersion: row.version } : {}) }; if ("plannedStartDate" in values) body.plannedStartDate = values.plannedStartDate?.format("YYYY-MM-DD") ?? null; if ("nextFollowupDate" in values) body.nextFollowupDate = values.nextFollowupDate?.format("YYYY-MM-DD") ?? null; if (!row) body.dueDate = values.dueDate?.format("YYYY-MM-DD"); await api(row ? `/supervision/tasks/${row.id}` : "/supervision/tasks", { method: row ? "PATCH" : "POST", body: JSON.stringify(body) }); message.success(row ? "任务已更新" : "任务已创建"); onSaved(); onClose(); } catch (error: any) { if (!error?.errorFields) { const text = errorText(error); setSaveError(text); message.error(text); } } finally { setSaving(false); } };
  return <Modal title={row ? `编辑任务 · ${row.taskCode}` : "创建督办任务"} open={open} width={900} onCancel={onClose} onOk={() => void save()} confirmLoading={saving} destroyOnHidden>{saveError && <Alert type="error" showIcon message={saveError} style={{ marginBottom: 16 }} />}<Form form={form} layout="vertical" initialValues={initial} requiredMark={false}><Row gutter={16}>
    {canEdit("projectId") && <Col span={24}><Form.Item name="projectId" label="所属督办项目" rules={[{ required: true }]}><Select disabled={Boolean(row)} showSearch optionFilterProp="label" options={options?.projects.filter((item) => !["COMPLETED", "ABORTED"].includes(item.lifecycleStatus)).map((item) => ({ value: item.id, label: `${item.projectCode} · ${item.projectName}` }))} /></Form.Item></Col>}
    {canEdit("taskName") && <Col span={24}><Form.Item name="taskName" label="任务名称" rules={[{ required: true, whitespace: true }]}><Input maxLength={300} /></Form.Item></Col>}
    {canEdit("description") && <Col span={24}><Form.Item name="description" label="任务说明"><Input.TextArea rows={2} /></Form.Item></Col>}
    {canEdit("ownerId") && <Col xs={24} md={8}><Form.Item name="ownerId" label="任务责任人" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={options?.users.map((item) => ({ value: item.id, label: item.label }))} /></Form.Item></Col>}
    {canEdit("departmentId") && <Col xs={24} md={8}><Form.Item name="departmentId" label="责任部门"><Select allowClear showSearch optionFilterProp="label" options={options?.departments.map((item) => ({ value: item.id, label: item.pathLabel ?? item.name }))} /></Form.Item></Col>}
    {canEdit("priority") && <Col xs={24} md={8}><Form.Item name="priority" label="优先级"><Select options={[...supervisionPriorityOptions]} /></Form.Item></Col>}
    {canEdit("collaboratorIds") && <Col span={24}><Form.Item name="collaboratorIds" label="协作人员"><Select mode="multiple" showSearch optionFilterProp="label" options={options?.users.map((item) => ({ value: item.id, label: item.label }))} /></Form.Item></Col>}
    {canEdit("plannedStartDate") && <Col xs={24} md={8}><Form.Item name="plannedStartDate" label="计划开始日期"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>}
    {!row && <Col xs={24} md={8}><Form.Item name="dueDate" label="任务截止日期" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item></Col>}
    {canEdit("acceptanceCriteria") && <Col span={24}><Form.Item name="acceptanceCriteria" label="任务完成标准" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} /></Form.Item></Col>}
    {canEdit("nextFollowupDate") && <Col xs={24} md={12}><Form.Item name="nextFollowupDate" label="下次跟进日期"><DatePicker style={{ width: "100%" }} /></Form.Item></Col>}
    {canEdit("attachments") && <Col span={24}><Form.Item name="attachments" label="附件"><AttachmentInput /></Form.Item></Col>}
  </Row></Form></Modal>;
}

type TaskAction = "progress" | "due" | "complete" | "abort";
function TaskActionModal({ action, row, onClose, onSaved }: { action?: TaskAction; row?: TaskRow; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm(); const { message } = App.useApp(); const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState(""); if (!action || !row) return null;
  const title = { progress: "更新任务进展", due: "修改任务截止日期", complete: "完成任务", abort: "中止任务" }[action];
  const save = async () => { try { setSaveError(""); const values = await form.validateFields(); setSaving(true); const endpoint = action === "progress" ? "progress" : action === "due" ? "change-due-date" : action; const body = action === "progress" ? { ...values, ...(hasFieldPermission("supervision-tasks", "nextFollowupDate", "update") ? { nextFollowupDate: values.nextFollowupDate?.format("YYYY-MM-DD") ?? null } : {}), expectedTaskVersion: row.version } : action === "due" ? { ...values, dueDate: values.dueDate.format("YYYY-MM-DD"), expectedVersion: row.version } : { ...values, expectedVersion: row.version }; await api(`/supervision/tasks/${row.id}/${endpoint}`, { method: "POST", body: JSON.stringify(body) }); message.success(`${title}成功`); onSaved(); onClose(); } catch (error: any) { if (!error?.errorFields) { const text = errorText(error); setSaveError(text); message.error(text); } } finally { setSaving(false); } };
  return <Modal title={`${title} · ${row.taskCode}`} open onCancel={onClose} onOk={() => void save()} confirmLoading={saving} okButtonProps={{ danger: action === "abort" }} destroyOnHidden>{saveError && <Alert type="error" showIcon message={saveError} style={{ marginBottom: 16 }} />}<Form form={form} layout="vertical" initialValues={action === "progress" ? { updateType: "PROGRESS", progress: row.progress, attachments: [] } : undefined} requiredMark={false}>
    {action === "progress" && <><Form.Item name="updateType" label="更新类型" rules={[{ required: true }]}><Select options={[...supervisionProgressUpdateTypeOptions].filter((item) => ["PROGRESS", "RISK"].includes(item.value))} /></Form.Item><Form.Item name="progress" label="当前完成百分比"><InputNumber min={0} max={100} addonAfter="%" style={{ width: "100%" }} /></Form.Item><Form.Item name="summary" label="本次进展说明" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} /></Form.Item><Form.Item name="riskIssue" label="风险/问题"><Input.TextArea rows={2} /></Form.Item><Form.Item name="nextAction" label="下一步行动"><Input.TextArea rows={2} /></Form.Item>{hasFieldPermission("supervision-tasks", "nextFollowupDate", "update") && <Form.Item name="nextFollowupDate" label="下次跟进日期"><DatePicker style={{ width: "100%" }} /></Form.Item>}<Form.Item name="attachments" label="附件"><AttachmentInput /></Form.Item></>}
    {action === "due" && <><Alert type="warning" showIcon message={`当前截止日期：${row.dueDate}`} style={{ marginBottom: 16 }} /><Form.Item name="dueDate" label="调整后截止日期" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item><Form.Item name="changeReason" label="变更原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} /></Form.Item></>}
    {action === "complete" && <><Form.Item name="completionSummary" label="完成说明" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={4} /></Form.Item><Form.Item name="attachments" label="完成附件"><AttachmentInput /></Form.Item></>}
    {action === "abort" && <Form.Item name="stopReason" label="中止原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={4} /></Form.Item>}
  </Form></Modal>;
}

function TaskHistoryDrawer({ row, onClose }: { row?: TaskRow; onClose: () => void }) {
  const filterGroup: AdvancedFilterGroup = { logic: "AND", rules: row ? [{ field: "taskId", operator: "eq", value: row.id }] : [] };
  const table = usePlatformRows<any>("supervision-task-progress", { ...blankPlatformQuery(50), filterGroup });
  const columns: any[] = [
    { title: "更新时间", dataIndex: "createdAt", width: 170, render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm") }, { title: "更新类型", dataIndex: "updateType", width: 120, render: (v: string) => updateTypeLabels[v] ?? v },
    { title: "完成进度", dataIndex: "progress", width: 110, render: (v: number) => v == null ? "—" : `${v}%` }, { title: "本次进展说明", dataIndex: "summary", width: 260 }, { title: "风险/问题", dataIndex: "riskIssue", width: 220 }, { title: "下一步行动", dataIndex: "nextAction", width: 220 }, { title: "下次跟进日期", dataIndex: "nextFollowupDate", width: 130, render: dateText }
  ];
  return <Drawer title={row ? `进展记录 · ${row.taskCode} · ${row.taskName}` : "进展记录"} width="85vw" open={Boolean(row)} onClose={onClose} destroyOnClose>{row && <KdosDataTable simple resource="supervision-task-progress" rowKey="id" columns={columns} dataSource={table.result.data?.rows} loading={table.result.isLoading} serverData={{ total: table.result.data?.total ?? 0, onQueryChange: (query) => table.setQuery({ ...query, filterGroup }) }} />}</Drawer>;
}

export function SupervisionTasksPage() {
  const options = useSupervisionOptions(); const table = usePlatformRows<TaskRow>("supervision-tasks"); const queryClient = useQueryClient();
  const [statusView, setStatusView] = useState("OPEN");
  const [formRow, setFormRow] = useState<TaskRow | null | undefined>(); const [action, setAction] = useState<{ action: TaskAction; row: TaskRow }>(); const [history, setHistory] = useState<TaskRow>();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["supervision-tasks"] });
  const columns: any[] = [
    { title: "任务编号", dataIndex: "taskCode", width: 175, fixed: "left" }, { title: "项目名称", dataIndex: "projectName", width: 210 }, { title: "任务名称", dataIndex: "taskName", width: 240 },
    { title: "责任人", dataIndex: "ownerId", width: 130, render: (v: string) => userLabel(options.data, v) }, { title: "责任部门", dataIndex: "departmentId", width: 140, render: (v: string) => departmentLabel(options.data, v) },
    { title: "优先级", dataIndex: "priority", width: 90, render: (v: string) => priorityLabels[v] ?? v }, { title: "计划开始日期", dataIndex: "plannedStartDate", width: 130, render: dateText }, { title: "截止日期", dataIndex: "dueDate", width: 120, render: dateText },
    { title: "当前状态", dataIndex: "displayStatus", width: 110, render: (v: string) => <StatusTag value={v} /> }, { title: "完成进度", dataIndex: "progress", width: 145, render: (v: number) => <Progress percent={Number(v ?? 0)} size="small" /> },
    { title: "最新进展", dataIndex: "latestProgress", width: 260, ellipsis: true }, { title: "实际完成时间", dataIndex: "completedAt", width: 175, render: (v: string) => v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—" },
    { title: "", key: "__actions", width: 52, fixed: "right", render: (_: unknown, row: TaskRow) => <TaskRowActions row={row} onAction={(key, target) => key === "history" ? setHistory(target) : key === "edit" ? setFormRow(target) : setAction({ action: key as TaskAction, row: target })} /> }
  ];
  return <div><PageHeading title="任务管理" description="以督办任务为维度跟踪责任人、截止日期、完成进度与最新进展。" />
    <Tabs activeKey={statusView} onChange={setStatusView} items={[{ key: "OPEN", label: "未完成" }, { key: "ALL", label: "全部" }, { key: "NORMAL", label: "正常推进" }, { key: "OVERDUE", label: "已延期" }, { key: "COMPLETED", label: "已完成" }, { key: "ABORTED", label: "已中止" }]} />
    <KdosDataTable resource="supervision-tasks" viewKey={`status-${statusView}`} rowKey="id" editable columns={columns} dataSource={table.result.data?.rows} loading={table.result.isLoading} serverData={{ total: table.result.data?.total ?? 0, onQueryChange: (next) => { const statusGroup: AdvancedFilterGroup = statusView === "ALL" ? { logic: "AND", rules: [] } : statusView === "OPEN" ? { logic: "OR", rules: [{ field: "displayStatus", operator: "eq", value: "NORMAL" }, { field: "displayStatus", operator: "eq", value: "OVERDUE" }] } : { logic: "AND", rules: [{ field: "displayStatus", operator: "eq", value: statusView }] }; const groups = [statusGroup, next.filterGroup].filter((group): group is AdvancedFilterGroup => Boolean(group && (group.rules.length || group.groups?.length))); table.setQuery({ ...next, filterGroup: groups.length ? { logic: "AND", rules: [], groups } : { logic: "AND", rules: [] } }); } }}
      toolbar={<>{hasResourcePermission("supervision-tasks", "create") && <Button type="primary" icon={<PlusOutlined />} onClick={() => setFormRow(null)}>创建任务</Button>}<Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button><TablePermissionButton resource="supervision-task-progress" /></>} />
    {formRow !== undefined && <TaskForm open row={formRow ?? undefined} options={options.data} onClose={() => setFormRow(undefined)} onSaved={refresh} />}
    <TaskActionModal action={action?.action} row={action?.row} onClose={() => setAction(undefined)} onSaved={refresh} />
    <TaskHistoryDrawer row={history} onClose={() => setHistory(undefined)} />
  </div>;
}

function DashboardFilters({ form, options, onApply, projectStatus = true }: { form: ReturnType<typeof Form.useForm>[0]; options?: Options; onApply: (values: any) => void; projectStatus?: boolean }) {
  return <Card className="supervision-filter-card"><Form form={form} layout="inline" onFinish={onApply} requiredMark={false}>
    <Form.Item name="projectName" label="项目名称"><Input allowClear placeholder="搜索项目" /></Form.Item>
    {projectStatus && <Form.Item name="displayStatus" label="项目状态"><Select allowClear style={{ width: 130 }} options={[...supervisionDisplayStatusOptions]} /></Form.Item>}
    <Form.Item name="ownerId" label={projectStatus ? "项目负责人" : "任务负责人"}><Select allowClear showSearch optionFilterProp="label" style={{ width: 160 }} options={options?.users.map((item) => ({ value: item.id, label: item.label }))} /></Form.Item>
    <Form.Item name="dueRange" label={projectStatus ? "项目交付日期" : "到期时间"}><DatePicker.RangePicker /></Form.Item>
    <Form.Item><Space><Button type="primary" htmlType="submit">查询</Button><Button onClick={() => { form.resetFields(); onApply({}); }}>重置</Button></Space></Form.Item>
  </Form></Card>;
}

function KpiCards({ items }: { items: Array<{ title: string; value: number | string; suffix?: string; color?: string }> }) {
  return <Row gutter={[16, 16]} className="supervision-kpis">{items.map((item) => <Col xs={12} md={8} xl={24 / items.length} key={item.title}><Card><Statistic title={item.title} value={item.value} suffix={item.suffix} valueStyle={{ color: item.color }} /></Card></Col>)}</Row>;
}

export function SupervisionProjectDashboardPage() {
  const options = useSupervisionOptions(); const [form] = Form.useForm(); const [filters, setFilters] = useState<Record<string, any>>({});
  const params = new URLSearchParams(); if (filters.projectName) params.set("projectName", filters.projectName); if (filters.displayStatus) params.set("displayStatus", filters.displayStatus); if (filters.ownerId) params.set("ownerId", filters.ownerId); if (filters.dueRange?.[0]) params.set("dueFrom", filters.dueRange[0].format("YYYY-MM-DD")); if (filters.dueRange?.[1]) params.set("dueTo", filters.dueRange[1].format("YYYY-MM-DD"));
  const dashboard = useQuery({ queryKey: ["supervision-project-dashboard", params.toString()], queryFn: () => api<any>(`/supervision/dashboard/projects?${params}`) });
  const externalFilter = useMemo<AdvancedFilterGroup>(() => { const rules: any[] = []; if (filters.projectName) rules.push({ field: "projectName", operator: "contains", value: filters.projectName }); if (filters.displayStatus) rules.push({ field: "displayStatus", operator: "eq", value: filters.displayStatus }); if (filters.ownerId) rules.push({ field: "ownerId", operator: "eq", value: filters.ownerId }); if (filters.dueRange?.[0] && filters.dueRange?.[1]) rules.push({ field: "dueDate", operator: "between", min: filters.dueRange[0].format("YYYY-MM-DD"), max: filters.dueRange[1].format("YYYY-MM-DD") }); return { logic: "AND", rules }; }, [filters]);
  const kpi = dashboard.data?.kpi ?? {};
  return <div><PageHeading title="项目管理大屏" description="管理层查看督办项目总体进度、交付风险与计划时间轴。" extra={<Space><TablePermissionButton resource="supervision-project-dashboard" /><Button icon={<ReloadOutlined />} onClick={() => void dashboard.refetch()}>刷新</Button></Space>} />
    <DashboardFilters form={form} options={options.data} onApply={setFilters} />
    <KpiCards items={[{ title: "督办项目总数", value: kpi.total ?? 0 }, { title: "正常推进项目", value: kpi.normal ?? 0, color: "#389e0d" }, { title: "已延期项目", value: kpi.overdue ?? 0, color: "#cf1322" }, { title: "7天内需交付", value: kpi.dueWithin7Days ?? 0, color: "#d46b08" }, { title: "平均项目进度", value: kpi.averageProgress ?? 0, suffix: "%" }]} />
    <Row gutter={[16, 16]}><Col xs={24} xl={16}><Card title="项目甘特图" loading={dashboard.isLoading}><div className="supervision-gantt">{(dashboard.data?.gantt ?? []).map((item: any) => <div className="supervision-gantt-row" key={item.id}><div><strong>{item.projectName}</strong><small>{item.plannedStartDate} → {item.dueDate}</small></div><div className="supervision-gantt-track"><span style={{ width: `${Math.max(4, Number(item.progress ?? 0))}%` }} /><em>{item.progress}%</em></div></div>)}</div></Card></Col>
      <Col xs={24} xl={8}><Card title="项目风险" loading={dashboard.isLoading}><Space direction="vertical" style={{ width: "100%" }}>{(dashboard.data?.risks ?? []).map((item: any) => <Alert key={item.id} type={item.riskType === "已延期" ? "error" : "warning"} showIcon message={item.projectName} description={`${item.riskType} · 交付 ${item.dueDate} · 进度 ${item.progress}%`} />)}{!dashboard.data?.risks?.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有高风险项目" />}</Space></Card></Col></Row>
    <Card title="项目明细表" style={{ marginTop: 16 }}><SupervisionProjectsPage embedded externalFilter={externalFilter} /></Card>
  </div>;
}

export function SupervisionEmployeeDashboardPage() {
  const options = useSupervisionOptions(); const [form] = Form.useForm(); const [filters, setFilters] = useState<Record<string, any>>({}); const [query, setQuery] = useState<PlatformTableQuery>(blankPlatformQuery());
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) }); if (query.search) params.set("search", query.search); if (query.sortField) params.set("sortField", query.sortField); if (query.sortOrder) params.set("sortOrder", query.sortOrder); if (query.filterGroup) params.set("filterGroup", JSON.stringify(query.filterGroup)); if (filters.projectName) params.set("projectName", filters.projectName); if (filters.projectStatus) params.set("projectStatus", filters.projectStatus); if (filters.displayStatus) params.set("displayStatus", filters.displayStatus); if (filters.dueRange?.[0]) params.set("dueFrom", filters.dueRange[0].format("YYYY-MM-DD")); if (filters.dueRange?.[1]) params.set("dueTo", filters.dueRange[1].format("YYYY-MM-DD"));
  const result = useQuery({ queryKey: ["supervision-employee-dashboard", params.toString()], queryFn: () => api<any>(`/supervision/dashboard/my-tasks?${params}`), placeholderData: (previous) => previous }); const kpi = result.data?.kpi ?? {};
  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const columns: any[] = [{ title: "任务编号", dataIndex: "taskCode", width: 170 }, { title: "项目名称", dataIndex: "projectName", width: 200 }, { title: "任务名称", dataIndex: "taskName", width: 220 }, { title: "责任人", dataIndex: "ownerId", width: 130, render: (v: string) => userLabel(options.data, v) }, { title: "截止日期", dataIndex: "dueDate", width: 120 }, { title: "状态", dataIndex: "displayStatus", width: 110, render: (v: string) => <StatusTag value={v} /> }, { title: "进度", dataIndex: "progress", width: 140, render: (v: number) => <Progress percent={Number(v ?? 0)} size="small" /> }, { title: "最新进展", dataIndex: "latestProgress", width: 260 }];
  return <div><PageHeading title="员工待办大屏" description="每天查看本人负责或协作的督办任务，及时更新进展并处理延期事项。" extra={<Space><TablePermissionButton resource="supervision-employee-dashboard" /><Button href="/project-task/supervision/projects" icon={<FolderOpenOutlined />}>查看所有督办项目</Button></Space>} />
    <Card style={{ marginBottom: 16 }} title="查看所有督办项目" extra={<Button type="primary" href="/project-task/supervision/projects" icon={<FolderOpenOutlined />}>进入项目列表</Button>}><Text type="secondary">查看权限范围内的全部督办项目、总体进度和交付状态。</Text></Card>
    <Card className="supervision-filter-card"><Form form={form} layout="inline" onFinish={setFilters} requiredMark={false}><Form.Item name="projectName" label="项目名称"><Input allowClear /></Form.Item><Form.Item name="projectStatus" label="项目状态"><Select allowClear style={{ width: 130 }} options={[...supervisionDisplayStatusOptions]} /></Form.Item><Form.Item name="dueRange" label="到期时间"><DatePicker.RangePicker /></Form.Item><Form.Item name="displayStatus" label="延期状态"><Select allowClear style={{ width: 130 }} options={[{ value: "OVERDUE", label: "已延期" }, { value: "NORMAL", label: "未延期" }]} /></Form.Item><Form.Item><Space><Button type="primary" htmlType="submit">查询</Button><Button onClick={() => { form.resetFields(); setFilters({}); }}>重置</Button></Space></Form.Item></Form></Card>
    <KpiCards items={[{ title: "我的未完成任务", value: kpi.unfinished ?? 0 }, { title: "今日到期", value: kpi.dueToday ?? 0, color: "#d46b08" }, { title: "本周到期", value: kpi.dueThisWeek ?? 0 }, { title: "已延期", value: kpi.overdue ?? 0, color: "#cf1322" }]} />
    <Card title="本周任务" className="supervision-week"><Row gutter={[8, 8]}>{weekdays.map((weekday, index) => { const day = dayjs().startOf("week").add(index + (dayjs().day() === 0 ? -6 : 1), "day"); const tasks = (result.data?.week ?? []).filter((task: any) => task.dueDate === day.format("YYYY-MM-DD")); return <Col xs={24} sm={12} lg={24 / 7} key={weekday}><div className={day.isSame(dayjs(), "day") ? "today" : ""}><strong>{weekday}</strong><small>{day.format("MM-DD")}</small>{tasks.map((task: any) => <Tag key={task.id} color={task.dueDate < dayjs().format("YYYY-MM-DD") ? "red" : "blue"}>{task.taskName}</Tag>)}{!tasks.length && <Text type="secondary">无到期任务</Text>}</div></Col>; })}</Row></Card>
    <Card title="任务明细" style={{ marginTop: 16 }}><KdosDataTable resource="supervision-tasks" rowKey="id" columns={columns} dataSource={result.data?.rows} loading={result.isLoading} serverData={{ total: result.data?.total ?? 0, onQueryChange: setQuery }} /></Card>
  </div>;
}

type ReportPeriod = "week" | "month" | "quarter" | "custom";
function periodRange(period: ReportPeriod, custom?: [Dayjs, Dayjs]) { const now = dayjs(); if (period === "week") return [now.startOf("week").add(1, "day"), now.endOf("week").add(1, "day")] as const; if (period === "quarter") { const month = Math.floor(now.month() / 3) * 3; const start = now.month(month).startOf("month"); return [start, start.add(2, "month").endOf("month")] as const; } if (period === "custom" && custom) return custom; return [now.startOf("month"), now.endOf("month")] as const; }

export function SupervisionOwnerReportPage() {
  const options = useSupervisionOptions(); const [period, setPeriod] = useState<ReportPeriod>("month"); const [custom, setCustom] = useState<[Dayjs, Dayjs]>(); const [filters, setFilters] = useState<Record<string, any>>({}); const [pageQuery, setPageQuery] = useState<PlatformTableQuery>(blankPlatformQuery()); const [drillOwner, setDrillOwner] = useState<any>();
  const range = periodRange(period, custom); const params = new URLSearchParams({ startDate: range[0].format("YYYY-MM-DD"), endDate: range[1].format("YYYY-MM-DD"), page: String(pageQuery.page), pageSize: String(pageQuery.pageSize) }); for (const key of ["projectName", "departmentId", "ownerId"] as const) if (filters[key]) params.set(key, filters[key]); if (pageQuery.search) params.set("search", pageQuery.search); if (pageQuery.sortField) params.set("sortField", pageQuery.sortField); if (pageQuery.sortOrder) params.set("sortOrder", pageQuery.sortOrder);
  const report = useQuery({ queryKey: ["supervision-owner-report", params.toString()], queryFn: () => api<any>(`/supervision/reports/owners?${params}`), placeholderData: (previous) => previous }); const kpi = report.data?.kpi ?? {};
  const columns: any[] = [
    { title: "责任人", dataIndex: "ownerName", width: 130, fixed: "left", render: (v: string, row: any) => <Button type="link" onClick={() => setDrillOwner(row)}>{v}</Button> }, { title: "责任部门", dataIndex: "departmentName", width: 140 }, { title: "总任务数", dataIndex: "totalTasks", width: 105 },
    { title: "按期完成", dataIndex: "onTimeCompleted", width: 105 }, { title: "逾期完成", dataIndex: "lateCompleted", width: 105 }, { title: "当前延期未完成", dataIndex: "currentlyOverdue", width: 145 }, { title: "延期任务数", dataIndex: "overdueTasks", width: 115 },
    { title: "未到期未完成", dataIndex: "notDueIncomplete", width: 135 }, { title: "已中止", dataIndex: "aborted", width: 90 }, { title: "按期完成比例", dataIndex: "onTimeRate", width: 145, render: (v: number) => <Progress percent={Number(v)} size="small" /> }, { title: "平均延期天数", dataIndex: "averageDelayDays", width: 135, render: (v: number) => `${v} 天` }
  ];
  return <div><PageHeading title="责任人任务完成报表" description="固定按任务截止日期落入统计周期；已中止任务不进入绩效分母。点击责任人可下钻同口径任务。" />
    <Card className="supervision-filter-card"><Flex gap={12} wrap align="center"><Select value={period} onChange={setPeriod} options={[{ value: "week", label: "本周" }, { value: "month", label: "本月" }, { value: "quarter", label: "本季度" }, { value: "custom", label: "自定义日期" }]} />{period === "custom" && <DatePicker.RangePicker onChange={(value) => setCustom(value?.[0] && value[1] ? [value[0], value[1]] : undefined)} />}<Input placeholder="项目名称" allowClear style={{ width: 180 }} onChange={(event) => setFilters((current) => ({ ...current, projectName: event.target.value }))} /><Select placeholder="责任部门" allowClear style={{ width: 160 }} options={options.data?.departments.map((item) => ({ value: item.id, label: item.pathLabel ?? item.name }))} onChange={(value) => setFilters((current) => ({ ...current, departmentId: value }))} /><Select placeholder="任务负责人" allowClear showSearch optionFilterProp="label" style={{ width: 160 }} options={options.data?.users.map((item) => ({ value: item.id, label: item.label }))} onChange={(value) => setFilters((current) => ({ ...current, ownerId: value }))} /></Flex></Card>
    <KpiCards items={[{ title: "统计责任人数", value: kpi.owners ?? 0 }, { title: "总任务数", value: kpi.totalTasks ?? 0 }, { title: "按期完成数", value: kpi.onTimeCompleted ?? 0, color: "#389e0d" }, { title: "延期任务数", value: kpi.overdueTasks ?? 0, color: "#cf1322" }, { title: "整体按期完成率", value: kpi.onTimeRate ?? 0, suffix: "%" }]} />
    <Card title="按责任人完成率" style={{ marginBottom: 16 }}><div className="supervision-owner-bars">{(report.data?.chartRows ?? []).map((row: any) => <div key={`${row.ownerId}-${row.departmentId}`}><span>{row.ownerName}</span><Progress percent={Number(row.onTimeRate)} status={Number(row.onTimeRate) < 70 ? "exception" : "normal"} /></div>)}</div></Card>
    <KdosDataTable resource="supervision-owner-report" rowKey={(row: any) => `${row.ownerId}-${row.departmentId ?? "none"}`} columns={columns} dataSource={report.data?.rows} loading={report.isLoading} serverData={{ total: report.data?.total ?? 0, onQueryChange: setPageQuery }} />
    <OwnerDrillDrawer owner={drillOwner} params={params} options={options.data} onClose={() => setDrillOwner(undefined)} />
  </div>;
}

function OwnerDrillDrawer({ owner, params, options, onClose }: { owner?: any; params: URLSearchParams; options?: Options; onClose: () => void }) {
  const [query, setQuery] = useState<PlatformTableQuery>(blankPlatformQuery()); const drill = new URLSearchParams(params); for (const key of ["page", "pageSize", "search", "sortField", "sortOrder", "filterGroup"]) drill.delete(key); drill.set("page", String(query.page)); drill.set("pageSize", String(query.pageSize)); if (query.search) drill.set("search", query.search); if (query.sortField) drill.set("sortField", query.sortField); if (query.sortOrder) drill.set("sortOrder", query.sortOrder); if (query.filterGroup) drill.set("filterGroup", JSON.stringify(query.filterGroup));
  const tasks = useQuery({ queryKey: ["supervision-owner-drill", owner?.ownerId, drill.toString()], queryFn: () => api<any>(`/supervision/reports/owners/${owner.ownerId}/tasks?${drill}`), enabled: Boolean(owner), placeholderData: (previous) => previous });
  const classification: Record<string, string> = { ON_TIME: "按期完成", LATE_COMPLETED: "逾期完成", CURRENTLY_OVERDUE: "当前延期未完成", NOT_DUE: "未到期未完成", ABORTED: "已中止" };
  const columns: any[] = [{ title: "任务编号", dataIndex: "taskCode", width: 170 }, { title: "项目名称", dataIndex: "projectName", width: 200 }, { title: "任务名称", dataIndex: "taskName", width: 220 }, { title: "责任部门", dataIndex: "departmentId", width: 140, render: (v: string) => departmentLabel(options, v) }, { title: "截止日期", dataIndex: "dueDate", width: 120 }, { title: "实际完成时间", dataIndex: "completedAt", width: 170, render: (v: string) => v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—" }, { title: "统计分类", dataIndex: "classification", width: 150, render: (v: string) => <Tag color={v.includes("OVERDUE") || v.includes("LATE") ? "red" : v === "ON_TIME" ? "green" : "default"}>{classification[v] ?? v}</Tag> }];
  return <Drawer title={owner ? `${owner.ownerName} · 任务统计明细` : "任务统计明细"} width="85vw" open={Boolean(owner)} onClose={onClose} destroyOnClose>{owner && <KdosDataTable resource="supervision-tasks" rowKey="id" columns={columns} dataSource={tasks.data?.rows} loading={tasks.isLoading} serverData={{ total: tasks.data?.total ?? 0, onQueryChange: setQuery }} />}</Drawer>;
}

export function OrderProjectPlaceholderPage() {
  return <div className="supervision-placeholder"><Empty image={<FileAddOutlined />} description={<><Title level={4}>订单项目管理</Title><Paragraph type="secondary">第二阶段，暂未启用。本阶段没有创建订单项目数据库、接口或业务页面。</Paragraph></>} /></div>;
}
