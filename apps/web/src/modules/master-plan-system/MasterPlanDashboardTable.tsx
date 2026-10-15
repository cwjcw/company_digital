import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Checkbox, Input, Select, Space, Tabs, message } from "antd";
import { standardProcesses } from "@tracker/shared";
import { mpsDashboardReadinessColumns, mpsDashboardExecutionColumns, mpsDashboardRiskColumns, mpsDashboardGaps, mpsDashboardGapColumns, type MpsDashboardGapKey, type MpsDashboardFilters, type MpsDashboardRow, type MpsDashboardTableData, type MpsDashboardTableKey } from "@kdos/contracts";
import { api } from "../../api";
import { KdosDataTable, kdosDefaultPageSize } from "../../shared/KdosDataTable";
import { downloadApiFile } from "../../shared/legacy-ui";
import { mpsDashboardUrl, mpsMetric } from "./master-plan-dashboard.utils";

export function MpsTableExport({ tableKey, filters, extra = {}, allowed }: { tableKey: MpsDashboardTableKey; filters: MpsDashboardFilters; extra?: Record<string, string>; allowed: boolean }) {
  const [exporting, setExporting] = useState(false);
  return allowed ? <Button aria-label="导出" loading={exporting} disabled={exporting} onClick={() => {
    if (exporting) return;
    setExporting(true);
    void downloadApiFile(mpsDashboardUrl(filters, "/export", { ...extra, tableKey }), `mps_${tableKey.replaceAll("-", "_")}_${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }).replaceAll("-", "")}.xlsx`).catch(e => message.error((e as Error).message)).finally(() => setExporting(false));
  }}>导出</Button> : null;
}

type ReportKey = "plan-readiness" | "process-execution" | "risk-exception";
type LocalFilters = { search?: string; processCode?: string; onlyIncomplete?: string; onlyOverdue?: string; riskType?: string };
const reportTitles: Record<ReportKey, string> = { "plan-readiness": "计划待完善明细", "process-execution": "工序执行明细", "risk-exception": "风险与异常" };
/** Each mounted report owns its request, pagination, sort, filters and export. */
export function MpsDashboardDetailTable({ tableKey, filters, session, canExport, embedded = false, initialRiskType, riskFocusVersion, onOpen }: { tableKey: ReportKey | MpsDashboardGapKey; filters: MpsDashboardFilters; session: string; canExport: boolean; embedded?: boolean; initialRiskType?: string; riskFocusVersion?: number; onOpen?: (row: MpsDashboardRow) => void }) {
  const [query, setQuery] = useState<{ page: number; pageSize: number; sortField?: string; sortOrder?: string }>({ page: 1, pageSize: kdosDefaultPageSize });
  const [local, setLocal] = useState<LocalFilters>({});
  const gap = mpsDashboardGaps.find(g => g.key === tableKey);
  const title = gap?.title ?? reportTitles[tableKey as ReportKey];
  const change = (patch: LocalFilters) => { setLocal(old => ({ ...old, ...patch })); setQuery(old => ({ ...old, page: 1 })); };
  useEffect(() => { if (tableKey === "risk-exception" && initialRiskType) { setLocal(old => ({ ...old, riskType: initialRiskType })); setQuery(old => ({ ...old, page: 1 })); } }, [tableKey, initialRiskType, riskFocusVersion]);
  const extra = Object.fromEntries(Object.entries({ ...query, ...local }).filter(([, value]) => value != null && value !== "").map(([key, value]) => [key, String(value)]));
  const result = useQuery({
    queryKey: ["mps-overview-dashboard", session, "report", tableKey, filters, query, local],
    queryFn: () => api<MpsDashboardTableData>(mpsDashboardUrl(filters, gap ? "/gaps" : `/reports/${tableKey}`, { ...extra, ...(gap ? { type: gap.key } : {}) })),
    placeholderData: (previous, old) => old?.queryKey[1] === session ? previous : undefined, staleTime: 60_000, retry: false
  });
  const definitions = gap ? mpsDashboardGapColumns(gap.key) : tableKey === "plan-readiness" ? mpsDashboardReadinessColumns : tableKey === "process-execution" ? mpsDashboardExecutionColumns : mpsDashboardRiskColumns;
  const fields = result.data?.visibleFields ?? [];
  const numeric = ["plannedQuantity", "requiredQuantity", "reportedQuantity", "productionProgress", "dispatchedWeeklyQuantity", "cumulativeInboundQuantity", "pendingQuantity"];
  const columns = definitions.filter(([key]) => {
    if (gap && ["currentNode", "currentStatus"].includes(key)) return fields.includes(gap.metric);
    if (tableKey === "process-execution" && ["processName", "requiredQuantity", "reportedQuantity", "productionProgress", "status"].includes(key)) return key === "processName" || result.data?.rows.some(r => key in r);
    return fields.includes(key);
  });
  const content = <>
    <div className="mps-table-toolbar"><Space wrap>
      {fields.some(key => ["orderNumber", "itemCode", "itemName"].includes(key)) && <Input.Search aria-label={`${title}搜索`} placeholder="订单号 / 品号 / 品名" allowClear onSearch={value => change({ search: value })} style={{ width: 240 }} />}
      {tableKey === "process-execution" && <>
        <Select aria-label="工序执行明细工序" placeholder="全部工序" allowClear value={local.processCode} onChange={value => change({ processCode: value })} options={[...standardProcesses].sort((a, b) => a.order - b.order).map(p => ({ value: p.code, label: p.name }))} style={{ width: 150 }} />
        {standardProcesses.filter(p => !local.processCode || p.code === local.processCode).every(p => fields.includes(p.code + "Status")) && <><Checkbox checked={local.onlyIncomplete === "true"} onChange={e => change({ onlyIncomplete: String(e.target.checked) })}>只看未完成</Checkbox>
        <Checkbox checked={local.onlyOverdue === "true"} onChange={e => change({ onlyOverdue: String(e.target.checked) })}>只看延期</Checkbox></>}
      </>}
      {tableKey === "risk-exception" && fields.includes("riskType") && <Select aria-label="风险类型" placeholder="全部风险" allowClear value={local.riskType} onChange={value => change({ riskType: value })} options={["已延期", "生产异常"].map(value => ({ value, label: value }))} style={{ width: 150 }} />}
      <Button onClick={() => void result.refetch()} loading={result.isFetching}>刷新</Button>
    </Space><MpsTableExport tableKey={tableKey} filters={filters} extra={extra} allowed={canExport} /></div>
    {result.error && <Alert type="error" showIcon message={(result.error as Error).message} />}
    <KdosDataTable resource="mps-overview-dashboard" viewKey={tableKey} simple systemFields={false} rowKey="id" loading={result.isFetching} dataSource={result.data?.rows ?? []}
      columns={columns.map(([key, label]) => ({ title: label, key, dataIndex: key, width: ["exceptionSummary", "weeklyPlanMissingFields", "weeklyPlanGenerationIssue"].includes(key) ? 280 : 155, ellipsis: true, render: (value: unknown, row) => key === "divisionId" ? String(row.divisionName ?? "—") : key === "orderNumber" && onOpen ? <Button type="link" onClick={() => onOpen(row)}>{String(value ?? "—")}</Button> : numeric.includes(key) ? mpsMetric(value, key) : String(value ?? "—") }))}
      scroll={{ x: columns.length * 155 }} serverData={{ resetKey: JSON.stringify([filters, local]), total: result.data?.total ?? 0, onQueryChange: q => setQuery({ page: q.page, pageSize: q.pageSize, sortField: q.sortField, sortOrder: q.sortOrder }) }} pagination={{ pageSize: query.pageSize }} />
  </>;
  return embedded ? content : <Card title={title} id={tableKey === "risk-exception" ? "mps-risks" : undefined}>{content}</Card>;
}
export function MpsDashboardGapList({ selected, onSelect, counts, ...props }: { selected: MpsDashboardGapKey; onSelect: (key: MpsDashboardGapKey) => void; counts: Partial<Record<MpsDashboardGapKey, number>>; filters: MpsDashboardFilters; session: string; canExport: boolean }) {
  const gaps = mpsDashboardGaps.filter(g => counts[g.key] != null);
  const active = gaps.find(g => g.key === selected)?.key ?? gaps[0]?.key;
  return <Card title="待处理清单" id="mps-gap-list"><Tabs activeKey={active} onChange={key => onSelect(key as MpsDashboardGapKey)} items={gaps.map(g => ({ key: g.key, label: `${g.title} ${counts[g.key]}` }))} />{active && <MpsDashboardDetailTable key={active + JSON.stringify(props.filters)} {...props} tableKey={active} embedded />}</Card>;
}
