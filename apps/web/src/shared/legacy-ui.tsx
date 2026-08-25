/* eslint-disable react-refresh/only-export-components -- transitional shared UI helpers are intentionally imported by multiple route modules */
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { FilterOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, DatePicker, Drawer, Flex, Input, Modal, Select, Space, Typography } from "antd";
import dayjs from "dayjs";
import { type ColumnDefinition } from "@tracker/shared";
import { api, ApiError, getValue } from "../api";
import { useKdosTableEditMode } from "./KdosDataTable";
export { auditLabels, isAuditField, useAuditColumns, useAuditIdentityDirectory, formatAuditUser } from "./audit-fields";
import { auditLabels, isAuditField } from "./audit-fields";

const { Title, Text } = Typography;

export function statusClass(rate: number | null, dueDate?: string | null) {
  if (rate !== null && rate >= 1) return "status-complete";
  if (!dueDate) return "";
  const today = dayjs().startOf("day");
  const due = dayjs(dueDate);
  if (due.isBefore(today)) return "status-overdue";
  if (due.isSame(today, "day")) return "status-due";
  return "";
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: React.ReactNode }) {
  return <Flex justify="space-between" align="flex-start" className="page-header">
    <div className="page-header-title"><Title level={3}>{title}</Title>{subtitle && <Text type="secondary">{subtitle}</Text>}</div>
    {actions && <div className="page-header-actions">{actions}</div>}
  </Flex>;
}

export type ImportFeedback = { type: "success" | "error"; message: string; errors?: string[] };
export function failedImport(error: unknown): ImportFeedback {
  const details = error instanceof ApiError ? error.details as any : undefined;
  return {
    type: "error",
    message: details?.message || (error instanceof Error ? error.message : "导入失败"),
    errors: Array.isArray(details?.errors) ? details.errors : undefined
  };
}
export function ImportFeedbackAlert({ value, onClose }: { value?: ImportFeedback; onClose: () => void }) {
  if (!value) return null;
  return <Alert closable onClose={onClose} showIcon type={value.type} message={value.message}
    description={value.errors?.length ? <ul>{value.errors.slice(0, 30).map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul> : undefined}
    style={{ margin: "12px 0" }} />;
}

/** KdosDataTable replaces these placeholders with its protected, name-resolving system columns. */
export const auditColumns = Object.entries(auditLabels).map(([dataIndex, title]) => ({ title, dataIndex, key: dataIndex, width: 168 }));

export async function downloadApiFile(path: string, filename: string) {
  const blob = await api<Blob>(path);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function parseCsvFile(file: File) {
  const lines = (await file.text()).replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  const parse = (line: string) => { const values: string[] = []; let current = ""; let quoted = false; for (let index = 0; index < line.length; index++) { const char = line[index]!; if (char === '"' && line[index + 1] === '"') { current += '"'; index++; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { values.push(current.trim()); current = ""; } else current += char; } values.push(current.trim()); return values; };
  const headers = parse(lines.shift() ?? "");
  return lines.map((line) => Object.fromEntries(parse(line).map((value, index) => [headers[index], value])));
}

export function InlineText({ value, onSave, type = "text", dateDisplayFormat }: { value: unknown; onSave: (value: unknown) => Promise<unknown>; type?: "text" | "number" | "date"; dateDisplayFormat?: string }) {
  const { editing } = useKdosTableEditMode();
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  useEffect(() => setDraft(value == null ? "" : String(value)), [value]);
  const save = async () => { const normalized = type === "number" && draft !== "" ? Number(draft) : draft; if (normalized !== value) await onSave(normalized); };
  if (!editing) {
    if (!draft) return <span className="kdos-readonly-cell">—</span>;
    if (type === "date") return <span className="kdos-readonly-cell">{dayjs(draft).isValid() ? dayjs(draft).format(dateDisplayFormat ?? "YYYY-MM-DD") : draft}</span>;
    return <span className="kdos-readonly-cell">{draft}</span>;
  }
  if (type === "date" && dateDisplayFormat) return <DatePicker size="small" allowClear format={dateDisplayFormat} value={draft ? dayjs(draft) : null} style={{ width: "100%" }} onChange={(date) => {
    const normalized = date?.format("YYYY-MM-DD") ?? ""; setDraft(normalized);
    if (normalized !== String(value ?? "")) void onSave(normalized);
  }} />;
  return <Input size="small" type={type} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => void save()} onPressEnter={() => void save()} />;
}

export function FieldVisibility({ all, visible, onChange }: { all: Array<{ key: string; label: string }>; visible: string[]; onChange: (keys: string[]) => void }) {
  const [open, setOpen] = useState(false);
  return <><Button onClick={() => setOpen(true)}>字段显示</Button><Modal title="字段显示" open={open} onCancel={() => setOpen(false)} footer={null}><Select mode="multiple" style={{ width: "100%" }} value={visible} options={all.map((field) => ({ value: field.key, label: field.label }))} onChange={onChange} /></Modal></>;
}

export type PlanFilter = { field: string; value: string };
export type DictionaryOptions = Record<string, string[]>;

export function useDictionaryOptions() {
  const dictionaries = useQuery({ queryKey: ["reference-dictionaries"], queryFn: () => api<any[]>("/reference-data/dictionaries") });
  const suppliers = useQuery({ queryKey: ["reference-suppliers"], queryFn: () => api<any[]>("/reference-data/suppliers") });
  return useMemo<DictionaryOptions>(() => {
    const options: DictionaryOptions = {};
    for (const type of dictionaries.data ?? []) {
      options[type.code] = (type.values ?? []).filter((entry: any) => entry.enabled).map((entry: any) => entry.value);
    }
    options.supplier = (suppliers.data ?? []).filter((supplier: any) => supplier.enabled).map((supplier: any) => supplier.name);
    return options;
  }, [dictionaries.data, suppliers.data]);
}

export function filterPlanRows(rows: any[], filters: PlanFilter[], columns: ColumnDefinition[]) {
  return rows.filter((row) => filters.every((filter) => {
    if (!filter.field || !filter.value.trim()) return true;
    const column = columns.find((candidate) => candidate.key === filter.field);
    const actual = String(getValue(row, filter.field) ?? "");
    return column?.kind === "dictionary"
      ? actual === filter.value
      : actual.toLocaleLowerCase().includes(filter.value.trim().toLocaleLowerCase());
  }));
}

export function matchesDateRange(value: unknown, start: string, end: string) {
  if (!start && !end) return true;
  const date = String(value ?? "");
  if (!date) return false;
  return (!start || date >= start) && (!end || date <= end);
}

export function PlanFilterDrawer({ columns, options, value, onChange }: {
  columns: ColumnDefinition[];
  options: DictionaryOptions;
  value: PlanFilter[];
  onChange: (filters: PlanFilter[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PlanFilter[]>(value);
  const activeCount = value.filter((filter) => filter.field && filter.value.trim()).length;
  const openDrawer = () => { setDraft(value); setOpen(true); };
  const update = (index: number, patch: Partial<PlanFilter>) =>
    setDraft((current) => current.map((filter, itemIndex) => itemIndex === index ? { ...filter, ...patch } : filter));
  return <>
    <Button icon={<FilterOutlined />} type={activeCount ? "primary" : "default"} onClick={openDrawer}>
      {activeCount ? `筛选（${activeCount}）` : "筛选"}
    </Button>
    <Drawer title="筛选数据" width={440} open={open} onClose={() => setOpen(false)}
      extra={<Space><Button onClick={() => setDraft([])}>清空</Button><Button type="primary" onClick={() => { onChange(draft.filter((filter) => filter.field && filter.value.trim())); setOpen(false); }}>应用筛选</Button></Space>}>
      <Text type="secondary">可同时添加多个条件；字典字段只能选择原表中的有效值。</Text>
      <Flex vertical gap={12} className="plan-filter-list">
        {draft.map((filter, index) => {
          const column = columns.find((candidate) => candidate.key === filter.field);
          const dictionaryValues = column?.dictionaryCode ? options[column.dictionaryCode] ?? [] : [];
          return <Card size="small" key={`${index}-${filter.field}`}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Select showSearch optionFilterProp="label" placeholder="选择字段" value={filter.field || undefined}
                style={{ width: "100%" }}
                options={columns.map((item) => ({ value: item.key, label: item.group ? `${item.group} · ${item.header}` : item.header }))}
                onChange={(field) => update(index, { field, value: "" })} />
              {column?.kind === "dictionary"
                ? <Select showSearch allowClear optionFilterProp="label" placeholder="选择值" value={filter.value || undefined}
                    style={{ width: "100%" }} options={dictionaryValues.map((entry) => ({ value: entry, label: entry }))}
                    onChange={(selected) => update(index, { value: selected ?? "" })} />
                : <Input allowClear placeholder="输入要包含的内容" value={filter.value} onChange={(event) => update(index, { value: event.target.value })} />}
              <Button danger type="link" onClick={() => setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))}>删除此条件</Button>
            </Space>
          </Card>;
        })}
        <Button block onClick={() => setDraft((current) => [...current, { field: "", value: "" }])}>＋ 添加筛选条件</Button>
      </Flex>
    </Drawer>
  </>;
}

export const rollingColumnsMeta: ColumnDefinition[] = [
  { key: "sourceAccountName", header: "账套", group: "订单信息", kind: "text", editable: false },
  { key: "orderType", header: "订单类型", group: "订单信息", kind: "text", editable: true },
  { key: "customer", header: "客户", group: "订单信息", kind: "text", editable: true },
  { key: "salesperson", header: "业务员", group: "订单信息", kind: "text", editable: true },
  { key: "orderNumber", header: "订单号", group: "订单信息", kind: "text", editable: false },
  { key: "orderDate", header: "下单日期", group: "订单信息", kind: "date", editable: false },
  { key: "customerDueDate", header: "客户要求交期", group: "订单信息", kind: "date", editable: true },
  { key: "reviewDueDate", header: "产前评审交期", group: "订单信息", kind: "date", editable: true },
  { key: "exceptionDueDate", header: "异常后二次交期", group: "订单信息", kind: "date", editable: true },
  { key: "exceptionDeliveryMethod", header: "异常交货方式", group: "订单信息", kind: "dictionary", editable: true, dictionaryCode: "deliveryMethod" },
  { key: "orderAmount", header: "订单金额", group: "订单信息", kind: "decimal", editable: true },
  { key: "totalQuantity", header: "订单总数量", group: "订单信息", kind: "decimal", editable: false },
  { key: "division", header: "承产单位", group: "订单执行信息", kind: "dictionary", editable: true, dictionaryCode: "division" },
  { key: "completedQuantity", header: "已完成数量", group: "订单执行信息", kind: "decimal", editable: false },
  { key: "pendingQuantity", header: "待完成数量", group: "订单执行信息", kind: "decimal", editable: false },
  { key: "completionRate", header: "完成比例", group: "订单执行信息", kind: "decimal", editable: false },
  { key: "actualCompletionDate", header: "订单实际完成日期", group: "订单执行信息", kind: "date", editable: true },
  { key: "shippingDate", header: "出货日期", group: "订单执行信息", kind: "date", editable: true },
  { key: "deliveryScore", header: "交期评分", group: "订单执行结果评估", kind: "decimal", editable: true },
  { key: "qualityScore", header: "品质评分", group: "订单执行结果评估", kind: "decimal", editable: true },
  { key: "createdBy", header: "创建人", group: "审计信息", kind: "text", editable: false },
  { key: "createdAt", header: "创建时间", group: "审计信息", kind: "text", editable: false },
  { key: "updatedBy", header: "更新人", group: "审计信息", kind: "text", editable: false },
  { key: "updatedAt", header: "更新时间", group: "审计信息", kind: "text", editable: false },
];

export type RollingQuickFilters = {
  orderNumber: string;
  month: string;
  customerDueDateStart: string;
  customerDueDateEnd: string;
  reviewDueDateStart: string;
  reviewDueDateEnd: string;
  exceptionDueDateStart: string;
  exceptionDueDateEnd: string;
  completionRateStart: number | null;
  completionRateEnd: number | null;
  customer: string;
  division: string;
};

export const emptyRollingQuickFilters = (): RollingQuickFilters => ({
  orderNumber: "", month: "",
  customerDueDateStart: "", customerDueDateEnd: "",
  reviewDueDateStart: "", reviewDueDateEnd: "",
  exceptionDueDateStart: "", exceptionDueDateEnd: "",
  completionRateStart: null, completionRateEnd: null,
  customer: "", division: ""
});

export const inboundFieldLabels: Record<string, string> = {
  categoryNumber: "分类编号", documentNumber: "入库单单号", documentFullName: "单据全称",
  documentDate: "单据日期", inboundDate: "入库日期", lineNumber: "序号",
  workOrderNumber: "工单单号", salesOrderNumber: "销售单号", inventoryCode: "产品品号",
  quickCode: "快捷码", inventoryName: "品名", specification: "规格",
  receivedQuantity: "允收数量", unit: "业务单位", category: "类别",
  createdBy: "创建人", createdAt: "创建时间", updatedBy: "更新人", updatedAt: "更新时间"
};
export const inboundFields = Object.keys(inboundFieldLabels);
export const inboundBusinessFields = inboundFields.filter((field) => !isAuditField(field));
