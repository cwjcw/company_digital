import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { standardProcesses } from "@tracker/shared";
import { tablePermissionFieldsFor, mpsDashboardGaps, readMpsDashboardNavigation, type MpsDashboardSummary } from "@kdos/contracts";
import { api } from "../../api";
import { MasterPlanDashboard } from "./MasterPlanDashboard";
import { mpsMetric, mpsTrendTooltip, MPS_PROCESS_CHART_PALETTE } from "./master-plan-dashboard.utils";
vi.mock("../../api", () => ({ api: vi.fn() }));
const chartOptions = new Map<string, any>();
vi.mock("../../shared/charts", () => ({ KdosChart: ({ ariaLabel, onDataClick, empty, loading, option }: any) => { chartOptions.set(ariaLabel, option); return <button aria-label={ariaLabel} data-empty={String(empty)} data-loading={String(loading)} onClick={() => onDataClick?.({ name: ariaLabel === "订单完成情况分布" ? "未完成" : "待完善", dataIndex: 0 })} />; } }));
const resource = "mps-overview-dashboard", divisionId = "0199d000-0000-7000-8000-000000000010";
function fixture(): MpsDashboardSummary {
  return { gaps: Object.fromEntries(mpsDashboardGaps.map(g => [g.key, 2])), visibleFields: tablePermissionFieldsFor(resource).map(f => f.key), generatedAt: "2026-10-16T01:00:00Z", trendStart: "2026-10-09", trendEnd: "2026-10-15", orders: { orderCount: 5, unfinishedOrderCount: 3, orderRequiredQuantity: "500", orderCompletedQuantity: "300", orderCompletionRate: ".6" }, plans: { requiredQuantity: "500", dispatchedWeeklyQuantity: "300", dispatchRate: ".6", cumulativeInboundQuantity: "100", pendingQuantity: "400", inboundRate: ".2", overdueCount: 2 }, readiness: [{ status: "待完善", count: 1, ratio: "1" }], auxiliary: ["technical", "hardware", "wood", "outsourcing"].map(key => ({ key, states: [{ status: "延期", count: 1 }] })), processes: [...standardProcesses].reverse().map(p => ({ ...p, values: { requiredQuantity: "500", reportedQuantity: "525", productionProgress: "1.05" }, states: [{ status: "延期", count: 1 }] })), trend: [{ productionDate: "2026-10-15", ...Object.fromEntries(standardProcesses.map(p => [p.code + "ReportedQuantity", "10"])) }], divisions: [{ divisionId, divisionName: "合成事业部", requiredQuantity: "500", dispatchedWeeklyQuantity: "300", cumulativeInboundQuantity: "100", pendingQuantity: "400", dispatchRate: ".6", inboundRate: ".2", overdueCount: 2, exceptionCount: 2 }] };
}
function Location() { const location = useLocation(); return <output aria-label="当前位置">{location.pathname + location.search}</output>; }
const clients = new Set<QueryClient>();
function renderPage() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.add(client); return render(<MemoryRouter initialEntries={["/master-plan-dashboard"]}><QueryClientProvider client={client}><MasterPlanDashboard /><Location /></QueryClientProvider></MemoryRouter>); }
const urls = () => vi.mocked(api).mock.calls.map(([url]) => new URL(url, "http://fixture"));
beforeEach(() => {
  vi.clearAllMocks(); chartOptions.clear(); localStorage.clear(); localStorage.setItem("sessionUser", JSON.stringify({ sub: "fixture", permissions: ["*"], isSystemAdmin: true }));
  vi.mocked(api).mockImplementation(async path => {
    if (path.includes("/candidates")) return { options: path.includes("field=orderNumber") ? [{ value: "SO-1", label: "SO-1" }] : [], hasMore: false } as never;
    if (path.endsWith("/meta")) return { fields: [{ key: "orderNumber", label: "订单号" }] } as never;
    if (path.includes("/drill")) return { rows: [], total: 0 } as never;
    return fixture() as never;
  });
});
afterEach(async () => { await act(async () => { cleanup(); await Promise.all([...clients].map(client => client.cancelQueries())); for (const client of clients) client.clear(); clients.clear(); }); });
describe("PMC cockpit at the original dashboard URL", () => {
  it("starts with nine compact formal KPIs and only an aggregate request, no detailed worklists", async () => {
    renderPage(); await screen.findByText("订单概况（订单数）");
    expect(document.querySelectorAll(".mps-cockpit-core .ant-statistic")).toHaveLength(9);
    expect(screen.getByText("订单整体完成率", { selector: ".ant-statistic-title" }).closest(".ant-statistic")).toHaveTextContent("60%");
    expect(screen.getByText("周计划下达率", { selector: ".ant-statistic-title" }).closest(".ant-statistic")).toHaveTextContent("60%");
    for (const title of ["PMC综合驾驶舱", "主计划综合大屏", "待处理清单", "计划待完善明细", "工序执行明细", "风险与异常"]) expect(screen.queryByText(title, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/本页面用于|实时掌握|统计日期/)).not.toBeInTheDocument(); expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(urls().filter(u => u.pathname.endsWith("/summary"))).toHaveLength(1);
    expect(urls().some(u => u.pathname.endsWith("/gaps") || u.pathname.includes("/reports/") || u.pathname.endsWith("/table"))).toBe(false);
  });
  it("order distribution stays at order grain and does not add overdue plan items", async () => {
    renderPage(); await screen.findByText("订单概况（订单数）");
    expect(chartOptions.get("订单完成情况分布").series[0].data.map((r: any) => [r.name, r.value])).toEqual([["已完成", 2], ["未完成", 3]]);
  });
  it("preserves ten process order, actual quantities, 105% and independent delayed states", async () => {
    renderPage(); await screen.findByText("工序生产进度");
    const progress = chartOptions.get("标准工序生产进度"), states = chartOptions.get("标准工序状态分布");
    expect(progress.yAxis.data).toEqual([...standardProcesses].sort((a, b) => a.order - b.order).map(p => p.name));
    expect(progress.series[0].data).toEqual(Array(10).fill(105)); expect(progress.xAxis.max).toBeUndefined();
    expect(progress.tooltip.formatter([{ dataIndex: 0 }])).toContain("累计实际报工：525");
    expect(progress.tooltip.formatter([{ dataIndex: 0 }])).toContain("延期 1");
    expect(states.series[0]).toMatchObject({ name: "延期", data: Array(10).fill(1) });
    fireEvent.click(screen.getByText("工序执行汇总", { exact: true })); await waitFor(() => expect(screen.getAllByText("105%")).toHaveLength(10));
  });
  it("uses separate quantity, percent and risk plots and all four official auxiliary groups", async () => {
    renderPage(); await screen.findByText("事业部交付对比");
    expect(chartOptions.get("事业部计划数量对比").series).toHaveLength(4);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "事业部对比指标" })); fireEvent.click(screen.getByText("比例", { selector: ".ant-select-item-option-content" }));
    expect(chartOptions.get("事业部计划比例对比").series.map((s: any) => s.data)).toEqual([[60], [20]]);
    expect(chartOptions.get("事业部计划比例对比").yAxis.axisLabel.formatter).toBe("{value}%");
    for (const title of ["技术/图纸计划", "五金主材计划", "木作主材计划", "外协计划"]) expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.queryByText(/齐套率|产能瓶颈|不适用/)).not.toBeInTheDocument();
  });
  it("updates the shared summary scope, clears to no date and refreshes without sync calls", async () => {
    renderPage(); const input = await screen.findByRole("combobox", { name: "订单号" }); fireEvent.mouseDown(input); fireEvent.click(await screen.findByText("SO-1", { selector: ".ant-select-item-option-content" }));
    await waitFor(() => expect(urls().filter(u => u.pathname.endsWith("/summary")).at(-1)?.searchParams.get("orderNumbers")).toBe('["SO-1"]'));
    expect(screen.queryByRole("combobox", { name: "日期周期" })).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "日期类型" })); fireEvent.click(screen.getByText("订单日期", { selector: ".ant-select-item-option-content" }));
    await waitFor(() => expect(urls().filter(u => u.pathname.endsWith("/summary")).at(-1)?.searchParams.get("dateType")).toBe("ORDER"));
    expect(chartOptions.get("最近7天实际报工").xAxis.data).toEqual(["2026-10-15"]);
    fireEvent.click(screen.getByRole("button", { name: "清空筛选" })); await waitFor(() => expect(input).toHaveValue("")); expect(screen.queryByRole("combobox", { name: "日期周期" })).not.toBeInTheDocument();
    const before = urls().filter(u => u.pathname.endsWith("/summary")).length; fireEvent.click(screen.getByRole("button", { name: "刷新数据" })); await waitFor(() => expect(urls().filter(u => u.pathname.endsWith("/summary")).length).toBeGreaterThan(before));
    expect(urls().some(u => u.pathname.includes("sync"))).toBe(false);
  });
  it("division chart/name change one shared scope for every aggregate", async () => {
    renderPage(); await screen.findByText("事业部交付对比"); fireEvent.click(screen.getByRole("button", { name: "事业部计划数量对比" }));
    await waitFor(() => expect(urls().filter(u => u.pathname.endsWith("/summary")).at(-1)?.searchParams.get("divisionId")).toBe(divisionId));
  });
  it("risk summary navigates to its exact gap and carries scope without mixing grain", async () => {
    renderPage(); const input = await screen.findByRole("combobox", { name: "订单号" }); fireEvent.mouseDown(input); fireEvent.click(await screen.findByText("SO-1", { selector: ".ant-select-item-option-content" }));
    fireEvent.click(screen.getByRole("button", { name: /生产异常 2 月计划条/ }));
    const url = new URL(screen.getByLabelText("当前位置").textContent!, "http://fixture"); expect(url.pathname).toBe("/master-plan-gaps"); expect(readMpsDashboardNavigation(url.search)).toEqual({ filters: { dateType: "NONE", orderNumbers: ["SO-1"] }, gap: "production-exception" });
  });
  it("formal chart drill retains the source resource authorization and scope", async () => {
    renderPage(); await screen.findByText("计划准备"); fireEvent.click(screen.getByRole("button", { name: "计划准备状态分布" }));
    await waitFor(() => expect(urls().some(u => u.pathname.endsWith("/drill") && u.searchParams.get("resourceCode") === "mps-base-plans" && u.searchParams.get("filterGroup")?.includes("weeklyPlanState"))).toBe(true));
  });
  it("only offers the independent order screen when its own read is granted", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ permissions: [resource + ":*:read"] })); renderPage(); await screen.findByText("交付风险摘要");
    expect(screen.queryByRole("button", { name: "查看在制订单进度" })).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "查看待处理事项" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出" })).not.toBeInTheDocument();
  });
  it("shows no-demand progress as — and never creates zero values for hidden reporting fields", async () => {
    const data = fixture(); data.processes = data.processes.map(p => ({ ...p, values: {}, states: [] })); data.trend = []; data.visibleFields = data.visibleFields.filter(k => !/ReportedQuantity$|Status$|ProductionProgress$/.test(k)); data.gaps = {};
    vi.mocked(api).mockResolvedValue(data as never); renderPage(); await screen.findByText("工序生产进度");
    expect(chartOptions.get("标准工序生产进度").series[0].data).toEqual(Array(10).fill(null));
    expect(chartOptions.get("标准工序状态分布").series).toEqual([]); expect(chartOptions.get("最近7天实际报工").series).toEqual([]);
    expect(screen.queryByRole("button", { name: /生产异常.*月计划条/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("工序执行汇总", { exact: true })); expect(screen.queryByRole("columnheader", { name: "累计实际报工" })).not.toBeInTheDocument();
  });
  it("blocks without overview read and never makes requests", () => {
    localStorage.setItem("sessionUser", JSON.stringify({ permissions: ["mps-monthly-plans:*:read"] })); renderPage(); expect(screen.getByText("没有PMC综合驾驶舱查看权限")).toBeInTheDocument(); expect(api).not.toHaveBeenCalled();
  });
  it("keeps explicit loading and error states", async () => {
    vi.mocked(api).mockRejectedValue(new Error("聚合查询失败")); renderPage(); expect(screen.getByLabelText("加载中")).toBeInTheDocument(); expect(await screen.findByText("聚合查询失败")).toBeInTheDocument();
  });
  it("keeps registry trend palette, ordered Chinese tooltip and null-safe formatting", () => {
    expect(new Set(MPS_PROCESS_CHART_PALETTE).size).toBeGreaterThanOrEqual(10); expect(mpsMetric(null, "Rate")).toBe("—"); expect(mpsMetric("1.05", "Progress")).toBe("105%"); expect(mpsMetric(Infinity)).toBe("—");
    const text = mpsTrendTooltip("2026-10-15", [...standardProcesses].reverse().map(p => ({ name: p.name, order: p.order, quantity: p.order })));
    expect(text).toContain("总报工数量：55"); let last = -1; for (const p of [...standardProcesses].sort((a, b) => a.order - b.order)) { expect(text.indexOf(p.name)).toBeGreaterThan(last); last = text.indexOf(p.name); }
  });
});
