import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Alert, Button, Card, Empty, Form, Progress, Select, Space, Tabs, Typography, theme } from "antd";
import type { EChartsOption } from "echarts";
import { api } from "../../api";
import { hasResourcePermission, KdosDataTable } from "../../shared/KdosDataTable";
import { KdosChart } from "../../shared/charts/KdosChart";
import { blankPlatformQuery, type PlatformTablePage } from "../../shared/platform-table";
import { dimensionKeys, fields, filterValues, parseFilters, reportContext, reportFilterGroup, serializeFilters, percentText, readable, reportUrl, resource, sessionCacheScope, type ProgressRow, type ReportFilters, type Summary } from "./rd-progress.model";
import { rdStatuses, statusMeta, statusOptions } from "./rd-progress.constants";
import { ItemDetails, OrderDrawer } from "./ProgressDetails";
import { progressColumns } from "./progress-columns";
import { defaultPeriod, periodParams, readReportPeriod, type ReportPeriod } from "./rd-progress.period";
import { ReportCandidateSelect, ReportPeriodPicker } from "./ReportFilterControls";
import "./rd-progress.css";

export function PmcRdProgressPage() {
  if (!hasResourcePermission(resource, "read")) return <Alert type="error" message="当前权限组没有研发进度报表查看权限" />;
  return <ProgressReport />;
}
function ProgressReport() {
  const [urlParams, setParams] = useSearchParams();
  // Apply the user's query immediately; BrowserRouter commits URL transitions asynchronously.
  // Back/refresh still restore from the URL, while export always receives the latest applied filters.
  const [params, setAppliedParams] = useState(urlParams);
  useEffect(() => { setAppliedParams(urlParams); }, [urlParams]);
  // Router transitions can leave the previous tab handler visible briefly. Keep the latest applied URL
  // so a rapid KPI -> tab click cannot restore stale filters before the new render commits.
  const latestParams = useRef(params);
  useLayoutEffect(() => { latestParams.current = params; }, [params]);
  const updateParams = useCallback((next: URLSearchParams | Record<string, string>, replace = false) => {
    latestParams.current = new URLSearchParams(next); setAppliedParams(latestParams.current); setParams(latestParams.current, { replace });
  }, [setParams]);
  const period = useMemo(() => readReportPeriod(params), [params]);
  const filters = useMemo(() => parseFilters(new URLSearchParams({ ...Object.fromEntries(params), ...periodParams(period) })), [params, period]);
  const tab = params.get("tab") === "detail" ? "detail" : "dashboard";
  const [visitedDetail, setVisitedDetail] = useState(tab === "detail");
  const switchTab = (next: string) => { if (next === "detail") setVisitedDetail(true); const url = new URLSearchParams(latestParams.current); url.set("tab", next); updateParams(url); };
  useEffect(() => {
    if (!readable("orderDate")) return;
    const normalized = periodParams(period);
    if (Object.entries(normalized).some(([key, value]) => params.get(key) !== value)) updateParams({ ...Object.fromEntries(params), ...normalized }, true);
  }, [params, period, updateParams]);
  const filterKey = JSON.stringify(filters);
  const [form] = Form.useForm();
  const [advancedForm] = Form.useForm();
  const contextGroup = useMemo(() => reportFilterGroup(filters), [filters]);
  const [query, setQuery] = useState(blankPlatformQuery());
  const [resetEpoch, setResetEpoch] = useState(0);
  const [order, setOrder] = useState<ProgressRow | null>(null);
  const [item, setItem] = useState<ProgressRow | null>(null);
  const { token } = theme.useToken();
  const restoreForm = useCallback((target: typeof form) => target.setFieldsValue({
    ...Object.fromEntries(dimensionKeys.map(key => [key, filterValues(filters[key])])),
    onlyIncomplete: filters.onlyIncomplete ?? "", datePeriod: period
  }), [filters, period]);
  useEffect(() => { if (tab === "dashboard") restoreForm(form); }, [restoreForm, form, tab]);
  const sessionScope = sessionCacheScope();
  const columns = useMemo(() => progressColumns(setOrder, setItem), []);
  const itemsUrl = reportUrl("items", filters, query);
  const summaryUrl = reportUrl("summary", filters, query);
  const items = useQuery({ queryKey: [resource, sessionScope, "items", itemsUrl], queryFn: ({ signal }) => api<PlatformTablePage<ProgressRow>>(itemsUrl, { signal }), retry: false, enabled: tab === "detail" });
  const summary = useQuery({ queryKey: [resource, sessionScope, "summary", summaryUrl], queryFn: ({ signal }) => api<Summary>(summaryUrl, { signal }), retry: false });
  const apply = (next: ReportFilters, nextPeriod = period) => { setQuery(previous => ({ ...previous, page: 1 })); updateParams({ ...serializeFilters(next), ...(readable("orderDate") ? periodParams(nextPeriod) : {}), tab }); };
  const selectStatus = (status?: string) => { const next = { ...filters }; delete next.onlyIncomplete; if (status) next.rdStatus = status; else delete next.rdStatus; apply(next); };
  const incomplete = () => { const next: ReportFilters = { ...filters, onlyIncomplete: "true" }; delete next.rdStatus; apply(next); };
  const clear = () => { setQuery(blankPlatformQuery()); setResetEpoch(previous => previous + 1); updateParams({ ...(readable("orderDate") ? periodParams(defaultPeriod()) : {}), tab }); };
  const submit = (values: Record<string, any>) => {
    const next: ReportFilters = {};
    for (const key of dimensionKeys) {
      const selected = filterValues(values[key]).map(value => value.trim()).filter(Boolean);
      if (selected.length) next[key] = selected;
    }
    if (values.onlyIncomplete === "true") next.onlyIncomplete = "true";
    apply(parseFilters(new URLSearchParams(serializeFilters(next))), values.datePeriod as ReportPeriod ?? period);
  };
  const lastTotal = useRef(0);
  if (items.data) lastTotal.current = items.data.total;
  const data = summary.data;
  const kpis: Array<{ key: keyof Summary; label: string; click?: () => void }> = [
    { key: "orderCount", label: "订单数" }, { key: "itemCount", label: "订单品项数" },
    { key: "completeItemCount", label: "已完成品项", click: () => selectStatus("COMPLETE") },
    { key: "incompleteItemCount", label: "未完成品项", click: incomplete },
    { key: "abnormalItemCount", label: "异常品项", click: () => selectStatus("ABNORMAL") },
    { key: "overallCompletionRate", label: "总体研发完成率" }
  ];
  const chart: EChartsOption = {
    grid: { top: 12, bottom: 16, left: 12, right: 44, containLabel: true }, tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", minInterval: 1 }, yAxis: { type: "category", inverse: true, data: rdStatuses.map(status => status.label) },
    series: [{ type: "bar", barMaxWidth: 22, label: { show: true, position: "right" }, data: rdStatuses.map(status => ({ value: data?.statusCounts?.[String(status.value)] ?? 0, itemStyle: { color: ({ default: token.colorTextTertiary, processing: token.colorPrimary, warning: token.colorWarning, success: token.colorSuccess, error: token.colorError })[statusMeta(status.value).tone] } })) }]
  };
  const filterControls = <div className="pmc-rd-filter-grid">
    {([["orderNo", "订单号"], ["itemCode", "品号"], ["itemName", "品名"], ["division", "事业部"], ["customer", "客户"]] as const).map(([key, label]) => {
      const field = key === "division" ? "divisionId" : key === "customer" ? "customerName" : key;
      return readable(field) ? <Form.Item key={key} name={key} label={label}><ReportCandidateSelect field={field} label={label} /></Form.Item> : null;
    })}
    {([["rdStatus", "研发状态"], ["designBomStatus", "设计BOM状态"], ["routingStatus", "工艺路线状态"]] as const).filter(([key]) => readable(key)).map(([key, label]) => <Form.Item key={key} name={key} label={label}><Select aria-label={label} mode="multiple" allowClear placeholder="全部" options={statusOptions(key)} /></Form.Item>)}
    {readable("rdStatus") && <Form.Item name="onlyIncomplete" label="未完成"><Select aria-label="未完成" allowClear options={[{ value: "", label: "全部" }, { value: "true", label: "只看未完成" }]} /></Form.Item>}
    {readable("orderDate") && <Form.Item name="datePeriod" label="下单日期" className="pmc-rd-date-filter"><ReportPeriodPicker /></Form.Item>}
  </div>;
  const advancedSection = {
    content: <Form form={advancedForm} layout="vertical">{filterControls}</Form>,
    activeCount: dimensionKeys.filter(key => filterValues(filters[key]).length).length + Number(Boolean(filters.onlyIncomplete)) + Number(readable("orderDate")),
    onOpen: () => restoreForm(advancedForm),
    onApply: () => submit(advancedForm.getFieldsValue()),
    onReset: clear
  };
  return <div className="pmc-rd-progress">
    <Tabs activeKey={tab} onChange={switchTab} items={[{ key: "dashboard", label: "图表看板" }, { key: "detail", label: "明细报表" }]} />
    {tab === "dashboard" && <Card size="small" className="pmc-rd-filters"><Form form={form} layout="vertical" onFinish={submit}>
      {filterControls}
      <Space wrap><Button type="primary" htmlType="submit">查询</Button><Button onClick={clear}>重置</Button></Space>
    </Form></Card>}
    {tab === "dashboard" && <>
    {summary.error && <Alert showIcon type="error" message="研发汇总加载失败" description={summary.error.message} action={<Button onClick={() => summary.refetch()}>重试</Button>} />}
    <div className="pmc-rd-kpis" aria-label="研发进度汇总">{kpis.filter(kpi => data?.[kpi.key] !== undefined || (kpi.key === "orderCount" || kpi.key === "itemCount") || readable("rdStatus")).map(kpi => <Card key={kpi.key} size="small" className={kpi.key === "abnormalItemCount" ? "pmc-rd-abnormal" : undefined}>
      {kpi.click ? <Button type="text" className="pmc-rd-kpi-button" onClick={kpi.click} disabled={summary.isPending || Boolean(summary.error)} aria-label={`筛选${kpi.label}`}><span>{kpi.label}</span><strong style={kpi.key === "abnormalItemCount" ? { color: token.colorError } : undefined}>{summary.isPending ? "…" : String(data?.[kpi.key] ?? "—")}</strong></Button> : <div className="pmc-rd-kpi"><span>{kpi.label}</span><strong>{summary.isPending ? "…" : kpi.key === "overallCompletionRate" ? percentText(data?.overallCompletionRate) : String(data?.[kpi.key] ?? "—")}</strong></div>}
    </Card>)}</div>
    <div className="pmc-rd-analysis"><Card size="small" title="研发环节完成情况"><Space direction="vertical" style={{ width: "100%" }}>
      {readable("rdStatus") && <><Typography.Text>总体研发完成率：{percentText(data?.overallCompletionRate)}</Typography.Text>{data?.overallCompletionRate != null && <Progress percent={Number(data.overallCompletionRate)} showInfo={false} aria-label="总体研发完成率" />}</>}
      {readable("designBomStatus") && readable("rdStatus") && <Typography.Text>设计BOM完成率：{percentText(data?.designBomCompletionRate)}</Typography.Text>}
      {readable("routingStatus") && readable("routingControl") && readable("rdStatus") && <Typography.Text>工艺路线完成率：{percentText(data?.routingCompletionRate)}</Typography.Text>}
      {readable("rdStatus") && <Typography.Text>不适用品项数：{data?.notApplicableItemCount ?? "—"}</Typography.Text>}
    </Space></Card>{readable("rdStatus") && <Card size="small" title="研发状态分布"><KdosChart ariaLabel="研发状态分布" option={chart} height={240} loading={summary.isPending} empty={!data?.itemCount || Boolean(summary.error)} /></Card>}</div>
    {readable("rdStatus") && <Space wrap className="pmc-rd-status-filters" aria-label="状态快捷筛选"><Button size="small" type={!filters.rdStatus && !filters.onlyIncomplete ? "primary" : "default"} onClick={() => selectStatus()}>全部状态</Button>{rdStatuses.map(status => <Button key={String(status.value)} size="small" type={filterValues(filters.rdStatus).includes(String(status.value)) ? "primary" : "default"} onClick={() => selectStatus(String(status.value))}>{status.label}</Button>)}</Space>}
    </>}
    {(visitedDetail || tab === "detail") && <div hidden={tab !== "detail"} className="pmc-rd-detail">
    {items.error && <Alert showIcon type="error" message="研发明细加载失败" description={items.error.message} action={<Button onClick={() => items.refetch()}>重试</Button>} />}
    <KdosDataTable<ProgressRow> key={resetEpoch} resource={resource} viewKey="pmc-report" systemFields={false} selectable={false} rowKey="id" columns={columns} dataSource={items.data?.rows ?? []} loading={items.isPending} printContext={reportContext(filters)} contextFilterGroup={contextGroup} quickSearch={false} advancedFilterSection={advancedSection} filterFields={fields} serverData={{ total: items.data?.total ?? lastTotal.current, resetKey: filterKey, onQueryChange: setQuery }} scroll={{ x: "max-content" }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选条件下暂无研发品项"><Button onClick={clear}>清空筛选</Button></Empty> }} />
    </div>}
    {tab === "detail" && order && <OrderDrawer key={String(order.sourceOrderId)} row={order} close={() => setOrder(null)} />}
    {tab === "detail" && item && <ItemDetails row={item} close={() => setItem(null)} />}
  </div>;
}
