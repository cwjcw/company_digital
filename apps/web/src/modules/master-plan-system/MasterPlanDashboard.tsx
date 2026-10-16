import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Collapse, Empty, Select, Space, Spin, Statistic, Tag, Tooltip, Typography } from "antd";
import type { EChartsOption } from "echarts";
import { standardProcesses } from "@tracker/shared";
import { auxiliaryPlanGroups, mpsDashboardNavigationUrl, mpsDashboardPlanMetrics, mpsDashboardResource as resource, type MpsDashboardGapKey, type MpsDashboardSummary, type MpsDashboardFilters, type MpsDashboardRow } from "@kdos/contracts";
import { api } from "../../api";
import { KdosChart } from "../../shared/charts";
import { KdosDataTable, hasSessionResourcePermission } from "../../shared/KdosDataTable";
import { MpsDashboardToolbar } from "./MasterPlanDashboardFilters";
import { MpsTableExport } from "./MasterPlanDashboardTable";
import { MpsDashboardDrillDrawer, type Drill } from "./MasterPlanDashboardDrill";
import { mpsDashboardUrl, mpsMetric, MPS_PROCESS_CHART_PALETTE, mpsTrendTooltip } from "./master-plan-dashboard.utils";
import "./master-plan-dashboard.css";

const registry = [...standardProcesses].sort((a, b) => a.order - b.order);
const quantities = [["requiredQuantity", "月计划需求"], ["dispatchedWeeklyQuantity", "已下达周计划"], ["cumulativeInboundQuantity", "累计入库"], ["pendingQuantity", "欠数"]] as const;
const rates = [["dispatchRate", "周计划下达率"], ["inboundRate", "入库完成率"]] as const;
const divisionRisks = [["overdueCount", "延期月计划条数"], ["exceptionCount", "生产异常月计划条数"]] as const;
const riskCards: Array<{ key: MpsDashboardGapKey; title: string; unit: string }> = [
  { key: "overdue", title: "延期未完成", unit: "月计划条" }, { key: "production-exception", title: "生产异常", unit: "月计划条" },
  { key: "plan-not-ready", title: "计划待完善", unit: "基础计划条" }, { key: "no-inbound", title: "未入库", unit: "月计划条" }
];
const statesText = (rows: MpsDashboardRow[]) => rows.map(r => `${r.status ?? "未填写"} ${r.count ?? 0}`).join(" · ");
function bars(categories: string[], series: EChartsOption["series"], horizontal = false, percentage = false): EChartsOption {
  const valueAxis = { type: "value" as const, ...(percentage ? { axisLabel: { formatter: "{value}%" } } : {}) };
  const categoryAxis = { type: "category" as const, data: categories, ...(horizontal ? { inverse: true } : {}) };
  return { animation: false, tooltip: { trigger: "axis", renderMode: "richText" }, legend: { type: "scroll" }, grid: { left: horizontal ? 75 : 35, right: 22, top: 45, bottom: 35, containLabel: true }, xAxis: horizontal ? valueAxis : categoryAxis, yAxis: horizontal ? categoryAxis : valueAxis, series };
}

export function MasterPlanDashboard() {
  const user = JSON.parse(localStorage.getItem("sessionUser") ?? "{}"), session = JSON.stringify(user);
  const can = (code: string, action = "read") => hasSessionResourcePermission(user, code, action);
  const canRead = can(resource), canExport = can(resource, "export"), navigate = useNavigate(), client = useQueryClient();
  const [filters, setFilters] = useState<MpsDashboardFilters>({});
  const [divisionMode, setDivisionMode] = useState("quantity");
  const [drill, setDrill] = useState<Drill | null>(null);
  const result = useQuery({ queryKey: [resource, session, "summary", filters], queryFn: () => api<MpsDashboardSummary>(mpsDashboardUrl(filters, "/summary")), enabled: canRead, placeholderData: (previous, query) => query?.queryKey[1] === session ? previous : undefined, staleTime: 60_000, refetchInterval: 30 * 60_000, retry: false });
  const data = result.data, visible = (key: string) => data?.visibleFields.includes(key) ?? false;
  const apply = (patch: MpsDashboardFilters) => { setFilters(old => ({ ...old, ...patch })); setDrill(null); };
  const open = (code: string, title: string, rules: Drill["group"]["rules"] = [], view?: string) => {
    if (can(code)) setDrill({ resource: code, title, group: { logic: "AND", rules }, view });
  };
  const go = (path: Parameters<typeof mpsDashboardNavigationUrl>[0], gap?: MpsDashboardGapKey) => navigate(mpsDashboardNavigationUrl(path, filters, gap));
  const procs = registry.map(p => data?.processes.find(row => row.code === p.code) ?? { ...p, values: {}, states: [] });
  const quantityFields = quantities.filter(([key]) => visible(key));
  const divisionFields = (divisionMode === "rate" ? rates : divisionMode === "risk" ? divisionRisks : quantities).filter(([key]) => visible(key));
  const statusOrder = ["未开始", "进行中", "延期", "已完成"];
  const statusLabels = [...new Set(procs.flatMap(p => visible(p.code + "Status") ? p.states.map(r => String(r.status)) : []))].sort((a, b) => statusOrder.indexOf(a) - statusOrder.indexOf(b));
  const statusColors: Record<string, string> = { 未开始: "#8696a7", 进行中: "#176BBD", 延期: "#C73E45", 已完成: "#238636" };
  const trendProcesses = procs.filter(p => visible(`${p.code}ReportedQuantity`));
  const orderSplit = visible("orderCount") && visible("unfinishedOrderCount") && data?.orders.orderCount != null && data.orders.unfinishedOrderCount != null;
  const core = [
    { key: "orderCount", title: "订单数", value: data?.orders.orderCount, code: "mps-group-plans" },
    { key: "unfinishedOrderCount", title: "未完成订单数", value: data?.orders.unfinishedOrderCount, code: "mps-group-plans", view: "INCOMPLETE" },
    { key: "orderCompletionRate", title: "订单整体完成率", value: data?.orders.orderCompletionRate, code: "mps-group-plans", tip: "集团订单完成数量合计 ÷ 需求数量合计" },
    { key: "requiredQuantity", title: "月计划需求", value: data?.plans.requiredQuantity, code: "mps-monthly-plans" },
    { key: "dispatchedWeeklyQuantity", title: "已下达周计划数量", value: data?.plans.dispatchedWeeklyQuantity, code: "mps-monthly-plans" },
    { key: "dispatchRate", title: "周计划下达率", value: data?.plans.dispatchRate, code: "mps-monthly-plans", tip: "已下达周计划数量 ÷ 月计划需求数量" },
    { key: "cumulativeInboundQuantity", title: "累计入库", value: data?.plans.cumulativeInboundQuantity, code: "mps-monthly-plans" },
    { key: "pendingQuantity", title: "欠数", value: data?.plans.pendingQuantity, code: "mps-monthly-plans" },
    { key: "overdueCount", title: "延期月计划条数", value: data?.plans.overdueCount, gap: "overdue" as const }
  ].filter(metric => visible(metric.key));
  const processColumns = [
    { title: "工序", key: "name", dataIndex: "name", width: 100 },
    { title: "状态分布（月计划条数）", key: "status", width: 330, render: (_: unknown, row: typeof procs[number]) => statesText(row.states) || "—" },
    ...([["requiredQuantity", "需求数量"], ["reportedQuantity", "累计实际报工"], ["productionProgress", "生产进度"]] as const).map(([key, title]) => ({ title, key, width: 150, render: (_: unknown, row: typeof procs[number]) => <span className={key === "productionProgress" && Number(row.values[key]) >= 1 ? "mps-progress-complete" : undefined}>{mpsMetric(row.values[key], key)}</span> }))
  ].filter(column => column.key === "name" || column.key === "status" && procs.some(p => visible(p.code + "Status")) || column.key === "requiredQuantity" && procs.some(p => visible(p.code + "RequiredQuantity")) || column.key === "reportedQuantity" && procs.some(p => visible(p.code + "ReportedQuantity")) || column.key === "productionProgress" && procs.some(p => visible(p.code + "ProductionProgress")));
  if (!canRead) return <Alert type="error" message="没有PMC综合驾驶舱查看权限" />;
  return <div className="mps-dashboard mps-cockpit">
    <MpsDashboardToolbar filters={filters} session={session} fields={data?.visibleFields ?? []} onChange={apply} onClear={() => { setFilters({}); setDrill(null); }} onRefresh={() => void client.invalidateQueries({ queryKey: [resource, session] })} refreshing={result.isFetching} />
    {result.error && <Alert type="error" showIcon message={(result.error as Error).message} />}
    {result.isLoading && <Spin aria-label="加载中" />}
    {data && <>
      <Card className="mps-cockpit-core"><div className="mps-dashboard-kpis">{core.map(metric => {
        const statistic = <Tooltip title={metric.tip}><Statistic title={metric.title} value={mpsMetric(metric.value, metric.key)} /></Tooltip>;
        const click = metric.gap && data.gaps[metric.gap] != null ? () => go("/master-plan-gaps", metric.gap) : metric.code && can(metric.code) ? () => open(metric.code!, metric.title, [], metric.view) : undefined;
        return click ? <button className="mps-kpi" key={metric.key} onClick={click}>{statistic}</button> : <div className="mps-kpi mps-kpi-static" key={metric.key}>{statistic}</div>;
      })}{!core.length && <Empty description="暂无可见指标" />}</div></Card>
      <div className="mps-dashboard-two-columns">
        <Card title="订单概况（订单数）"><KdosChart ariaLabel="订单完成情况分布" height={275} loading={result.isFetching} empty={!orderSplit || Number(data.orders.orderCount) === 0} option={{ animation: false, tooltip: { trigger: "item", renderMode: "richText" }, legend: { bottom: 0 }, series: [{ type: "pie", radius: ["48%", "72%"], center: ["50%", "45%"], label: { formatter: "{b}：{c}单" }, data: [{ name: "已完成", value: Number(data.orders.orderCount) - Number(data.orders.unfinishedOrderCount), itemStyle: { color: "#238636" } }, { name: "未完成", value: Number(data.orders.unfinishedOrderCount), itemStyle: { color: "#D46B08" } }] }] }} onDataClick={can("mps-group-plans") ? e => open("mps-group-plans", e.name + "订单", [], e.name === "已完成" ? "COMPLETE" : "INCOMPLETE") : undefined} /></Card>
        <Card title="计划数量对比"><KdosChart ariaLabel="计划数量对比" height={275} loading={result.isFetching} empty={!quantityFields.length || !quantityFields.some(([key]) => Number(data.plans[key]) !== 0)} option={bars(quantityFields.map(([, title]) => title), [{ type: "bar", name: "当前数量", data: quantityFields.map(([key]) => data.plans[key] == null ? null : Number(data.plans[key])) }], true)} onDataClick={can("mps-monthly-plans") ? () => open("mps-monthly-plans", "计划明细") : undefined} /></Card>
      </div>
      <div className="mps-dashboard-two-columns">
        <Card title="事业部交付对比" extra={<Select aria-label="事业部对比指标" value={divisionMode} onChange={setDivisionMode} options={[{ value: "quantity", label: "数量" }, { value: "rate", label: "比例" }, { value: "risk", label: "交付风险" }]} />}>
          <KdosChart ariaLabel={divisionMode === "rate" ? "事业部计划比例对比" : divisionMode === "risk" ? "事业部交付风险对比（月计划条数）" : "事业部计划数量对比"} height={350} loading={result.isFetching} empty={!data.divisions.length || !divisionFields.length} option={bars(data.divisions.map(d => String(d.divisionName ?? "未分配")), divisionFields.map(([key, name]) => ({ name, type: "bar", data: data.divisions.map(d => d[key] == null ? null : Number(d[key]) * (divisionMode === "rate" ? 100 : 1)) })), false, divisionMode === "rate")} onDataClick={e => { const division = data.divisions[e.dataIndex]; if (division?.divisionId) apply({ divisionId: String(division.divisionId) }); }} />
        </Card>
        <Card title="工序生产进度"><KdosChart ariaLabel="标准工序生产进度" height={350} loading={result.isFetching} empty={procs.every(p => p.values.productionProgress == null)} option={{ ...bars(procs.map(p => p.name), [{ type: "bar", name: "生产进度", data: procs.map(p => p.values.productionProgress == null ? null : Number(p.values.productionProgress) * 100), itemStyle: { color: "#176BBD" } }], true, true), tooltip: { trigger: "axis", renderMode: "richText", formatter: (params: unknown) => { const p = procs[(params as Array<{ dataIndex: number }>)[0]?.dataIndex ?? 0]; return p ? `${p.name}\n需求数量：${mpsMetric(p.values.requiredQuantity)}\n累计实际报工：${mpsMetric(p.values.reportedQuantity)}\n生产进度：${mpsMetric(p.values.productionProgress, "Progress")}\n${statesText(p.states) || "—"}` : ""; } } }} onDataClick={can("mps-process-reports") ? e => { const p = procs[e.dataIndex]; if (p) open("mps-process-reports", `${p.name}实际报工`, [{ field: "processCode", operator: "eq", value: p.code }]); } : undefined} /></Card>
      </div>
      <div className="mps-dashboard-two-columns">
        <Card title="工序状态分布（月计划条数）"><KdosChart ariaLabel="标准工序状态分布" height={330} loading={result.isFetching} empty={!statusLabels.length} option={bars(procs.map(p => p.name), statusLabels.map(name => ({ type: "bar", stack: "state", name, itemStyle: { color: statusColors[name] }, data: procs.map(p => visible(p.code + "Status") ? Number(p.states.find(r => r.status === name)?.count ?? 0) : null) })), true)} /></Card>
        <Card title="计划准备"><KdosChart ariaLabel="计划准备状态分布" height={330} loading={result.isFetching} empty={!visible("weeklyPlanState") || !data.readiness.length} option={bars(data.readiness.map(r => String(r.status)), [{ type: "bar", name: "基础计划条数", data: data.readiness.map(r => Number(r.count)) }])} onDataClick={can("mps-base-plans") ? e => open("mps-base-plans", e.name, [{ field: "weeklyPlanState", operator: "eq", value: e.name }]) : undefined} /></Card>
      </div>
      <Collapse items={[{ key: "process-summary", label: "工序执行汇总", children: <><div className="mps-table-toolbar"><span /><MpsTableExport tableKey="process-summary" filters={filters} allowed={canExport} /></div><KdosDataTable resource={resource} viewKey="processes" simple systemFields={false} rowKey="code" dataSource={procs} columns={processColumns.map(column => ({ ...column, sorter: false }))} pagination={false} scroll={{ x: 900 }} /></> }]} />
      <Card title="图纸、主材与外协"><div className="mps-cockpit-auxiliary">{auxiliaryPlanGroups.map(group => {
        const rows = data.auxiliary.find(row => row.key === group.key)?.states ?? [];
        return <div className="mps-auxiliary" key={group.key}><Typography.Text strong>{group.title}</Typography.Text>{rows.map(row => {
          const content = <><Tag color={row.status === "延期" ? "error" : row.status === "已完成" || row.status === "已入库" ? "success" : undefined}>{row.status}</Tag>{row.count}</>;
          return can("mps-monthly-plans") ? <Button key={String(row.status)} size="small" onClick={() => open("mps-monthly-plans", group.title, [{ field: `${group.key}Status`, operator: "eq", value: row.status }])}>{content}</Button> : <span key={String(row.status)}>{content}</span>;
        })}{!rows.length && <span>—</span>}</div>;
      })}</div></Card>
      <Card title={`最近7天生产报工趋势（${data.trendStart} ～ ${data.trendEnd}）`}><KdosChart ariaLabel="最近7天实际报工" height={300} loading={result.isFetching} empty={!trendProcesses.length || !data.trend.length || !data.trend.some(day => trendProcesses.some(p => Number(day[`${p.code}ReportedQuantity`] ?? 0) !== 0))} option={{ ...bars(data.trend.map(day => String(day.productionDate)), trendProcesses.map(p => ({ name: p.name, type: "bar", stack: "actual", itemStyle: { color: MPS_PROCESS_CHART_PALETTE[(p.order - 1) % MPS_PROCESS_CHART_PALETTE.length] }, data: data.trend.map(day => Number(day[`${p.code}ReportedQuantity`] ?? 0)) }))), legend: { type: "scroll", data: trendProcesses.map(p => p.name) }, tooltip: { trigger: "axis", renderMode: "richText", formatter: (params: unknown) => { const day = data.trend[(params as Array<{ dataIndex: number }>)[0]?.dataIndex ?? 0]; return mpsTrendTooltip(String(day?.productionDate ?? ""), trendProcesses.map(p => ({ name: p.name, order: p.order, quantity: Number(day?.[`${p.code}ReportedQuantity`] ?? 0) }))); } } }} onDataClick={can("mps-process-reports") ? e => open("mps-process-reports", `${e.name}实际报工`, [{ field: "productionDate", operator: "eq", value: e.name }]) : undefined} /></Card>
      <Card title="交付风险摘要"><div className="mps-cockpit-risks">{riskCards.filter(risk => data.gaps[risk.key] != null).map(risk => <button className="mps-kpi" key={risk.key} onClick={() => go("/master-plan-gaps", risk.key)}><Statistic title={risk.title} value={data.gaps[risk.key]} suffix={risk.unit} /></button>)}</div>{!riskCards.some(risk => data.gaps[risk.key] != null) && <Empty description="暂无可见指标" />}</Card>
      <Card title="事业部计划与执行汇总" extra={<MpsTableExport tableKey="division-summary" filters={filters} allowed={canExport} />}>
        <KdosDataTable resource={resource} viewKey="divisions" simple systemFields={false} rowKey={row => String(row.divisionId ?? "unassigned")} dataSource={data.divisions} columns={[["divisionId", "事业部"], ...mpsDashboardPlanMetrics].filter(([key]) => visible(key)).map(([key, title]) => ({ title, key, dataIndex: key, width: key === "divisionId" ? 180 : 150, render: (value: unknown, row: MpsDashboardRow) => key === "divisionId" ? <Button type="link" disabled={!row.divisionId} onClick={() => apply({ divisionId: String(row.divisionId) })}>{row.divisionName ?? "未分配"}</Button> : mpsMetric(value, key) }))} pagination={false} scroll={{ x: 1400 }} />
      </Card>
      <Space wrap className="mps-cockpit-navigation">
        {can("mps-order-progress-dashboard") && <Button onClick={() => go("/master-plan-order-progress")}>查看在制订单进度</Button>}
        <Button onClick={() => go("/master-plan-gaps")}>查看待处理事项</Button>
        <Button onClick={() => go("/master-plan-reports")}>查看PMC分析明细报表</Button>
      </Space>
    </>}
    <MpsDashboardDrillDrawer key={JSON.stringify(drill)} drill={drill} close={() => setDrill(null)} session={session} filters={filters} />
  </div>;
}
