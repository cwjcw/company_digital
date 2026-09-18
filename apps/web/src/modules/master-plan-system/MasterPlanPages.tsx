/* eslint-disable react-refresh/only-export-components -- 工序配色/进度格式化等纯函数与页面组件同文件，供测试与表格渲染共用 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, DatePicker, Dropdown, Flex, Form, Input, InputNumber, message, Modal, Select, Space, Switch, Tabs, Tag, Upload, Tooltip} from "antd";
import { DownloadOutlined, MoreOutlined, SyncOutlined, UploadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { masterPlanResourceDefinitions, type TablePermissionFieldDefinition } from "@kdos/contracts";
import { api } from "../../api";
import { hasFieldPermission, hasResourcePermission, KdosDataTable, useKdosTableEditMode, type KdosTableSelection } from "../../shared/KdosDataTable";
import { PageHeader } from "../../shared/legacy-ui";
import { OrganizationSelect, type OrganizationSelectOption } from "../../shared/OrganizationSelect";
import type { AuditDirectoryUser } from "../../shared/audit-fields";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { AdvancedFilterGroup } from "../../shared/advanced-filter";

type TableQuery = { page: number; pageSize: number; search: string; filters: Record<string, string>; filterGroup?: AdvancedFilterGroup; sortField?: string; sortOrder?: "asc" | "desc" };
type PendingField = TablePermissionFieldDefinition & { input: boolean };
type ProcessOption = { code: string; name: string; order: number };
type Metadata = { resource: string; fields: TablePermissionFieldDefinition[]; createFields: TablePermissionFieldDefinition[]; pendingFields?: PendingField[]; processes?: ProcessOption[]; actions: { create: boolean; update: boolean; delete: boolean; import: boolean; export: boolean; batchUpdate: boolean; viewWeekly?: boolean; reportProcess?: boolean } };
type Reconciliation = { status: string; message: string | null };
/** 报工类资源写入后需要联动失效的事业部计划视图（周计划/月度计划都直接展示执行汇总）。 */
const reportDependentResources = ["mps-weekly-plans", "mps-monthly-plans"];
const reportResources = new Set(["mps-process-reports", "mps-weekly-process-plans", "mps-material-reports", "mps-outsourcing-reports", "mps-technical-reports"]);
const initialQuery: TableQuery = { page: 1, pageSize: 50, search: "", filters: {} };
const auditFields = new Set(["createdBy", "createdAt", "updatedBy", "updatedAt"]);
const definitionMap = new Map(masterPlanResourceDefinitions.map((entry) => [entry.code, entry]));
/** KN-MPS-WO-001：3天生产工单（只能由“从周计划同步”生成）。 */
const WORK_ORDER_RESOURCE = "mps-three-day-work-orders";
/** 只在打印/合并展示中使用、不作为普通表格列的服务端派生字段。 */
const WORK_ORDER_MERGED_FIELDS = new Set(["productionDateRange", "productionStartDate", "productionEndDate", "weeklyPlanId"]);

function pageUrl(resource: string, query: TableQuery, view: string, basePlanId?: string) {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), view });
  if (query.search) params.set("search", query.search);
  if (Object.values(query.filters).some((value) => value.trim())) params.set("filters", JSON.stringify(query.filters));
  if (query.filterGroup?.rules?.length) params.set("filterGroup", JSON.stringify(query.filterGroup));
  if (query.sortField) params.set("sortField", query.sortField);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  if (basePlanId) params.set("basePlanId", basePlanId);
  return `/master-plan-system/resources/${resource}?${params}`;
}

function FieldInput({ field, organizations = [], users = [], weeklyPlans = [], ...control }: { field: TablePermissionFieldDefinition; organizations?: OrganizationSelectOption[]; users?: AuditDirectoryUser[]; weeklyPlans?: Array<{ id: string; label: string }> } & Record<string, any>) {
  if (field.type === "boolean") return <Switch {...control} />;
  if (field.type === "number") return <InputNumber {...control} min={0} precision={field.key.includes("Days") || ["deliveryNumber", "intervalMinutes", "plannedPageCount", "orderWeekCount"].includes(field.key) ? 0 : 4} style={{ width: "100%" }} />;
  if (field.type === "date") return <DatePicker {...control} style={{ width: "100%" }} />;
  if (field.key === "weeklyPlanId") return <Select {...control} showSearch optionFilterProp="label" placeholder="按订单编号、品项或交期编码选择" options={weeklyPlans.map((plan) => ({ value: plan.id, label: plan.label }))} />;
  if (field.type === "dictionary" && field.options?.length) return <Select {...control} options={field.options} />;
  if (field.type === "department") return <OrganizationSelect {...control} organizations={organizations} placeholder="选择完整组织路径" />;
  if (field.type === "member") return <Select {...control} showSearch optionFilterProp="label" allowClear placeholder="选择成员" options={users.filter((user) => user.enabled).map((user) => ({ value: user.id, label: user.displayName?.trim() || user.username }))} />;
  return <Input.TextArea {...control} autoSize={{ minRows: 1, maxRows: 4 }} />;
}

function display(value: unknown, field: TablePermissionFieldDefinition, row: any) {
  if (field.key === "weeklyPlanState") return <Tag color={({ "待完善": "default", "已具备条件": "processing", "已进入周计划": "success" } as Record<string, string>)[String(value)]}>{value ? String(value) : "—"}</Tag>;
  if (field.key === "weeklyPlanMissingFields") return value ? `缺少：${String(value)}` : "—";
  if (field.key === "weeklyPlanGenerationIssue") return value ? <Tag color="error">生成失败：{String(value)}</Tag> : "—";
  if (field.type === "boolean") return <Tag color={value ? "success" : "default"}>{value ? "是" : "否"}</Tag>;
  if (field.type === "department" && row.divisionName) return row.divisionName;
  if (field.key === "weeklyPlanId" && row.weeklyPlanLabel) return row.weeklyPlanLabel;
  if (field.type === "dictionary" && value != null) return field.options?.find((option) => option.value === String(value))?.label ?? String(value);
  if (field.type === "date" && value) return dayjs(String(value)).format("YYYY-MM-DD");
  /* KN-MPS-WO-001：简图列保持紧凑，绝不把附件 JSON 原样铺进表格。 */
  if (field.type === "attachment") {
    const items = Array.isArray(value) ? value : [];
    if (!items.length) return "—";
    const first = items[0] as unknown;
    const label = typeof first === "string" ? first : String((first as { name?: string; url?: string })?.name ?? (first as { url?: string })?.url ?? "附件");
    return items.length > 1 ? `${label} 等 ${items.length} 个` : label;
  }
  if (field.key === "completionRate") return `${Math.round(Number(value || 0) * 100)}%`;
  if (field.key === "exceptionSummary") return value ? String(value) : "—";
  if (value && typeof value === "object") return JSON.stringify(value);
  return value == null || value === "" ? "—" : String(value);
}

/**
 * KN-MPS-EXEC-001 工序低饱和配色（唯一来源：process.order）。三层：一级表头较明显、二级表头更浅、数据单元格极浅。
 * 周计划与月计划使用同一函数 → 同一工序颜色稳定一致；新增工序时无需改代码。
 */
const PROCESS_PALETTE = [
  { header: "#e8f0fb", sub: "#f2f7fd", cell: "#f9fbfe", text: "#1f4e79" },
  { header: "#fdf0e3", sub: "#fef7ef", cell: "#fffbf7", text: "#8a4b12" },
  { header: "#e9f5ec", sub: "#f3faf5", cell: "#fafdfb", text: "#1f6b3a" },
  { header: "#f3edfa", sub: "#f8f4fc", cell: "#fcfafe", text: "#5b3d8a" },
  { header: "#fdeeee", sub: "#fef6f6", cell: "#fffbfb", text: "#8a2f2f" },
  { header: "#eaf4f6", sub: "#f3f9fa", cell: "#f9fcfd", text: "#155e6b" },
  { header: "#f6f2e6", sub: "#faf8f0", cell: "#fdfcf7", text: "#6b5a17" },
  { header: "#eef0f6", sub: "#f5f6fa", cell: "#fafbfd", text: "#3d4a6b" },
  { header: "#f0eef5", sub: "#f7f5fa", cell: "#fbfafd", text: "#4f3f6b" },
  { header: "#eef5ee", sub: "#f5faf5", cell: "#fbfdfb", text: "#2f5d3a" }
];
export function processColor(order: number) {
  const index = Math.max(0, (Math.trunc(order) || 1) - 1) % PROCESS_PALETTE.length;
  return PROCESS_PALETTE[index]!;
}
/** 工序语义 class token：测试与主题都基于 token，不依赖具体 RGB。 */
export const processColorClass = (code: string) => `kdos-process kdos-process-${code}`;

/** 未取到服务端工序定义时的兜底顺序（唯一权威定义在 @tracker/shared，服务端通过 metadata.processes 下发）。 */
const fallbackProcessGroups: ProcessOption[] = [
  { code: "cutting", name: "下料", order: 1 }, { code: "machining", name: "机加", order: 2 }, { code: "bending", name: "折弯", order: 3 },
  { code: "spotWelding", name: "点焊", order: 4 }, { code: "welding", name: "焊接", order: 5 }, { code: "woodworking", name: "木作", order: 6 },
  { code: "grinding", name: "研磨", order: 7 }, { code: "blank", name: "毛坯", order: 8 },
  { code: "surfaceTreatment", name: "表面处理", order: 9 }, { code: "packaging", name: "包装", order: 10 }
];

function InlineMasterPlanCell({ resource, field, row, value, organizations, users, weeklyPlans, onSave }: {
  resource: string; field: TablePermissionFieldDefinition; row: any; value: unknown;
  organizations: OrganizationSelectOption[]; users: AuditDirectoryUser[]; weeklyPlans: Array<{ id: string; label: string }>;
  onSave: (row: any, field: TablePermissionFieldDefinition, value: unknown) => Promise<void>;
}) {
  const { editing } = useKdosTableEditMode(); const [draft, setDraft] = useState<any>(value); const [saving, setSaving] = useState(false); const lock = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const editable = editing && row.canUpdate !== false && field.editable && hasFieldPermission(resource, field.key, "update");
  if (!editable) return <>{display(value, field, row)}</>;
  const commit = async (next = draft) => {
    const normalized = next?.format ? next.format("YYYY-MM-DD") : next;
    const previous = value == null ? null : String(value); const comparable = normalized == null || normalized === "" ? null : String(normalized);
    if (lock.current || previous === comparable) return;
    lock.current = true; setSaving(true);
    try { await onSave(row, field, normalized); }
    catch { setDraft(value); }
    finally { lock.current = false; setSaving(false); }
  };
  if (field.type === "boolean") return <Switch size="small" checked={Boolean(draft)} loading={saving} onChange={(next) => { setDraft(next); void commit(next); }} />;
  if (field.type === "date") return <DatePicker size="small" value={draft ? dayjs(draft) : null} disabled={saving} onChange={(next) => { setDraft(next); void commit(next); }} style={{ width: "100%" }} />;
  if (field.type === "dictionary") return <Select size="small" value={draft || undefined} allowClear disabled={saving} onChange={(next) => { setDraft(next); void commit(next); }} options={field.options ?? []} style={{ width: "100%" }} />;
  if (field.type === "department") return <OrganizationSelect size="small" value={draft || undefined} disabled={saving} organizations={organizations} onChange={(next) => { setDraft(next); void commit(next); }} />;
  if (field.type === "member") return <Select size="small" value={draft || undefined} allowClear showSearch optionFilterProp="label" disabled={saving} options={users.filter((user) => user.enabled).map((user) => ({ value: user.id, label: user.displayName?.trim() || user.username }))} onChange={(next) => { setDraft(next); void commit(next); }} style={{ width: "100%" }} />;
  if (field.key === "weeklyPlanId") return <Select size="small" value={draft || undefined} showSearch optionFilterProp="label" disabled={saving} options={weeklyPlans.map((plan) => ({ value: plan.id, label: plan.label }))} onChange={(next) => { setDraft(next); void commit(next); }} style={{ width: "100%" }} />;
  if (field.type === "number") return <InputNumber size="small" value={draft as any} min={0} disabled={saving} onChange={setDraft} onBlur={() => void commit()} onPressEnter={(event) => { event.currentTarget.blur(); }} style={{ width: "100%" }} />;
  return <Input size="small" value={draft == null ? "" : String(draft)} disabled={saving} onChange={(event) => setDraft(event.target.value)} onBlur={() => void commit()} onPressEnter={(event) => event.currentTarget.blur()} />;
}

/** 待报工任务的本次报工数量/生产日期是草稿输入，不写回任务行；提交时才 CREATE 实际报工记录。 */
/*
 * KN-MPS-UI-001：待报工行内填报的输入列来自统一权威定义（本次报工数量 / 生产日期 / 异常）。
 * 异常是可选人工文本，只有用户填写才写入本次报工事实；系统不会自动生成异常。
 */
type PendingDraft = { quantity?: number | null; date?: Dayjs | null; exceptionText?: string | null };
function PendingReportCell({ field, draft, onChange }: { field: PendingField; draft?: PendingDraft; onChange: (patch: PendingDraft) => void }) {
  const { editing } = useKdosTableEditMode();
  if (!editing) return <>{field.key === "exceptionText" ? (draft?.exceptionText ? String(draft.exceptionText) : "—") : draft?.quantity ? String(draft.quantity) : "—"}</>;
  if (field.key === "exceptionText") return <Input size="small" value={draft?.exceptionText ?? ""} placeholder="可选：人工确认的异常" onChange={(event) => onChange({ exceptionText: event.target.value })} style={{ width: "100%" }} />;
  if (field.type === "date") return <DatePicker size="small" value={draft?.date ?? dayjs()} allowClear onChange={(next) => onChange({ date: next })} style={{ width: "100%" }} />;
  return <InputNumber size="small" min={0} precision={4} value={draft?.quantity ?? null} placeholder="本次报工" onChange={(next) => onChange({ quantity: next == null ? null : Number(next) })} style={{ width: "100%" }} />;
}

/** 提交入口放在编辑模式工具栏，不新增独立“操作”列；未进入编辑模式时不显示。 */
function PendingReportSubmit({ count, submitting, onSubmit }: { count: number; submitting: boolean; onSubmit: () => void }) {
  const { editing } = useKdosTableEditMode();
  if (!editing) return null;
  return <Button type="primary" loading={submitting} disabled={!count} onClick={onSubmit}>提交报工{count ? `（${count}）` : ""}</Button>;
}

/**
 * KN-MPS-EXEC-001：工序分组必须由 canonical process registry 动态生成（结构来自工序定义，字段只是组内可见列）。
 * 之前“字段不存在就不建组”的做法会让权限组只勾选部分字段时整个工序名消失；现在始终生成 10 个工序组，
 * 顺序严格按 process.order，组内只渲染当前用户可读的列：周期 / 交期 / 状态 / 生产进度。
 * 每个工序异常不再单列，异常统一到整表唯一的「异常」列（exceptionSummary）。
 * KN-MPS-UI-001：主表只显示管理字段；*ReportedQuantity / *ReportCount / *DispatchedQuantity 属于
 * 辅助计算字段，即使 metadata 里因为兼容仍存在，也不得自动落入 leading columns。
 */
const MASTER_PLAN_SUPPORT_FIELD_SUFFIXES = ["ReportedQuantity", "ReportCount", "DispatchedQuantity"];
export function isMasterPlanSupportField(key: string) {
  return MASTER_PLAN_SUPPORT_FIELD_SUFFIXES.some((suffix) => key.endsWith(suffix));
}

/**
 * KN-MPS-UI-001：辅助计划一级分组的**唯一正式定义**（标题、顺序、语义只有一份来源，周计划与月计划共用）。
 * 结构与标题由该定义决定，与字段权限解耦：字段权限只决定组内哪些字段可读，
 * 绝不允许“少一个子字段读权限 → 整个一级分组标题消失”。
 * 组内字段顺序同样取自定义，保证同一分组在周计划/月计划中的子列顺序一致。
 */
export const auxiliaryPlanGroups: Array<{ key: string; title: string; fields: string[] }> = [
  { key: "technical", title: "技术/图纸计划", fields: ["technicalCycleDays", "drawingDueDate", "technicalStatus"] },
  { key: "hardware", title: "五金主材计划", fields: ["hardwareCycleDays", "hardwareDueDate", "hardwareStatus"] },
  { key: "wood", title: "木作主材计划", fields: ["woodCycleDays", "woodDueDate", "woodStatus"] },
  { key: "outsourcing", title: "外协计划", fields: ["outsourcingCycleDays", "outsourcingDueDate", "outsourcingStatus", "outsourcingActualInboundDate"] }
];
/** 辅助计划分组占用的字段键（用于保证它们绝不落入普通 leading columns）。 */
const auxiliaryPlanFieldKeys = new Set(auxiliaryPlanGroups.flatMap((group) => group.fields));

/**
 * KN-MPS-WO-001：3天生产工单的「生产日期」是一个日期范围列（RangePicker 一次编辑两个原子字段），
 * 表格不显示 生产开始日期/生产结束日期 两个网页列，也不显示服务端合并列与来源周计划 UUID。
 */
function workOrderColumns(
  fields: TablePermissionFieldDefinition[],
  renderCell: ((value: unknown, field: TablePermissionFieldDefinition, row: any) => React.ReactNode) | undefined,
  onSaveRange: (row: any, values: { productionStartDate: string | null; productionEndDate: string | null }) => void
) {
  const columns: any[] = [];
  for (const field of fields) {
    if (WORK_ORDER_MERGED_FIELDS.has(field.key) && field.key !== "productionStartDate") continue;
    if (field.key === "productionStartDate") {
      columns.push({
        title: "生产日期", dataIndex: "productionStartDate", width: 230,
        render: (_: unknown, row: any) => <ProductionDateCell row={row} onSaveRange={onSaveRange} />
      });
      continue;
    }
    const width = ["orderNumber", "itemName", "remark", "processingRemark"].includes(field.key) ? 220 : field.type === "attachment" ? 110 : Math.max(105, Math.min(240, field.label.length * 18 + 54));
    columns.push({ title: field.label, dataIndex: field.key, width, render: (value: unknown, row: any) => renderCell ? renderCell(value, field, row) : display(value, field, row) });
  }
  return columns;
}

/** 生产日期单元格：只读时显示范围文本；编辑模式提供 RangePicker，一次 PATCH 两个字段（带 expectedVersion）。 */
export function ProductionDateCell({ row, onSaveRange }: { row: any; onSaveRange: (row: any, values: { productionStartDate: string | null; productionEndDate: string | null }) => void }) {
  const { editing } = useKdosTableEditMode();
  const start = row?.productionStartDate ? dayjs(String(row.productionStartDate)) : null;
  const end = row?.productionEndDate ? dayjs(String(row.productionEndDate)) : null;
  if (!editing) return <>{formatProductionDateRange(row?.productionStartDate, row?.productionEndDate)}</>;
  return <DatePicker.RangePicker size="small" allowEmpty={[true, true]} value={[start, end]} style={{ width: "100%" }}
    onChange={(range) => {
      const nextStart = range?.[0] ? range[0].format("YYYY-MM-DD") : null;
      const nextEnd = range?.[1] ? range[1].format("YYYY-MM-DD") : null;
      onSaveRange(row, { productionStartDate: nextStart, productionEndDate: nextEnd });
    }} />;
}

/** 生产日期范围展示：同日显示单日，否则显示「开始 ～ 结束」，都为空显示 —。 */
export function formatProductionDateRange(start: unknown, end: unknown) {
  const from = start ? dayjs(String(start)).format("YYYY-MM-DD") : null;
  const to = end ? dayjs(String(end)).format("YYYY-MM-DD") : null;
  if (!from && !to) return "—";
  if (from && !to) return from;
  if (!from && to) return to;
  return from === to ? from : `${from} ～ ${to}`;
}

/** KN-MPS-WO-001：同步结果反馈文案（不满足于“同步成功”，必须给出 scanned/created/updated/unchanged）。 */
export function formatWorkOrderSyncResult(result: { created: number; updated: number; unchanged: number; skipped?: number }) {
  return `同步完成：新增 ${result.created} 条，更新 ${result.updated} 条，未变化 ${result.unchanged} 条${result.skipped ? `，跳过 ${result.skipped} 条` : ""}`;
}

function groupedColumns(resource: string, fields: TablePermissionFieldDefinition[], renderCell?: (value: unknown, field: TablePermissionFieldDefinition, row: any) => React.ReactNode, processes: ProcessOption[] = fallbackProcessGroups, onSaveRange?: (row: any, values: { productionStartDate: string | null; productionEndDate: string | null }) => void) {
  const column = (field: TablePermissionFieldDefinition) => ({
    title: field.label.includes("·") ? field.label.split("·")[1] : field.label,
    dataIndex: field.key,
    width: Math.max(105, Math.min(240, field.label.length * 18 + 54)),
    render: (value: unknown, row: any) => renderCell ? renderCell(value, field, row) : display(value, field, row)
  });
  const progressColumn = (field: TablePermissionFieldDefinition, process: ProcessOption, resourceCode: string) => ({
    title: "生产进度",
    dataIndex: field.key,
    width: 120,
    className: processColorClass(process.code),
    onCell: (row: any) => ({ className: progressCellClass(row?.[field.key]), style: progressCellStyle(row?.[field.key]) }),
    render: (value: unknown, row: any) => <MasterPlanProgressCell process={process} row={row} value={value} resource={resourceCode} />
  });
  const exceptionColumn = (field: TablePermissionFieldDefinition) => ({
    title: "异常",
    dataIndex: field.key,
    width: 280,
    ellipsis: { showTitle: false } as const,
    render: (value: unknown) => value
      ? <Tooltip title={String(value)}><span className="kdos-exception-summary">{String(value)}</span></Tooltip>
      : "—"
  });
  if (resource === WORK_ORDER_RESOURCE) return workOrderColumns(fields, renderCell, onSaveRange ?? (() => undefined));
  if (!["mps-monthly-plans", "mps-weekly-plans"].includes(resource)) return fields.map(column);
  const grouped = new Set<string>();
  const groups: any[] = [];
  /* 辅助计划分组：结构与标题来自唯一正式定义（周/月一致），组内只渲染当前用户可读字段。 */
  for (const key of auxiliaryPlanFieldKeys) grouped.add(key);
  for (const group of auxiliaryPlanGroups) {
    const children = group.fields
      .map((key) => fields.find((field) => field.key === key))
      .filter((field): field is TablePermissionFieldDefinition => Boolean(field))
      .map((field) => ({ ...column(field), onHeaderCell: () => ({ className: "kdos-auxiliary-group-sub" }) }));
    /* 权限组未授予该分组任何字段读权限时，仍保留一级分组标题（结构由正式定义决定），组内占位不泄露数据。 */
    const safeChildren = children.length ? children : [{
      title: "无可见字段", dataIndex: `auxiliary-${group.key}-placeholder`, width: 90,
      render: () => "—",
      onHeaderCell: () => ({ className: "kdos-auxiliary-group-sub" })
    }];
    groups.push({
      title: group.title,
      key: `auxiliary-${group.key}`,
      className: "kdos-auxiliary-group",
      onHeaderCell: () => ({ className: "kdos-auxiliary-group-head" }),
      children: safeChildren
    });
  }
  for (const process of [...processes].sort((left, right) => left.order - right.order)) {
    const color = processColor(process.order);
    /* 工序组结构永远生成（与字段权限解耦）；组内只放可读字段：周期 / 交期 / 状态 / 生产进度。 */
    const children = fields
      .filter((field) => ["CycleDays", "DueDate", "Status", "ProductionProgress"].some((suffix) => field.key === `${process.code}${suffix}`))
      .map((field) => {
        const base = field.key.endsWith("ProductionProgress") ? progressColumn(field, process, resource) : column(field);
        return {
          ...base,
          onHeaderCell: () => ({ className: `${processColorClass(process.code)} kdos-process-sub`, style: { background: color.sub, color: color.text } })
        };
      });
    children.forEach((child) => grouped.add(child.dataIndex as string));
    /* 权限组未授予该工序任何字段读权限时，仍保留工序名称（结构由 canonical registry 决定），组内占位不泄露数据。 */
    const safeChildren = children.length ? children : [{
      title: "无可见字段", dataIndex: `process-${process.code}-placeholder`, width: 90,
      render: () => "—",
      onHeaderCell: () => ({ className: `${processColorClass(process.code)} kdos-process-sub`, style: { background: color.sub, color: color.text } })
    }];
    groups.push({
      title: process.name,
      key: `process-${process.code}`,
      className: processColorClass(process.code),
      onHeaderCell: () => ({ className: `${processColorClass(process.code)} kdos-process-head`, style: { background: color.header, color: color.text } }),
      children: safeChildren
    });
  }
  /* KN-MPS-EXEC-001：所有 *Exception 字段（10 个工序异常 + 技术/五金/木作/外协异常）不再单列展示，
     其内容已统一汇总到整表唯一的「异常」列；字段本体仍保留在 metadata 中供筛选/导出/兼容使用。 */
  for (const field of fields) if (field.key.endsWith("Exception")) grouped.add(field.key);
  const leading = fields
    .filter((field) => !grouped.has(field.key) && field.key !== "exceptionSummary" && !isMasterPlanSupportField(field.key))
    .map(column);
  const exceptionField = fields.find((field) => field.key === "exceptionSummary");
  return [...leading, ...groups, ...(exceptionField ? [exceptionColumn(exceptionField)] : [])];
}

/** 生产进度单元格样式：>=100%（ratio>=1）时只高亮该单元格为完成绿，其余工序字段保持工序浅色。 */
export function progressCellClass(value: unknown) {
  const ratio = value == null || value === "" ? null : Number(value);
  return ratio != null && Number.isFinite(ratio) && ratio >= 1 ? "kdos-progress-cell kdos-progress-satisfied" : "kdos-progress-cell";
}
export function progressCellStyle(value: unknown) {
  const ratio = value == null || value === "" ? null : Number(value);
  return ratio != null && Number.isFinite(ratio) && ratio >= 1 ? { background: "#e7f6ec", color: "#1f6b3a", fontWeight: 600 } : undefined;
}
/** 生产进度格式化：需求为 0/NULL → —（不出现 NaN/Infinity）；允许超过 100%（不封顶）。 */
export function formatProductionProgress(value: unknown) {
  const ratio = value == null || value === "" ? null : Number(value);
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  const percent = ratio * 100;
  return `${Number.isInteger(percent) ? percent : Math.round(percent * 10) / 10}%`;
}

/**
 * 生产进度单元格：主表只占一列，Hover 显示需求数量 / 累计报工 / 报工次数 / 生产进度。
 * KN-MPS-UI-001：不再显示「报工次数」；月计划分母是整个订单/月度总需求（requiredQuantity），
 * 已下达周计划数量（月计划唯一字段 dispatchedWeeklyQuantity）只作为辅助信息展示，不参与进度计算。
 */
export function MasterPlanProgressCell({ process, row, value, resource }: { process: ProcessOption; row: any; value: unknown; resource: string }) {
  const monthly = resource === "mps-monthly-plans";
  /* 月计划的分母是整个订单/月度总需求（requiredQuantity）；已下达周计划数量只作为辅助信息展示。 */
  const demand = monthly ? row?.requiredQuantity : row?.plannedQuantity;
  const dispatched = row?.dispatchedWeeklyQuantity;
  const reported = row?.[`${process.code}ReportedQuantity`];
  const text = formatProductionProgress(value);
  const show = (input: unknown, fallback = "—") => input == null || input === "" ? fallback : String(input);
  return <Tooltip title={<div className="kdos-progress-tooltip">
    <div>{monthly ? "月度总需求" : "需求数量"}：{show(demand)}</div>
    {monthly && <div>已下达周计划数量：{show(dispatched)}</div>}
    <div>累计报工：{show(reported)}</div>
    <div>生产进度：{text}</div>
  </div>}>
    <span className={progressCellClass(value)} style={progressCellStyle(value)}>{text}</span>
  </Tooltip>;
}

function RowActions({ metadata, row, onEdit, onDelete, onSync, onReport, onViewWeekly }: { metadata: Metadata; row: any; onEdit: () => void; onDelete: () => void; onSync?: () => void; onReport?: () => void; onViewWeekly?: () => void }) {
  const { editing } = useKdosTableEditMode();
  const items = [
    onViewWeekly ? { key: "viewWeekly", label: "查看周计划", onClick: onViewWeekly } : null,
    editing && metadata.actions.update && row.canUpdate !== false && !row.pendingTask ? { key: "edit", label: "编辑", onClick: onEdit } : null,
    editing && row.pendingTask && metadata.actions.create && onReport ? { key: "report", label: "报工", onClick: onReport } : null,
    editing && onSync ? { key: "sync", label: "立即同步", onClick: onSync } : null,
    metadata.actions.delete && row.canDelete !== false && !row.pendingTask ? { key: "delete", label: "删除", danger: true, onClick: () => Modal.confirm({ title: "确认删除这条记录？", content: "删除后不可恢复。", okText: "删除", okButtonProps: { danger: true }, cancelText: "取消", onOk: onDelete }) } : null
  ].filter(Boolean) as Array<{ key: string; label: string; danger?: boolean; onClick: () => void }>;
  if (!items.length) return null;
  return <Dropdown trigger={["click"]} menu={{ items }} placement="bottomRight">
    <Button type="text" size="small" icon={<MoreOutlined />} aria-label="更多操作" title="更多操作" />
  </Dropdown>;
}

export function MasterPlanResourcePage({ resource }: { resource: string }) {
  const info = definitionMap.get(resource as any);
  const queryClient = useQueryClient(); const navigate = useNavigate(); const [searchParams] = useSearchParams(); const basePlanId = resource === "mps-weekly-plans" ? searchParams.get("basePlanId") ?? undefined : undefined;
  const [tableQuery, setTableQuery] = useState(initialQuery); const [view, setView] = useState("ALL");
  const isPendingView = resource === "mps-process-reports" && view === "PENDING";
  const [pendingDrafts, setPendingDrafts] = useState<Record<string, PendingDraft>>({});
  const [pendingSubmitting, setPendingSubmitting] = useState(false);
  const sessionSubject = (() => { try { return JSON.parse(localStorage.getItem("sessionUser") ?? "{}").sub ?? "anonymous"; } catch { return "anonymous"; } })();
  const [form] = Form.useForm(); const [modal, setModal] = useState<{ mode: "create" | "edit"; row?: any } | null>(null);
  const saveLock = useRef(false); const [saving, setSaving] = useState(false); const [saveError, setSaveError] = useState<string | null>(null);
  const [batchForm] = Form.useForm();
  const [batchSelection, setBatchSelection] = useState<KdosTableSelection<any> | null>(null);
  const [batchField, setBatchField] = useState<TablePermissionFieldDefinition | null>(null);
  const [batchSaving, setBatchSaving] = useState(false);
  const [importPreview, setImportPreview] = useState<{ total: number; errors: Array<{ row: number; reason: string }>; previewId?: string | null; blockedReason?: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const metadata = useQuery({ queryKey: ["mps-meta", sessionSubject, resource], queryFn: () => api<Metadata>(`/master-plan-system/resources/${resource}/meta`), staleTime: 60_000 });
  const organizations = useQuery({ queryKey: ["mps-organization-options", sessionSubject, resource], queryFn: () => api<OrganizationSelectOption[]>(`/master-plan-system/references/organizations?resource=${encodeURIComponent(resource)}`), staleTime: 300_000, enabled: Boolean(metadata.data?.fields.some((field) => field.type === "department")) });
  const users = useQuery({ queryKey: ["mps-directory-users"], queryFn: () => api<AuditDirectoryUser[]>("/directory/users"), staleTime: 300_000 });
  const weeklyPlans = useQuery({ queryKey: ["mps-weekly-plan-options", sessionSubject], queryFn: () => api<Array<{ id: string; label: string }>>("/master-plan-system/references/weekly-plans"), staleTime: 60_000, enabled: ["mps-weekly-process-plans", "mps-material-reports", "mps-process-reports"].includes(resource) && Boolean(metadata.data) });
  const rows = useQuery({ queryKey: ["mps-rows", sessionSubject, resource, tableQuery, view, basePlanId], queryFn: () => api<{ rows: any[]; total: number }>(pageUrl(resource, tableQuery, view, basePlanId)), placeholderData: (previous) => previous, enabled: Boolean(metadata.data), staleTime: 60_000 });
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ["mps-rows", sessionSubject, resource] }), [queryClient, resource, sessionSubject]);
  /* 报工保存后事业部周计划/月度计划展示的执行汇总必须立即失效，不能等 60 秒缓存过期。 */
  const refreshExecutionPlans = useCallback(async () => {
    await Promise.all(reportDependentResources.map((code) => queryClient.invalidateQueries({ queryKey: ["mps-rows", sessionSubject, code] })));
  }, [queryClient, sessionSubject]);
  const applyReconciliationFeedback = useCallback((reconciliation: Reconciliation | undefined, successText: string) => {
    if (reconciliation?.status === "FAILED") { message.warning(reconciliation.message ?? `${successText}，但执行状态同步失败。`); return; }
    if (reconciliation && reconciliation.status !== "SUCCESS") { message.info(reconciliation.message ?? `${successText}，执行状态正在同步，请稍后刷新查看。`); return; }
    message.success(successText);
  }, []);
  const refreshRelatedPlans = useCallback(async () => {
    await Promise.all(["mps-base-plans", "mps-weekly-plans"].map((code) => queryClient.invalidateQueries({ queryKey: ["mps-rows", sessionSubject, code] })));
  }, [queryClient, sessionSubject]);
  /* 基础计划 -> 周计划必须通过稳定 base_plan_id 定位，禁止按订单号/品项/交期模糊搜索。 */
  const viewWeeklyPlan = useCallback((row: any) => {
    const basePlanId = row?.id ? String(row.id) : "";
    if (!basePlanId || !(row?.weeklyPlanId || row?.weeklyPlanState === "已进入周计划")) { message.info("该基础计划尚未生成周计划"); return; }
    navigate(`/master-plan-system/mps-weekly-plans?basePlanId=${encodeURIComponent(basePlanId)}`);
  }, [navigate]);
  const clearWeeklyPlanFilter = useCallback(() => navigate("/master-plan-system/mps-weekly-plans"), [navigate]);
  const saveInline = useCallback(async (row: any, field: TablePermissionFieldDefinition, value: unknown) => {
    try {
      const updated = await api<{ version: number; values: Record<string, unknown>; reconciliation?: Reconciliation }>(`/master-plan-system/resources/${resource}/${row.id}`, { method: "PATCH", body: JSON.stringify({ [field.key]: value, expectedVersion: row.version }) });
      const confirmedValue = updated.values[field.key];
      if (resource === "mps-base-plans") {
        await refreshRelatedPlans();
        if (updated.reconciliation?.status === "FAILED") message.warning(updated.reconciliation.message ?? "基础计划已保存，但周计划生成失败。");
        else if (updated.reconciliation && updated.reconciliation.status !== "SUCCESS") message.info(updated.reconciliation.message ?? "基础计划已保存，周计划正在生成。");
        else message.success(`${field.label}已保存；周计划状态已刷新`);
      } else if (reportResources.has(resource)) {
        queryClient.setQueriesData<{ rows: any[]; total: number }>({ queryKey: ["mps-rows", sessionSubject, resource] }, (current) => current ? { ...current, rows: current.rows.map((entry) => entry.id === row.id ? { ...entry, [field.key]: confirmedValue, version: Number(updated.version) } : entry) } : current);
        await refreshExecutionPlans();
        await refresh();
        applyReconciliationFeedback(updated.reconciliation, `${field.label}已保存；事业部计划已刷新`);
      } else {
        queryClient.setQueriesData<{ rows: any[]; total: number }>({ queryKey: ["mps-rows", sessionSubject, resource] }, (current) => current ? { ...current, rows: current.rows.map((entry) => entry.id === row.id ? { ...entry, [field.key]: confirmedValue, version: Number(updated.version), ...(field.type === "department" ? { divisionName: organizations.data?.find((option) => option.id === confirmedValue)?.pathLabel ?? null } : {}) } : entry) } : current);
        message.success(`${field.label}已保存`);
      }
    } catch (error) { message.error((error as Error).message || `${field.label}保存失败`); throw error; }
  }, [applyReconciliationFeedback, organizations.data, queryClient, refresh, refreshExecutionPlans, refreshRelatedPlans, resource, sessionSubject]);
  /**
   * KN-MPS-WO-001：生产日期一次 PATCH 两个原子字段（productionStartDate + productionEndDate），
   * 仍带 expectedVersion 乐观锁；服务端负责「同时为空或同时有值 + 开始不晚于结束」的最终校验。
   */
  const saveInlineFields = useCallback(async (row: any, values: Record<string, unknown>) => {
    try {
      const updated = await api<{ version: number; values: Record<string, unknown> }>(`/master-plan-system/resources/${resource}/${row.id}`, { method: "PATCH", body: JSON.stringify({ ...values, expectedVersion: row.version }) });
      queryClient.setQueriesData<{ rows: any[]; total: number }>({ queryKey: ["mps-rows", sessionSubject, resource] }, (current) => current ? { ...current, rows: current.rows.map((entry) => entry.id === row.id ? { ...entry, ...updated.values, version: Number(updated.version) } : entry) } : current);
      message.success("生产日期已保存");
    } catch (error) { message.error((error as Error).message || "生产日期保存失败"); throw error; }
  }, [queryClient, resource, sessionSubject]);
  /** KN-MPS-WO-001：从周计划同步（只能用户主动点击，非定时任务）。 */
  const [syncingWorkOrders, setSyncingWorkOrders] = useState(false);
  const syncWorkOrders = useCallback(async () => {
    if (syncingWorkOrders) return;
    setSyncingWorkOrders(true);
    try {
      const result = await api<{ scanned: number; created: number; updated: number; unchanged: number; skipped?: number }>(`/master-plan-system/resources/${WORK_ORDER_RESOURCE}/sync-from-weekly`, { method: "POST" });
      await refresh();
      message.success(formatWorkOrderSyncResult(result));
    } catch (error) { message.error((error as Error).message || "同步失败"); }
    finally { setSyncingWorkOrders(false); }
  }, [refresh, syncingWorkOrders]);
  const editableFields = (metadata.data?.fields ?? []).filter((field) => field.editable && hasFieldPermission(resource, field.key, "update"));
  const formFields = modal?.mode === "create" ? (metadata.data?.createFields ?? []) : editableFields;
  const openCreate = () => { form.resetFields(); setSaveError(null); if (resource === "mps-weekly-process-plans") form.setFieldValue("reportDate", dayjs()); setModal({ mode: "create" }); };
  const openReport = (row: any) => { form.resetFields(); setSaveError(null); form.setFieldsValue({ weeklyPlanId: row.weeklyPlanId, processCode: row.processCode, productionDate: dayjs() }); setModal({ mode: "create", row }); };
  const openEdit = (row: any) => {
    form.resetFields();
    setSaveError(null);
    form.setFieldsValue(Object.fromEntries(editableFields.map((field) => [field.key, field.type === "date" && row[field.key] ? dayjs(row[field.key]) : row[field.key]])));
    setModal({ mode: "edit", row });
  };
  const save = async () => {
    if (saveLock.current) return;
    saveLock.current = true; setSaving(true); setSaveError(null);
    try {
      const values = await form.validateFields();
      const payload = Object.fromEntries(Object.entries(values).map(([key, value]: [string, any]) => [key, value?.format ? value.format("YYYY-MM-DD") : value]));
      const edited = modal?.mode === "edit";
      const saved = edited
        ? await api<{ reconciliation?: Reconciliation }>(`/master-plan-system/resources/${resource}/${modal!.row.id}`, { method: "PATCH", body: JSON.stringify({ ...payload, expectedVersion: modal!.row.version }) })
        : await api<{ reconciliation?: Reconciliation }>(`/master-plan-system/resources/${resource}`, { method: "POST", body: JSON.stringify(payload) });
      setModal(null);
      if (resource === "mps-base-plans") {
        await refreshRelatedPlans();
        if (saved?.reconciliation?.status === "FAILED") message.warning(saved.reconciliation.message ?? "基础计划已保存，但周计划生成失败。");
        else if (saved?.reconciliation && saved.reconciliation.status !== "SUCCESS") message.info(saved.reconciliation.message ?? "基础计划已保存，周计划正在生成。");
        else message.success(edited ? "修改成功；周计划状态已刷新" : "新增成功；周计划状态已刷新");
      } else if (reportResources.has(resource)) {
        await refreshExecutionPlans();
        await refresh();
        applyReconciliationFeedback(saved?.reconciliation, edited ? "修改成功；事业部计划已刷新" : "报工成功；事业部计划已刷新");
      } else {
        message.success(edited ? "修改成功" : "新增成功"); refresh();
      }
    } catch (error) {
      const validation = error as { errorFields?: Array<{ name: Array<string | number>; errors: string[] }>; message?: string };
      const reason = validation.errorFields?.[0]?.errors?.[0] ?? validation.message ?? "保存失败，请检查填写内容后重试";
      if (validation.errorFields?.[0]?.name) form.scrollToField(validation.errorFields[0].name, { behavior: "smooth", block: "center" });
      setSaveError(reason); message.error(reason);
    } finally {
      saveLock.current = false; setSaving(false);
    }
  };
  const saveBatch = async () => {
    if (!batchSelection || !batchField) return;
    const values = await batchForm.validateFields();
    const raw = values.value; const value = raw?.format ? raw.format("YYYY-MM-DD") : raw;
    setBatchSaving(true);
    try {
      const result = await api<{ succeeded: number; failed: number; items: Array<{ id: string; success: boolean; reason?: string }> }>(`/master-plan-system/resources/${resource}/batch`, {
        method: "PATCH",
        body: JSON.stringify({ records: batchSelection.selectedRows.map((row) => ({ id: row.id, expectedVersion: row.version })), fieldKey: batchField.key, value, idempotencyKey: crypto.randomUUID() })
      });
      if (result.failed) {
        Modal.warning({ title: `批量修改完成：成功 ${result.succeeded} 条，失败 ${result.failed} 条`, content: <div>{result.items.filter((item) => !item.success).slice(0, 20).map((item) => <div key={item.id}>{item.id}：{item.reason}</div>)}</div> });
      } else {
        message.success(`批量修改成功，共 ${result.succeeded} 条`);
        batchSelection.clearSelection(); setBatchSelection(null); batchForm.resetFields(); setBatchField(null);
      }
      refresh();
    } finally { setBatchSaving(false); }
  };
  const syncMutation = useMutation({ mutationFn: (syncKey: string) => api<{ count: number }>(`/master-plan-system/sync/${syncKey}`, { method: "POST" }), onSuccess: (result) => { message.success(`同步完成，共处理 ${result.count} 条变更`); refresh(); void queryClient.invalidateQueries({ queryKey: ["mps-rows"] }); }, onError: (error) => message.error((error as Error).message) });
  const download = async (path: string, filename: string) => {
    const blob = await api<Blob>(path); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
  };
  const previewImport = async (file: File) => {
    const body = new FormData(); body.append("file", file); setImporting(true); setImportError(null); setImportPreview(null);
    try { setImportPreview(await api(`/master-plan-system/resources/${resource}/import-preview${isPendingView ? "?view=PENDING" : ""}`, { method: "POST", body })); }
    catch (error) { setImportError(`导入失败\n\n${(error as Error).message}`); }
    finally { setImporting(false); }
    return false;
  };
  const confirmImport = async () => {
    if (!importPreview?.previewId) return; setImporting(true); setImportError(null);
    try {
      const result = await api<{ created: number; updated: number; reconciliation?: Reconciliation }>(`/master-plan-system/resources/${resource}/import-confirm`, { method: "POST", body: JSON.stringify({ previewId: importPreview.previewId }) });
      setImportPreview(null); await refresh();
      if (reportResources.has(resource)) { await refreshExecutionPlans(); applyReconciliationFeedback(result.reconciliation, `导入完成，新增 ${result.created ?? 0} 条，更新 ${result.updated ?? 0} 条；事业部计划已刷新`); }
      else message.success(`导入完成，新增 ${result.created ?? 0} 条，更新 ${result.updated ?? 0} 条`);
    } catch (error) { setImportError(`导入失败，本次数据未提交。\n\n失败原因：\n${(error as Error).message}\n\n本次整批数据均未写入。`); }
    finally { setImporting(false); }
  };
  const businessFields = (metadata.data?.fields ?? []).filter((field) => !auditFields.has(field.key));
  const columns = useMemo(() => groupedColumns(resource, businessFields, (value, field, row) => <InlineMasterPlanCell resource={resource} field={field} row={row} value={value} organizations={organizations.data ?? []} users={users.data ?? []} weeklyPlans={weeklyPlans.data ?? []} onSave={saveInline} />, metadata.data?.processes ?? fallbackProcessGroups, (row, values) => void saveInlineFields(row, values)), [businessFields, resource, organizations.data, users.data, weeklyPlans.data, saveInline, saveInlineFields, metadata.data?.processes]);
  /* 待报工视图列严格来自唯一权威定义 pendingFields（订单编号→品项编码→品项名称→工序→计划数量→累计报工→剩余数量→本次报工数量→生产日期），
     不新增“操作”列；本次报工数量/生产日期是草稿输入，提交时 CREATE 实际报工记录。 */
  const pendingFields = useMemo(() => metadata.data?.pendingFields ?? [], [metadata.data?.pendingFields]);
  const pendingColumns = useMemo(() => pendingFields.map((field) => field.input
    ? { title: field.label, key: field.key, width: 150, render: (_: unknown, row: any) => <PendingReportCell field={field} draft={pendingDrafts[row.id]} onChange={(patch) => setPendingDrafts((current) => ({ ...current, [row.id]: { ...current[row.id], ...patch } }))} /> }
    : { title: field.label, key: field.key, dataIndex: field.key, width: Math.max(105, Math.min(240, field.label.length * 18 + 54)), render: (value: unknown, row: any) => display(value, field, row) }
  ), [pendingFields, pendingDrafts]);
  const activeColumns = isPendingView ? pendingColumns : columns;
  const pendingSubmittable = (rows.data?.rows ?? []).filter((row) => Number(pendingDrafts[row.id]?.quantity) > 0);
  /*
   * KN-MPS-UI-REPORT-001：报工成功与页面刷新是两个不同结果。
   * 顺序必须是「提交 → 立即给出成功反馈 → 只清理已成功的输入 → 恢复 loading → 最后刷新」，
   * 刷新（或缓存失效）失败绝不能把已经写入的报工表现成“报工失败”。
   */
  const submitPendingReports = async () => {
    if (!pendingSubmittable.length || pendingSubmitting) return;
    setPendingSubmitting(true);
    const successfulIds = new Set<string>();
    const failures: string[] = [];
    let created = 0;
    let reconciliation: Reconciliation | undefined;
    try {
      for (const row of pendingSubmittable) {
        const draft = pendingDrafts[row.id]!;
        try {
          const response = await api<{ reconciliation?: Reconciliation }>("/master-plan-system/resources/mps-process-reports", {
            method: "POST",
            body: JSON.stringify({
              weeklyPlanId: row.weeklyPlanId, processCode: row.processCode,
              productionDate: dayjs(draft.date ?? dayjs()).format("YYYY-MM-DD"),
              productionQuantity: Number(draft.quantity),
              /* KN-MPS-UI-001：异常是可选人工事实；留空则不写入异常。 */
              ...(String(draft.exceptionText ?? "").trim() ? { exceptionText: String(draft.exceptionText).trim() } : {})
            })
          });
          successfulIds.add(row.id); created += 1; reconciliation = response?.reconciliation ?? reconciliation;
        } catch (error) {
          failures.push(`${row.orderNumber ?? ""} / ${row.itemCode ?? ""} / ${row.processCode ?? ""}：${(error as Error).message}`);
        }
      }
      /* 4. POST 结束后立即反馈（不等待任何刷新）。全部失败时绝不出现“报工成功”。 */
      if (!created) {
        message.error(`报工提交失败：${failures.slice(0, 3).join("；")}`);
      } else if (failures.length) {
        message.warning(`已成功提交 ${created} 条报工，${failures.length} 条提交失败：${failures.slice(0, 3).join("；")}`);
      } else {
        const base = created === 1 ? "报工成功" : `已成功提交 ${created} 条报工`;
        applyReconciliationFeedback(reconciliation, `${base}；事业部计划已刷新`);
      }
      /* 5. 只清理成功提交的输入；失败记录保留原数量，供用户修改后重试。 */
      if (successfulIds.size) setPendingDrafts((current) => {
        const next = { ...current };
        for (const id of successfulIds) delete next[id];
        return next;
      });
    } catch (error) {
      /* 意外异常（例如反馈层异常）也不得让已成功的输入残留、更不得伪装成“报工失败”。 */
      if (successfulIds.size) setPendingDrafts((current) => {
        const next = { ...current };
        for (const id of successfulIds) delete next[id];
        return next;
      });
      message.warning(created > 0
        ? `已成功提交 ${created} 条报工，但界面提示异常，请刷新页面确认。`
        : `报工提交异常：${(error as Error).message}`);
    } finally {
      /* 6. 无论 POST / 反馈 / 清理是否异常，loading 都必须恢复。 */
      setPendingSubmitting(false);
    }
    /* 7. 刷新与报工结果解耦：刷新失败只提示刷新问题，不否定已保存的报工。 */
    try {
      await refresh();
      await refreshExecutionPlans();
    } catch {
      message.warning(created > 0 ? "报工已保存，但页面数据刷新失败，请手动刷新页面" : "页面数据刷新失败，请手动刷新页面");
    }
  };
  if (!info) return null;
  const canViewWeekly = resource === "mps-base-plans" && Boolean(metadata.data?.actions.viewWeekly);
  /* KN-MPS-WO-001：3天生产工单不生成最右侧行操作列（新增/删除均不适用，编辑靠编辑模式 + 单元格控件）。 */
  const hasRowActions = !isPendingView && resource !== WORK_ORDER_RESOURCE && Boolean(metadata.data) && (canViewWeekly || metadata.data!.actions.update || metadata.data!.actions.delete || (resource === "mps-process-reports" && metadata.data!.actions.create));
  const withActions = hasRowActions ? [...activeColumns, {
    title: null, key: "__rowActions", width: 52, fixed: "right" as const,
    render: (_: unknown, row: any) => <RowActions metadata={metadata.data!} row={row} onEdit={() => openEdit(row)}
      onDelete={async () => { try { const deleted = await api<{ reconciliation?: Reconciliation }>(`/master-plan-system/resources/${resource}/${row.id}?expectedVersion=${row.version}`, { method: "DELETE" }); await refresh(); if (reportResources.has(resource)) { await refreshExecutionPlans(); applyReconciliationFeedback(deleted?.reconciliation, "删除成功；事业部计划已刷新"); } else message.success("删除成功"); } catch (error) { message.error((error as Error).message); } }}
      onReport={resource === "mps-process-reports" ? () => openReport(row) : undefined}
      onViewWeekly={canViewWeekly && (row.weeklyPlanId || row.weeklyPlanState === "已进入周计划") ? () => viewWeeklyPlan(row) : undefined}
      onSync={resource === "mps-sync-configs" ? () => syncMutation.mutate(row.syncKey) : undefined} />
  }] : activeColumns;
  const viewTabs = ["mps-group-plans", "mps-monthly-plans"].includes(resource) ? <Tabs activeKey={view} onChange={setView} items={[{ key: "ALL", label: "全部" }, { key: "INCOMPLETE", label: "未完成" }, { key: "COMPLETE", label: "已完成" }]} />
    : resource === "mps-process-reports" ? <Tabs activeKey={view === "PENDING" ? "PENDING" : "ACTUAL"} onChange={setView} items={[{ key: "ACTUAL", label: "实际报工" }, { key: "PENDING", label: "待报工任务" }]} /> : undefined;
  return <div>
    <PageHeader title={info.label} subtitle={`${info.area} · 新版主计划独立数据模型；默认只读浏览，进入编辑模式后方可维护获权字段`} actions={<Space>
      {metadata.data?.actions.import && <Button icon={<DownloadOutlined />} onClick={() => void download(`/master-plan-system/resources/${resource}/import-template${isPendingView ? "?view=PENDING" : ""}`, `${info.label}${isPendingView ? "-待报工" : ""}-导入模板.xlsx`).catch((error) => message.error((error as Error).message))}>导入模板</Button>}
      {metadata.data?.actions.import && <Upload accept=".xlsx" maxCount={1} showUploadList={false} beforeUpload={previewImport}><Button loading={importing} icon={<UploadOutlined />}>导入</Button></Upload>}
      {metadata.data?.actions.export && <Button icon={<DownloadOutlined />} onClick={() => void download(`${pageUrl(resource, tableQuery, view, basePlanId).replace("?", "/export?")}`, `${info.label}.xlsx`).catch((error) => message.error((error as Error).message))}>导出</Button>}
      {resource === WORK_ORDER_RESOURCE && metadata.data?.actions.update && <Button type="primary" icon={<SyncOutlined />} loading={syncingWorkOrders} onClick={() => void syncWorkOrders()}>从周计划同步</Button>}
      {metadata.data?.actions.create && hasResourcePermission(resource, "create") && <Button type="primary" onClick={openCreate}>新增</Button>}
    </Space>} />
    {basePlanId && <Alert type="info" showIcon style={{ marginBottom: 12 }} message="仅显示该事业部基础计划生成的周计划" action={<Button size="small" onClick={clearWeeklyPlanFilter}>清除定位</Button>} />}
    {viewTabs}
    <KdosDataTable resource={resource} viewKey={isPendingView ? "PENDING" : undefined} editable={isPendingView ? Boolean(metadata.data?.actions.reportProcess) : Boolean(metadata.data?.actions.update)} rowKey="id" loading={metadata.isLoading || rows.isLoading}
      filterFields={isPendingView ? pendingFields.filter((field) => !field.input) : metadata.data?.fields}
      printContext={{ view: isPendingView ? "PENDING" : "ACTUAL" }}
      toolbar={isPendingView ? <PendingReportSubmit count={pendingSubmittable.length} submitting={pendingSubmitting} onSubmit={() => void submitPendingReports()} /> : undefined}
      dataSource={rows.data?.rows} columns={withActions} serverData={{ total: rows.data?.total ?? 0, onQueryChange: setTableQuery }}
      selectionActions={(selection) => selection.editing && metadata.data?.actions.batchUpdate
        ? <Button type="primary" onClick={() => { batchForm.resetFields(); setBatchField(null); setBatchSelection(selection); }}>批量修改</Button>
        : null}
      scroll={{ x: "max-content", y: "calc(100vh - 330px)" }} />
    <Modal title={modal?.mode === "create" ? `新增${info.label}` : `编辑${info.label}`} open={Boolean(modal)} onCancel={() => { if (!saving) setModal(null); }} onOk={() => void save()} confirmLoading={saving} width={760} destroyOnHidden>
      <Form form={form} layout="vertical" style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "0 16px", maxHeight: "62vh", overflowY: "auto" }}>
        {saveError && <Alert type="error" showIcon message={saveError} style={{ gridColumn: "1 / -1" }} />}
        {formFields.map((field) => <Form.Item key={field.key} name={field.key} label={field.label} valuePropName={field.type === "boolean" ? "checked" : "value"} rules={field.required ? [{ required: true, message: `请填写${field.label}` }] : undefined}><FieldInput field={field} organizations={organizations.data ?? []} users={users.data ?? []} weeklyPlans={weeklyPlans.data ?? []} /></Form.Item>)}
      </Form>
    </Modal>
    <Modal title={importPreview ? "导入预览" : "导入失败"} open={Boolean(importPreview || importError)} onCancel={() => { setImportPreview(null); setImportError(null); }} onOk={() => void confirmImport()}
      okText="确认导入" cancelText="取消" confirmLoading={importing} okButtonProps={{ disabled: !importPreview?.previewId || Boolean(importPreview?.errors.length) }}>
      {importError && <Alert type="error" showIcon message="导入失败" description={<span style={{ whiteSpace: "pre-line" }}>{importError.replace(/^导入失败\n\n/, "")}</span>} style={{ marginBottom: 12 }} />}
      {importPreview && <>
      <p>共解析 {importPreview?.total ?? 0} 条。确认后整批事务提交。</p>
      {importPreview?.blockedReason && <Alert type="warning" showIcon message={importPreview.blockedReason} />}
      {importPreview?.errors.length ? <><Alert type="error" showIcon message="导入校验失败" description={importPreview.errors.length > 100 ? `共发现 ${importPreview.errors.length} 条错误，当前显示前 100 条。` : `发现 ${importPreview.errors.length} 条错误`} style={{ marginBottom: 12 }} /><div style={{ maxHeight: 320, overflow: "auto" }}>{importPreview.errors.slice(0, 100).map((error) => <div key={`${error.row}-${error.reason}`}>第 {error.row} 行：{error.reason}</div>)}</div></> : !importPreview?.blockedReason && <Tag color="success">校验通过，可以确认导入</Tag>}
      </>}
    </Modal>
    <Modal title={<Space><span>批量修改</span><Tag>本次操作将修改 {batchSelection?.selectedRowKeys.length ?? 0} 条数据</Tag></Space>}
      open={Boolean(batchSelection)} onCancel={() => { setBatchSelection(null); batchForm.resetFields(); setBatchField(null); }}
      confirmLoading={batchSaving} onOk={() => void saveBatch().catch((error) => message.error((error as Error).message))}
      okButtonProps={{ disabled: !batchField }} okText="确定" cancelText="取消"
      footer={(_, { OkBtn, CancelBtn }) => <Flex justify="space-between" align="center"><Button type="link" href={`/audit?resource=${encodeURIComponent(resource)}&action=batch_updated`}>查看修改记录</Button><Space><CancelBtn /><OkBtn /></Space></Flex>}>
      <Tag color="blue">单次最多修改 50000 条数据</Tag>
      <p>图片、附件、定位、手写签名、选择数据、查询、分割线、文字识别、按钮字段不支持批量修改。</p>
      <Form form={batchForm} layout="vertical">
        <Form.Item label="请选择需要修改的字段" required>
          <Select value={batchField?.key} placeholder="请选择需要修改的字段" options={editableFields.map((field) => ({ label: field.label, value: field.key }))}
            onChange={(key) => { batchForm.resetFields(["value"]); setBatchField(editableFields.find((field) => field.key === key) ?? null); }} />
        </Form.Item>
        <Form.Item name="value" label="修改为" rules={[{ required: true, message: "请填写修改后的值" }]}>
          {batchField ? <FieldInput field={batchField} organizations={organizations.data ?? []} users={users.data ?? []} /> : <Input disabled placeholder="请先选择字段" />}
        </Form.Item>
      </Form>
    </Modal>
  </div>;
}
