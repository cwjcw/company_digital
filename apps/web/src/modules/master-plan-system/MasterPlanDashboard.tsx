import { mpsDashboardUrl, mpsMetric, MPS_PROCESS_CHART_PALETTE, mpsTrendTooltip } from "./master-plan-dashboard.utils";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Drawer, Empty, Space, Spin, Statistic, Tag, Typography, message } from "antd";
import type { EChartsOption } from "echarts";
import { auxiliaryPlanGroups, mpsDashboardOrderMetrics, mpsDashboardPlanMetrics, mpsDashboardResource as resource, mpsDashboardGaps, type MpsDashboardGapKey, type MpsDashboardData, type MpsDashboardFilters, type MpsDashboardRow } from "@kdos/contracts";
import { api } from "../../api";
import { KdosChart } from "../../shared/charts";
import { KdosDataTable, TablePermissionButton, hasSessionResourcePermission, kdosDefaultPageSize } from "../../shared/KdosDataTable";
import { MpsDateFilter, MpsRemoteSelect } from "./MasterPlanDashboardFilters";
import { MpsTableExport, MpsDashboardDetailTable, MpsDashboardGapList } from "./MasterPlanDashboardTable";
import "./master-plan-dashboard.css";

type Group = { logic: "AND" | "OR"; groups?: Group[]; rules: Array<{ field: string; operator: string; value: unknown }> };
type Sort = { sortField?: string; sortOrder?: "asc" | "desc" };
const sortParams = (sort: Sort): Record<string, string> => sort.sortField ? { sortField: sort.sortField, sortOrder: sort.sortOrder ?? "asc" } : {};
type Drill = { resource: string; title: string; group: Group; view?: string };
function errorText(error: unknown) { return error instanceof Error ? error.message : "数据加载失败"; }
function DrillDrawer({ drill, close, session, filters }: { drill: Drill | null; close: () => void; session: string; filters: MpsDashboardFilters }) {
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(kdosDefaultPageSize); const [sort, setSort] = useState<Sort>({});
  const metadata = useQuery({ queryKey: [resource, session, "drill-meta", drill?.resource], queryFn: () => api<{ fields: Array<{ key: string; label: string }> }>(`/master-plan-system/resources/${drill!.resource}/meta`), enabled: !!drill });
  const result = useQuery({ queryKey: [resource, session, "drill", drill, filters, page, pageSize, sort], queryFn: () => api<{ rows: MpsDashboardRow[]; total: number }>(mpsDashboardUrl(filters, "/drill", { resourceCode: drill!.resource, page: String(page), pageSize: String(pageSize), ...sortParams(sort), filterGroup: JSON.stringify(drill!.group), ...(drill?.view ? { view: drill.view } : {}) })), enabled: !!drill && !!metadata.data, placeholderData: (previous, query) => query?.queryKey[1] === session ? previous : undefined });
  const fields = metadata.data?.fields.filter(f => ["divisionId", "primaryDivisionId", "orderNumber", "itemCode", "itemName", "requiredQuantity", "pendingQuantity", "weeklyPlanState", "weeklyPlanMissingFields", "weeklyPlanGenerationIssue", "exceptionSummary", "processCode", "productionDate", "productionQuantity", "exceptionText"].includes(f.key)) ?? [];
  return <Drawer title={drill?.title} width="85vw" open={!!drill} onClose={close} destroyOnHidden afterOpenChange={open => { if (!open) setPage(1); }}>
    {(metadata.error || result.error) && <Alert type="error" showIcon message={errorText(metadata.error || result.error)} />}
    <KdosDataTable resource={drill?.resource ?? resource} viewKey="dashboard-drill" simple systemFields={false} loading={metadata.isLoading || result.isFetching} rowKey="id" columns={fields.map(f => ({ title: f.label, dataIndex: f.key, key: f.key, width: 180, ellipsis: true, render: (v: unknown, row: MpsDashboardRow) => f.key.endsWith("DivisionId") || f.key === "divisionId" ? String(row.divisionName ?? "—") : String(v ?? "—") }))} dataSource={result.data?.rows ?? []} scroll={{ x: fields.length * 180 }} serverData={{ total: result.data?.total ?? 0, onQueryChange: q => { setPage(q.page); setPageSize(q.pageSize); setSort({ sortField: q.sortField, sortOrder: q.sortOrder }); } }} pagination={{ pageSize }} />
  </Drawer>;
}
export function MasterPlanDashboard() {
  const user = JSON.parse(localStorage.getItem("sessionUser") ?? "{}"); const session = JSON.stringify(user);
  const canRead = hasSessionResourcePermission(user, resource, "read");
  const [filters, setFilters] = useState<MpsDashboardFilters>({});
  const queryClient = useQueryClient();
  const [selectedGap, setSelectedGap] = useState<MpsDashboardGapKey>("missing-shipping-plan");
  const [riskType, setRiskType] = useState<{value:string;nonce:number}>(); const [drill, setDrill] = useState<Drill | null>(null);
  const result = useQuery({ queryKey: [resource, session, filters], queryFn: () => api<MpsDashboardData>(mpsDashboardUrl(filters)), enabled: canRead, placeholderData: (previous, query) => query?.queryKey[1] === session ? previous : undefined, staleTime: 60_000, refetchInterval: 30 * 60_000, retry: false });
  const canExport=hasSessionResourcePermission(user,resource,"export");
  const data = result.data; const visible = (key: string) => data?.visibleFields.includes(key) ?? false;
  const apply = (patch: MpsDashboardFilters) => { setFilters(f => ({ ...f, ...patch })); };
  const open = (code: string, title: string, extra: Group["rules"] = [], row?: MpsDashboardRow, view?: string) => {
    if (!hasSessionResourcePermission(user, code, "read")) { void message.warning("没有对应业务表的查看权限"); return; }
    const rules: Group["rules"] = [...extra];
    if (row?.orderNumber) rules.push({field:"orderNumber",operator:"eq",value:row.orderNumber});
    if (row?.itemCode) rules.push({field:"itemCode",operator:"eq",value:row.itemCode});
    setDrill({resource:code,title,group:{logic:"AND",rules},view});
  };

  const option = (category: string[], series: EChartsOption["series"], horizontal = false): EChartsOption => ({ tooltip: { trigger: "axis", renderMode: "richText" }, legend: { type: "scroll" }, grid: { left: horizontal ? 90 : 60, right: 30, top: 42, bottom: 45, containLabel: true }, xAxis: horizontal ? { type: "value" } : { type: "category", data: category }, yAxis: horizontal ? { type: "category", data: category, inverse: true } : { type: "value" }, series });
  const states = (rows: MpsDashboardRow[]) => rows.map(r => `${r.status ?? "未填写"} ${r.count ?? 0}${r.ratio != null ? `（${mpsMetric(r.ratio, "Rate")}）` : ""}`).join(" · ");
  const readiness = data?.readiness ?? []; const procs = data?.processes ?? [];
  const processColumns = [{ title: "工序", dataIndex: "name", key: "name", width: 100 }, { title: "状态分布", key: "status", width: 330, render: (_: unknown, r: typeof procs[number]) => states(r.states) || "—" }, ...([["requiredQuantity", "需求数量"], ["reportedQuantity", "累计实际报工"], ["productionProgress", "生产进度"]] as const).map(([key, label]) => ({ title: label, key, width: 150, render: (_: unknown, r: typeof procs[number]) => <span className={key === "productionProgress" && Number(r.values[key]) >= 1 ? "mps-progress-complete" : undefined}>{mpsMetric(r.values[key], key)}</span> }))];
  const trendSeries = procs.filter(p => visible(`${p.code}ReportedQuantity`)).map(p => ({ name: p.name, type: "bar" as const, stack: "actual", itemStyle:{color:MPS_PROCESS_CHART_PALETTE[(p.order-1)%MPS_PROCESS_CHART_PALETTE.length]}, data: data?.trend.map(d => Number(d[`${p.code}ReportedQuantity`] ?? 0)) ?? [] }));
  if (!canRead) return <Alert type="error" message="没有主计划综合大屏查看权限" />;
  return <div className="mps-dashboard">
    <div className="mps-dashboard-toolbar">
      {([ ["divisionId","divisionId"], ["customerCode","customerCode"], ["orderNumber","orderNumber"], ["itemCode","itemCode"] ] as const).filter(([,key])=>visible(key)||!data).map(([field])=><MpsRemoteSelect key={session+field} field={field} filters={filters} session={session} onChange={apply}/>)}
      <MpsDateFilter filters={filters} onChange={apply} allowOrder={visible("orderDate")} allowDelivery={visible("deliveryDate")}/>
      <Button onClick={() => { setFilters({}); setRiskType(undefined); }}>清空筛选</Button>
      <Button loading={result.isFetching} onClick={() => void queryClient.invalidateQueries({queryKey:[resource,session]})}>刷新数据</Button>
      <TablePermissionButton resource={resource} />
    </div>
    {result.error && <Alert showIcon type="error" message={errorText(result.error)} />}
    {result.isLoading && <Spin aria-label="加载中" />}
    {data && <>
      <Card title="待处理事项"><div className="mps-dashboard-kpis">{mpsDashboardGaps.filter(g => data.gaps?.[g.key] != null).map(g => <button className="mps-kpi" key={g.key} onClick={() => { setSelectedGap(g.key); document.getElementById("mps-gap-list")?.scrollIntoView?.({ behavior: "smooth" }); }}><Statistic title={g.title} value={data.gaps[g.key]} /></button>)}</div></Card>
      <MpsDashboardGapList selected={selectedGap} onSelect={setSelectedGap} counts={data.gaps ?? {}} filters={filters} session={session} canExport={canExport}/>
      <Card title="订单概况"><div className="mps-dashboard-kpis">{mpsDashboardOrderMetrics.filter(([k]) => visible(k)).map(([key, title]) => <button className="mps-kpi" key={key} onClick={() => open("mps-group-plans", title, [], undefined, key === "unfinishedOrderCount" ? "INCOMPLETE" : undefined)}><Statistic title={title} value={mpsMetric(data.orders[key], key)} /></button>)}</div></Card>
      <Card title="计划概况"><div className="mps-dashboard-kpis">{mpsDashboardPlanMetrics.filter(([k]) => visible(k)).map(([key, title]) => <button className="mps-kpi" key={key} onClick={() => key === "overdueCount" || key === "exceptionCount" ? (setRiskType(previous => ({value:key === "overdueCount" ? "已延期" : "生产异常",nonce:(previous?.nonce??0)+1})), document.getElementById("mps-risks")?.scrollIntoView?.({ behavior: "smooth" })) : open("mps-monthly-plans", title)}><Statistic title={title} value={mpsMetric(data.plans[key], key)} /></button>)}</div>
        <KdosChart ariaLabel="计划数量对比" loading={result.isFetching} empty={!["requiredQuantity", "dispatchedWeeklyQuantity", "cumulativeInboundQuantity", "pendingQuantity"].some(key => data.plans[key] != null && Number(data.plans[key]) !== 0)} height={220} option={option(["月计划需求", "已下达周计划", "累计入库", "欠数"], [{ type: "bar", name: "当前数量", data: (["requiredQuantity", "dispatchedWeeklyQuantity", "cumulativeInboundQuantity", "pendingQuantity"] as const).map(k => data.plans[k] == null ? null : Number(data.plans[k])) }], true)} onDataClick={() => open("mps-monthly-plans", "计划明细")} />
      </Card>
      <div className="mps-dashboard-two-columns">
        <Card title="计划准备">{visible("weeklyPlanState") ? <><Space wrap>{readiness.map(r => <Button key={String(r.status)} onClick={() => open("mps-base-plans", String(r.status), [{ field: "weeklyPlanState", operator: "eq", value: r.status }])}>{states([r])}</Button>)}</Space><KdosChart ariaLabel="计划准备状态分布" height={240} loading={result.isFetching} empty={!readiness.length} option={option(readiness.map(r => String(r.status)), [{ type: "bar", name: "基础计划条数", data: readiness.map(r => Number(r.count)) }])} onDataClick={e => open("mps-base-plans", e.name, [{ field: "weeklyPlanState", operator: "eq", value: e.name }])} /></> : <Empty description="暂无可见指标" />}</Card>
        <Card title="辅助计划"><div className="mps-auxiliary-grid">{auxiliaryPlanGroups.map(g => <div key={g.key} className="mps-auxiliary"><Typography.Text strong>{g.title}</Typography.Text>{data.auxiliary.find(a => a.key === g.key)?.states.map(r => <Button size="small" key={String(r.status)} onClick={() => open("mps-monthly-plans", g.title, [{ field: `${g.key}Status`, operator: "eq", value: r.status }])}><Tag color={r.status === "延期" ? "error" : undefined}>{r.status ?? "未填写"}</Tag>{r.count}</Button>)}</div>)}</div></Card>
      </div>
      <Card title="生产执行"><KdosChart ariaLabel="标准工序生产进度" height={400} loading={result.isFetching} empty={procs.every(p => p.values.productionProgress == null)} option={{ ...option(procs.map(p => p.name), [{ type: "bar", name: "月计划生产进度%", data: procs.map(p => p.values.productionProgress == null ? null : Number(p.values.productionProgress) * 100) }], true), tooltip: { trigger: "axis", renderMode: "richText", formatter: (params: unknown) => { const r = (params as Array<{ dataIndex: number }>)[0]; const p = r ? procs[r.dataIndex] : undefined; return p ? `${p.name}\n需求数量：${mpsMetric(p.values.requiredQuantity)}\n累计实际报工：${mpsMetric(p.values.reportedQuantity)}\n生产进度：${mpsMetric(p.values.productionProgress, "Progress")}\n${states(p.states)}` : ""; } } }} onDataClick={e => { const p = procs[e.dataIndex]; if (p) open("mps-process-reports", `${p.name}实际报工`, [{ field: "processCode", operator: "eq", value: p.code }]); }} />
        <div className="mps-table-toolbar"><Typography.Text strong>工序执行汇总</Typography.Text><MpsTableExport tableKey="process-summary" filters={filters} allowed={canExport}/></div>
        <KdosDataTable resource={resource} viewKey="processes" simple systemFields={false} density="default" rowKey="code" dataSource={procs} columns={processColumns.map(column => ({ ...column, sorter: false }))} pagination={false} scroll={{ x: 900 }} />
      </Card>
      <Card title={`最近7天生产报工趋势（${data.trendStart} ～ ${data.trendEnd}）`}><KdosChart ariaLabel="最近7天实际报工" height={300} loading={result.isFetching} empty={!trendSeries.length || !data.trend.some(d => procs.some(p => Number(d[`${p.code}ReportedQuantity`]) > 0))} option={{...option(data.trend.map(d => String(d.productionDate)), trendSeries),animation:false,legend:{type:"scroll",data:procs.filter(p=>visible(`${p.code}ReportedQuantity`)).map(p=>p.name)},tooltip:{trigger:"axis",renderMode:"richText",formatter:(params:unknown)=>{const index=(params as Array<{dataIndex:number}>)[0]?.dataIndex??0;const day=data.trend[index];return mpsTrendTooltip(String(day?.productionDate??""),procs.filter(p=>visible(`${p.code}ReportedQuantity`)).map(p=>({name:p.name,order:p.order,quantity:Number(day?.[`${p.code}ReportedQuantity`]??0)})));}}}} onDataClick={e => open("mps-process-reports", `${e.name}实际报工`, [{ field: "productionDate", operator: "eq", value: e.name }])} /></Card>
      <Card title="事业部对比"><KdosChart ariaLabel="事业部计划数量对比" height={300} loading={result.isFetching} empty={!data.divisions.length} option={option(data.divisions.map(d => String(d.divisionName ?? "未分配")), ([["requiredQuantity", "月计划需求"], ["dispatchedWeeklyQuantity", "已下达周计划"], ["cumulativeInboundQuantity", "累计入库"]] as const).filter(([k]) => visible(k)).map(([key, name]) => ({ name, type: "bar", data: data.divisions.map(d => Number(d[key] ?? 0)) })))} onDataClick={e => { const d = data.divisions[e.dataIndex]; if (d?.divisionId) apply({ divisionId: String(d.divisionId) }); }} />
      </Card>
      <Card title="事业部计划与执行汇总" extra={<MpsTableExport tableKey="division-summary" filters={filters} allowed={canExport}/>}>
        <KdosDataTable resource={resource} viewKey="divisions" simple systemFields={false} density="default" rowKey={r => String(r.divisionId ?? "unassigned")} dataSource={data.divisions} columns={[["divisionId", "事业部"], ...mpsDashboardPlanMetrics].filter(([k]) => visible(k)).map(([key, title]) => ({ title, key, dataIndex: key, width: key === "divisionId" ? 180 : 150, render: (v: unknown, r: MpsDashboardRow) => key === "divisionId" ? <Button type="link" disabled={!r.divisionId} onClick={() => apply({ divisionId: String(r.divisionId) })}>{r.divisionName ?? "未分配"}</Button> : mpsMetric(v, key) }))} pagination={false} scroll={{ x: 1400 }} />
      </Card>
      <MpsDashboardDetailTable key={session+JSON.stringify(filters)+"readiness"} tableKey="plan-readiness" filters={filters} session={session} canExport={canExport}/>
      <MpsDashboardDetailTable key={session+JSON.stringify(filters)+"execution"} tableKey="process-execution" filters={filters} session={session} canExport={canExport}/>
      <MpsDashboardDetailTable key={session+JSON.stringify(filters)+"risk"} tableKey="risk-exception" filters={filters} session={session} canExport={canExport} initialRiskType={riskType?.value} riskFocusVersion={riskType?.nonce} onOpen={row => open(String(row.resource), String(row.riskType), [], row)}/>

    </>}
    <DrillDrawer key={JSON.stringify(drill)} drill={drill} close={() => setDrill(null)} session={session} filters={filters} />
  </div>;
}
