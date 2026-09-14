import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, message, Space } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { api } from "../../../api";
import { InlineText, PageHeader } from "../../../shared/legacy-ui";
import { DUE_DATE_DISPLAY_FORMAT } from "../../../shared/date-format";
import { hasResourcePermission, KdosDataTable, useKdosTableEditMode } from "../../../shared/KdosDataTable";

type TableQuery = { page: number; pageSize: number; search: string; filters: Record<string, string>; sortField?: string; sortOrder?: "asc" | "desc" };
type TablePage<T> = { rows: T[]; total: number; page: number; pageSize: number };
const blankQuery: TableQuery = { page: 1, pageSize: 50, search: "", filters: {} };
const tableUrl = (path: string, query: TableQuery, extra: Record<string, string> = {}) => {
  const params = new URLSearchParams({ ...extra, page: String(query.page), pageSize: String(query.pageSize) });
  if (query.search) params.set("search", query.search);
  if (Object.values(query.filters).some((value) => value.trim())) params.set("filters", JSON.stringify(query.filters));
  if (query.sortField) params.set("sortField", query.sortField);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  return `${path}?${params}`;
};
const pageRows = <T,>(data?: TablePage<T> | T[]) => Array.isArray(data) ? data : data?.rows ?? [];
const pageTotal = <T,>(data?: TablePage<T> | T[]) => Array.isArray(data) ? data.length : data?.total ?? 0;

export function WeeklyPlanPage({ startDate }: { startDate: string }) {
  const queryClient = useQueryClient(); const [tableQuery, setTableQuery] = useState<TableQuery>(blankQuery);
  const periods = useQuery({ queryKey: ["weekly-plan-periods"], queryFn: () => api<any[]>("/planning-operations/weekly-periods") });
  const period = periods.data?.find((row) => dayjs(row.startDate).format("YYYY-MM-DD") === startDate);
  const rows = useQuery({ queryKey: ["weekly-plan-items", period?.id, tableQuery], enabled: Boolean(period?.id), queryFn: () => api<TablePage<any>|any[]>(tableUrl(`/planning-operations/weekly-periods/${period.id}/items`, tableQuery)) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["weekly-plan-items", period?.id] });
  const update = async (row: any, field: string, value: unknown) => { try { await api(`/planning-operations/weekly-items/${row.id}`, { method: "PATCH", body: JSON.stringify({ field, value, expectedVersion: row.version }) }); refresh(); } catch (error) { message.error((error as Error).message); refresh(); throw error; } };
  const columns = [
    { title: "客户代码", dataIndex: "customerCode", width: 140 }, { title: "订单编号", dataIndex: "orderNumber", width: 170 },
    { title: "品项编码", dataIndex: "itemNumber", width: 170 }, { title: "品项名称", dataIndex: "itemName", width: 260 },
    { title: "订单总数量", dataIndex: "orderTotalQuantity", width: 140 }, { title: "生产单位", dataIndex: "productionUnit", width: 160 },
    { title: "订单完成比例", dataIndex: "completionRatio", width: 150, render: (value: unknown) => `${Number(value ?? 0).toFixed(2)}%` },
    { title: "客户交期", dataIndex: "customerDueDate", width: 140, render: (value: unknown, row: any) => <InlineText type="date" dateDisplayFormat={DUE_DATE_DISPLAY_FORMAT} value={value} onSave={(next) => update(row, "customerDueDate", next)} /> },
    { title: "评审交期", dataIndex: "reviewDueDate", width: 140, render: (value: unknown, row: any) => <InlineText type="date" dateDisplayFormat={DUE_DATE_DISPLAY_FORMAT} value={value} onSave={(next) => update(row, "reviewDueDate", next)} /> }
  ];
  return <div><PageHeader title={`${period?.name ?? "周计划"}（${startDate}）`} subtitle={period ? `${dayjs(period.startDate).format("M月D日")} 至 ${dayjs(period.endDate).format("M月D日")}` : "正在加载周计划周期"} /><KdosDataTable resource="weekly-plan" editable rowKey="id" loading={periods.isLoading || rows.isLoading} dataSource={pageRows(rows.data)} columns={columns}
    serverData={{ total: pageTotal(rows.data), onQueryChange: setTableQuery }} searchPlaceholder="搜索客户、订单、品项、生产单位" scroll={{ x: "max-content", y: "calc(100vh - 305px)" }} /></div>;
}

export function WorkReportsPage() {
  const queryClient = useQueryClient(); const [date, setDate] = useState<Dayjs>(dayjs()); const [tableQuery, setTableQuery] = useState<TableQuery>(blankQuery); const [syncing, setSyncing] = useState(false);
  const dateValue = date.format("YYYY-MM-DD");
  const rows = useQuery({ queryKey: ["work-reports", dateValue, tableQuery], queryFn: () => api<TablePage<any>|any[]>(tableUrl("/planning-operations/work-reports", tableQuery, { date: dateValue })) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["work-reports", dateValue] });
  const sync = async () => { setSyncing(true); try {
    const result = await api<{ sourceCount: number; matched: number; created: number; updated: number; unchanged: number; removedStale: number; preservedReported: number }>("/planning-operations/work-reports/sync", { method: "POST", body: JSON.stringify({ date: dateValue }) });
    message.success(`月度计划导入完成：匹配 ${result.matched} 条，新增 ${result.created} 条，更新 ${result.updated} 条，未变化 ${result.unchanged} 条，清理无报工旧记录 ${result.removedStale} 条；已填报数量保持不变`); refresh();
  } catch (error) { message.error((error as Error).message); } finally { setSyncing(false); } };
  const update = async (row: any, value: unknown) => { try { await api(`/planning-operations/work-reports/${row.id}`, { method: "PATCH", body: JSON.stringify({ reportedQuantity: value, expectedVersion: row.version }) }); refresh(); } catch (error) { message.error((error as Error).message); refresh(); throw error; } };
  const columns = [
    { title: "日期", dataIndex: "workDate", width: 110, render: (value: unknown) => value ? dayjs(String(value)).format("M月D日") : "—" },
    { title: "事业部", dataIndex: "divisionName", width: 140 }, { title: "客户", dataIndex: "customer", width: 180 },
    { title: "订单编码", dataIndex: "orderNumber", width: 170 }, { title: "品项编码", dataIndex: "itemNumber", width: 170 },
    { title: "品名", dataIndex: "itemName", width: 260 }, { title: "需求数量", dataIndex: "requiredQuantity", width: 140 },
    { title: "报工数量", dataIndex: "reportedQuantity", width: 150, render: (value: unknown, row: any) => <WorkReportQuantityCell value={value} onSave={(next) => update(row, next)} /> }
  ];
  const toolbar = <Space><DatePicker value={date} format="M月D日" onChange={(value) => value && setDate(value)} allowClear={false} />
    {hasResourcePermission("work-report", "import") && <Button type="primary" loading={syncing} onClick={() => void sync()}>从月度计划导入</Button>}</Space>;
  return <div><PageHeader title="报工表" subtitle="按所选日期对应月份的月度计划手工导入，以订单号 + 品项编码匹配；重新导入不会覆盖已填报数量" />
    <KdosDataTable resource="work-report" editable toolbar={toolbar} searchPlaceholder="搜索客户、订单、品项" rowKey="id" loading={rows.isLoading} dataSource={pageRows(rows.data)} columns={columns}
      serverData={{ total: pageTotal(rows.data), onQueryChange: setTableQuery }} scroll={{ x: "max-content", y: "calc(100vh - 305px)" }} /></div>;
}

function WorkReportQuantityCell({ value, onSave }: { value: unknown; onSave: (value: unknown) => Promise<void> }) {
  const { editing } = useKdosTableEditMode();
  return editing ? <InlineText type="number" value={value} onSave={onSave} /> : <>{value == null || value === "" ? "—" : String(value)}</>;
}
