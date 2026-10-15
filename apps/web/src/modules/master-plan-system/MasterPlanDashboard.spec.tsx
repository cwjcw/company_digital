import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { standardProcesses } from "@tracker/shared";
import { tablePermissionFieldsFor, mpsDashboardGaps, type MpsDashboardData } from "@kdos/contracts";
import { api } from "../../api";
import { MasterPlanDashboard } from "./MasterPlanDashboard";
import { mpsMetric, mpsTrendTooltip, MPS_PROCESS_CHART_PALETTE } from "./master-plan-dashboard.utils";
vi.mock("../../api", () => ({ api: vi.fn() }));
vi.mock("../../shared/charts", () => ({ KdosChart: ({ ariaLabel, onDataClick, empty, loading }: { ariaLabel: string; onDataClick?: (e: { name: string; dataIndex: number }) => void; empty?: boolean; loading?: boolean }) => <button aria-label={ariaLabel} data-empty={String(empty)} data-loading={String(loading)} onClick={() => onDataClick?.({ name: "待完善", dataIndex: 0 })} /> }));
const resource = "mps-overview-dashboard";
function fixture(): MpsDashboardData { return { gaps: Object.fromEntries(mpsDashboardGaps.map(g => [g.key,2])), visibleFields: tablePermissionFieldsFor(resource).map(f => f.key), generatedAt: "2026-10-15T01:00:00Z", trendStart: "2026-10-08", trendEnd: "2026-10-14", orders: { orderCount: 2, orderRequiredQuantity: "500", orderCompletedQuantity: "300", orderCompletionRate: ".6" }, plans: { requiredQuantity: "500", dispatchedWeeklyQuantity: "300", dispatchRate: ".6", cumulativeInboundQuantity: "100", pendingQuantity: "400", inboundRate: ".2" }, readiness: [{ status: "待完善", count: 1, ratio: "1" }], auxiliary: [], processes: [...standardProcesses].sort((a,b)=>a.order-b.order).map(p => ({ ...p, values: { requiredQuantity: "500", reportedQuantity: "525", productionProgress: "1.05" }, states: [{ status: "已完成", count: 1 }] })), trend: [{ productionDate: "2026-10-14", [`${standardProcesses[0]!.code}ReportedQuantity`]: "525" }], divisions: [], risks: { rows: [], total: 0, page: 1, pageSize: 20 } }; }
const clients = new Set<QueryClient>();
function renderPage() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.add(client); return { client, ...render(<QueryClientProvider client={client}><MasterPlanDashboard /></QueryClientProvider>) }; }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); localStorage.setItem("sessionUser", JSON.stringify({ sub: "fixture", permissions: ["*"], isSystemAdmin: true })); vi.mocked(api).mockImplementation(async path => { if (path.includes("/candidates")) return { options: path.includes("field=orderNumber") ? [{value:"SO-1",label:"SO-1"},{value:"SO-2",label:"SO-2"}] : [], hasMore: false } as never; if((path.includes("/table")||path.includes("/reports/")||path.includes("/gaps")))return {rows:[],total:0,visibleFields:fixture().visibleFields} as never; if (path.endsWith("/meta")) return { fields: [{ key: "orderNumber", label: "订单号" }] } as never; if (path.includes("/drill")) return { rows: [], total: 0 } as never; return fixture() as never; }); });
afterEach(async () => { await act(async () => { cleanup(); await Promise.all([...clients].map(client => client.cancelQueries())); for (const client of clients) client.clear(); clients.clear(); }); });
describe("MasterPlanDashboard", () => {
  it("starts with filters, no repeated title/subtitle/date; shared process structure and >100%", async () => {
    renderPage(); await screen.findByText("订单概况"); expect(screen.queryByText("主计划综合大屏")).not.toBeInTheDocument(); expect(screen.queryByText(/本页面用于|实时掌握|统计日期/)).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "事业部" })).toBeInTheDocument(); expect(screen.getByRole("combobox", { name: "客户" })).toBeInTheDocument();
    expect(screen.getAllByText("105%").length).toBe(standardProcesses.length); for (const p of standardProcesses) expect(screen.getByText(p.name, { exact: true })).toBeInTheDocument();
  });
  it("applies order search to whole query, clears and refreshes manually", async () => {
    renderPage(); await screen.findByText("订单概况"); const input = screen.getByRole("combobox", { name: "订单号" }); fireEvent.mouseDown(input); fireEvent.click(await screen.findByText("SO-1",{selector:".ant-select-item-option-content"}));
    await waitFor(() => expect(vi.mocked(api).mock.calls.some(([url]) => decodeURIComponent(url).includes('orderNumbers=["SO-1"]'))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "清空筛选" })); await waitFor(() => expect(input).toHaveValue("")); const before = vi.mocked(api).mock.calls.length; fireEvent.click(screen.getByRole("button", { name: "刷新数据" })); await waitFor(() => expect(vi.mocked(api).mock.calls.length).toBeGreaterThan(before));
  });
  it("chart click drills through formal permission checked metadata and rows APIs", async () => {
    renderPage(); await screen.findByText("计划准备"); fireEvent.click(screen.getByRole("button", { name: "计划准备状态分布" }));
    await waitFor(() => expect(vi.mocked(api).mock.calls.some(([url]) => url.includes("/drill?") && url.includes("resourceCode=mps-base-plans") && decodeURIComponent(url).includes('"weeklyPlanState"'))).toBe(true));
  });
  it("shows empty and loading states without fabricated zero progress", async () => {
    vi.mocked(api).mockImplementation(async path => path.includes("candidates") ? { options: [], hasMore: false } as never : (path.includes("/table")||path.includes("/reports/")||path.includes("/gaps")) ? {rows:[],total:0,visibleFields:fixture().visibleFields} as never : { ...fixture(), plans: {}, readiness: [], trend: [], processes: standardProcesses.map(p=>({...p,values:{productionProgress:null},states:[]})) } as never);
    renderPage(); expect(screen.getByLabelText("加载中")).toBeInTheDocument(); await screen.findByText("订单概况"); expect(screen.getByRole("button", { name: "标准工序生产进度" })).toHaveAttribute("data-empty", "true");
  });
  it("keeps server errors visible", async () => { vi.mocked(api).mockRejectedValue(new Error("聚合查询失败")); renderPage(); expect(await screen.findByText("聚合查询失败")).toBeInTheDocument(); });
  it("blocks dashboard without its own read and makes no requests", async () => { localStorage.setItem("sessionUser", JSON.stringify({ permissions: ["mps-monthly-plans:*:read"] })); renderPage(); expect(screen.getByText("没有主计划综合大屏查看权限")).toBeInTheDocument(); expect(api).not.toHaveBeenCalled(); });
  it("formats null safely and preserves numeric over-completion", () => { expect(mpsMetric(null, "Rate")).toBe("—"); expect(mpsMetric("1.05", "Progress")).toBe("105%"); expect(mpsMetric(".51", "Rate")).toBe("51%"); expect(mpsMetric(Infinity)).toBe("—"); });
  it("starts without date period, switches all queries to order dates and clear restores no date",async()=>{
    renderPage();await screen.findByText("订单概况");expect(screen.queryByRole("combobox",{name:"日期周期"})).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("combobox",{name:"日期类型"}));fireEvent.click(screen.getByText("订单日期",{selector:".ant-select-item-option-content"}));
    expect(await screen.findByRole("combobox",{name:"日期周期"})).toBeInTheDocument();
    await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([url])=>(url.includes("/reports/")||url.includes("/gaps?"))&&url.includes("dateType=ORDER"))).toBe(true));
    fireEvent.click(screen.getByRole("button",{name:"清空筛选"}));await waitFor(()=>expect(screen.queryByRole("combobox",{name:"日期周期"})).not.toBeInTheDocument());
  });
  it("each formal table has its own export and export permissions hide them all",async()=>{
    const view=renderPage();await screen.findByText("订单概况");expect(screen.getAllByRole("button",{name:"导出"})).toHaveLength(6);
    view.unmount();localStorage.setItem("sessionUser",JSON.stringify({permissions:[resource+":*:read"]}));renderPage();await screen.findByText("订单概况");expect(screen.queryAllByRole("button",{name:"导出"})).toHaveLength(0);
  });
  it("gap KPI switches the server-paginated list; all three standard reports load independently",async()=>{
    renderPage();await screen.findByText("待处理事项");
    fireEvent.click(screen.getByRole("button",{name:/^未入库/}));
    await waitFor(()=>expect(vi.mocked(api).mock.calls.some(([url])=>url.includes("/gaps?")&&url.includes("type=no-inbound")&&url.includes("pageSize=100"))).toBe(true));
    for(const key of ["plan-readiness","process-execution","risk-exception"])expect(vi.mocked(api).mock.calls.some(([url])=>url.includes("/reports/"+key))).toBe(true);
    expect(screen.getByRole("tab",{name:"未入库 2"})).toHaveAttribute("aria-selected","true");
  });
  it("trend palette and tooltip distinguish registry processes and preserve stable order",()=>{
    expect(new Set(MPS_PROCESS_CHART_PALETTE).size).toBeGreaterThanOrEqual(standardProcesses.length);
    const rows=[...standardProcesses].reverse().map(p=>({name:p.name,order:p.order,quantity:p.order}));const text=mpsTrendTooltip("2026-10-14",rows);
    expect(text).toContain("总报工数量：55");let last=-1;for(const p of [...standardProcesses].sort((a,b)=>a.order-b.order)){expect(text.indexOf(p.name)).toBeGreaterThan(last);last=text.indexOf(p.name);}
  });

});
