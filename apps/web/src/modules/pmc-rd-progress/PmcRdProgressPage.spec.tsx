import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { PmcRdProgressPage } from "./PmcRdProgressPage";
import { businessTime, orderFilter, parseFilters, percentText, reportNavigation, reportUrl, reportFilterGroup, serializeFilters, mergeFilterGroups } from "./rd-progress.model";
import { defaultPeriod, periodBounds, periodForMode, readReportPeriod } from "./rd-progress.period";
import { rdStatuses, statusMeta } from "./rd-progress.constants";
vi.mock("../../api", () => ({ api: vi.fn() }));
vi.mock("../../shared/charts/KdosChart", () => ({ KdosChart: ({ option }: { option: unknown }) => <div data-testid="chart">{JSON.stringify(option)}</div> }));
vi.mock("../../shared/table-export", () => ({ useTableExportCapabilities: () => ({ data: [{ code: "pmc-rd-progress", supported: true, allowed: true }] }), tableExportAllowed: () => true, exportTable: vi.fn(async () => new Blob(["xlsx"])) }));
import { exportTable } from "../../shared/table-export";
const row = { id: "row-1", sourceOrderId: "order-id", orderNo: "ORDER-1", customerName: "客户甲", customerCode: "C001", divisionId: "division-id", divisionName: "事业一部", orderDate: "2026-10-06T00:00:00.000Z", itemCode: "ITEM-1", itemName: "品项甲", itemSpec: "规格甲", businessQty: "12.500000", designBomStatus: "COMPLETE", routingStatus: "NOT_STARTED", rdStatus: "WAITING_ROUTING", reasonText: "等待工艺路线", rdLastModifiedAt: "2026-10-06 18:05:01.123456", orderLastModifiedDate: "2026-10-06 18:01:00.000000" };
const summary = { orderCount: 88, itemCount: 201, completeItemCount: 71, incompleteItemCount: 123, notApplicableItemCount: 7, abnormalItemCount: 6, overallCompletionRate: "36.60", designBomCompletionRate: "62.31", routingCompletionRate: "38.40", statusCounts: Object.fromEntries(rdStatuses.map((status, index) => [status.value, index + 1])) };
let itemError = false, summaryError = false, empty = false;
function Location() { return <div data-testid="location">{useLocation().search}</div>; }
function mount(path = "/pmc/reports/rd-progress", permissions?: string[], dashboard = false) {
  if (!dashboard) path += `${path.includes("?") ? "&" : "?"}tab=detail`;
  localStorage.setItem("sessionUser", JSON.stringify(permissions ? { sub: "worker", permissions } : { sub: "admin", permissions: ["*"], isSystemAdmin: true }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AntApp><MemoryRouter initialEntries={[path]}><Location /><PmcRdProgressPage /></MemoryRouter></AntApp></QueryClientProvider>);
}
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); itemError = false; summaryError = false; empty = false;
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/pmc/reports/rd-progress/items")) { if (itemError) throw new Error("明细服务故障"); return { rows: empty ? [] : [row], total: empty ? 0 : 201, page: 1, pageSize: 100 } as never; }
    if (path.startsWith("/pmc/reports/rd-progress/summary")) { if (summaryError) throw new Error("汇总服务故障"); return summary as never; }
    if (path.endsWith("sync-status")) return { latestSync: { status: "SUCCESS", mode: "INCREMENTAL", sourceSnapshotAt: "2026-10-07 14:30:00.000001", completedAt: "2026-10-07T06:31:00Z" } } as never;
    if (path.startsWith("/pmc/reports/rd-progress/orders")) return { rows: [{ sourceOrderId: "order-id", orderNo: "ORDER-1", totalItemCount: 201, applicableItemCount: 194, completeItemCount: 71, incompleteItemCount: 123, abnormalItemCount: 6, completionRate: "36.60", orderRdStatus: "IN_PROGRESS" }], total: 1 } as never;
    if (path === "/table-filters/resources") return [{ code: "pmc-rd-progress", filterableFields: tablePermissionFieldsFor("pmc-rd-progress") }] as never;
    if (path.startsWith("/table-filters/candidates")) {
      const params = new URLSearchParams(path.split("?")[1]); const field = params.get("field")!;
      const options = field === "customerName" ? [{ value: "客户甲", label: "客户甲" }] : field === "divisionId" ? [{ value: "division-id", label: "事业一部" }] : [1, 2].map(index => ({ value: `${field}-${index}`, label: `${field}-${index}` }));
      return { options: options.filter(option => option.label.includes(params.get("search") ?? "")), hasMore: true } as never;
    }
    return [] as never;
  });
});
afterEach(cleanup);
const calls = (endpoint: string) => vi.mocked(api).mock.calls.map(([path]) => path).filter(path => path.startsWith(`/pmc/reports/rd-progress/${endpoint}?`));
describe("PMC研发正式报表", () => {
  it("图表和明细分离，使用API汇总、七个状态和源时间并保留服务端小数", async () => {
    mount(); expect(await screen.findByText("品项甲")).toBeInTheDocument();
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "图表看板" }));
    expect(await screen.findAllByText("36.60%", { exact: false })).toHaveLength(2);
    expect(screen.queryByText("同步成功")).not.toBeInTheDocument(); expect(screen.getByText("2026-10-06 18:05:01")).toBeInTheDocument();
    expect(screen.getByText("12.500000")).toBeInTheDocument(); expect(screen.getByTestId("chart")).toHaveTextContent("设计 BOM 进行中");
    expect(screen.getByText("品项甲").closest(".pmc-rd-detail")).toHaveAttribute("hidden");
    expect(calls("items")[0]).toContain("pageSize=100"); expect(calls("items")[0]).not.toContain("onlyIncomplete");
    expect(screen.queryByRole("button", { name: /编辑模式|同步数据|新增/ })).not.toBeInTheDocument();
  });
  it("明细不渲染常驻条件，现有高级筛选包含全部条件，取消不会应用草稿", async () => {
    const { container } = mount(); await screen.findByText("品项甲");
    expect(container.querySelector(".pmc-rd-filters")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "订单号" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /高级筛选/ }));
    const panel = await screen.findByTestId("advanced-filter-panel");
    for (const label of ["订单号", "品号", "品名", "客户", "事业部", "研发状态", "设计BOM状态", "工艺路线状态", "未完成", "日期周期", "统计日期"])
      expect(within(panel).getByRole(label === "统计日期" ? "textbox" : "combobox", { name: label })).toBeInTheDocument();
    const before = calls("items").length;
    fireEvent.change(within(panel).getByRole("combobox", { name: "订单号" }), { target: { value: "SEARCH" } });
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining("search=SEARCH"), expect.anything()));
    expect(calls("items")).toHaveLength(before);
    fireEvent.click(screen.getByRole("button", { name: /高级筛选/ }));
    expect(calls("items")).toHaveLength(before);
  });
  it("URL恢复全部核心筛选，导出传当前上下文和业务可见列", async () => {
    mount("/pmc/reports/rd-progress?orderNo=SO-9&customer=C&division=division-id&itemCode=P&itemName=N&rdStatus=ABNORMAL&designBomStatus=ABNORMAL&routingStatus=NOT_STARTED&orderDateFrom=2026-09-01&orderDateTo=2026-10-07&onlyIncomplete=true");
    await screen.findByText("品项甲"); fireEvent.click(await screen.findByRole("button", { name: /高级筛选/ }));
    expect(within(await screen.findByTestId("advanced-filter-panel")).getByText("SO-9")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /高级筛选/ }));
    fireEvent.click(await screen.findByRole("button", { name: /导出/ }));
    await waitFor(() => expect(exportTable).toHaveBeenCalled()); const request = vi.mocked(exportTable).mock.calls[0]![0];
    expect(request.context).toEqual(expect.objectContaining({ onlyIncomplete: "true", orderDateFrom: "2026-09-01", division: "division-id", itemName: "N", customer: "C" }));
    expect(request.columnKeys).toContain("reasonText"); expect(request.columnKeys).not.toContain("sourceOrderLineId"); expect(request).not.toHaveProperty("page");
  });
  it.each([["筛选已完成品项", "rdStatus=COMPLETE"], ["筛选异常品项", "rdStatus=ABNORMAL"], ["筛选未完成品项", "onlyIncomplete=true"]])("KPI %s 调用后端且回第一页", async (button, expected) => {
    mount(); await screen.findByText("品项甲"); fireEvent.click(screen.getByTitle("2"));
    await waitFor(() => expect(calls("items").some(path => path.includes("page=2"))).toBe(true));
    fireEvent.click(screen.getByRole("tab", { name: "图表看板" }));
    fireEvent.click(await screen.findByRole("button", { name: button }));
    fireEvent.click(screen.getByRole("tab", { name: "明细报表" }));
    await waitFor(() => expect(calls("items").at(-1)).toContain(expected)); expect(calls("items").at(-1)).toContain("page=1");
  });
  it("从COMPLETE切到未完成清除冲突状态，快捷状态清除onlyIncomplete", async () => {
    mount("/pmc/reports/rd-progress?rdStatus=COMPLETE", undefined, true); await screen.findAllByText("36.60%", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: "筛选未完成品项" })); await waitFor(() => expect(calls("summary").at(-1)).toContain("onlyIncomplete=true")); expect(calls("summary").at(-1)).not.toContain("rdStatus=");
    fireEvent.click(screen.getByRole("button", { name: /^异\s*常$/ })); await waitFor(() => expect(calls("summary").at(-1)).toContain("rdStatus=ABNORMAL")); expect(calls("summary").at(-1)).not.toContain("onlyIncomplete");
  });
  it("打开订单按稳定ID重新请求全部授权品项，关闭Drawer不改主表筛选", async () => {
    mount("/pmc/reports/rd-progress?rdStatus=WAITING_ROUTING"); await screen.findByText("品项甲");
    fireEvent.click(screen.getByRole("button", { name: "ORDER-1" })); const drawer = await screen.findByRole("dialog");
    await waitFor(() => expect(within(drawer).getByText("研发进行中")).toBeInTheDocument());
    const orderUrl = calls("orders").at(-1)!; expect(JSON.parse(new URLSearchParams(orderUrl.split("?")[1]).get("filterGroup")!)).toEqual(orderFilter("order-id")); expect(orderUrl).not.toContain("rdStatus=");
    expect(within(drawer).getByText("36.60%")).toBeInTheDocument(); fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    expect(screen.getByTestId("location")).toHaveTextContent("rdStatus=WAITING_ROUTING");
  });
  it("无read权限时无菜单、不加载报表API；字段权限裁剪状态、筛选、tooltips", async () => {
    mount(undefined, []); expect(screen.getByText("当前权限组没有研发进度报表查看权限")).toBeInTheDocument(); expect(reportNavigation()).toEqual([]); expect(api).not.toHaveBeenCalled(); cleanup();
    mount(undefined, ["pmc-rd-progress:*:read", "pmc-rd-progress:orderNo:read"]); await screen.findByText("ORDER-1");
    expect(screen.queryByText("研发状态分布")).not.toBeInTheDocument(); expect(screen.queryByPlaceholderText("请输入品项编码")).not.toBeInTheDocument(); expect(screen.queryByText("品项甲")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "ORDER-1" })).not.toBeInTheDocument();
  });
  it.each([[true, false, "研发明细加载失败"], [false, true, "研发汇总加载失败"]])("错误彼此独立，并且有重试按钮", async (a, b, message) => {
    itemError = a; summaryError = b; mount(); if (b) fireEvent.click(screen.getByRole("tab", { name: "图表看板" })); expect(await screen.findByText(message)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "重 试" })).toBeInTheDocument(); if (!a && !b) expect(await screen.findByText("品项甲")).toBeInTheDocument();
  });
  it("空数据允许清空所有筛选", async () => {
    empty = true; mount("/pmc/reports/rd-progress?orderNo=no-match"); expect(await screen.findByText("当前筛选条件下暂无研发品项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清空筛选" })); await waitFor(() => expect(calls("items").at(-1)).not.toContain("orderNo="));
  });
});
describe("展示与参数边界", () => {
  it("不转换E10墙钟时间，只将带时区同步时间转为上海时间", () => { expect(businessTime("2026-10-06 23:59:59.999999")).toBe("2026-10-06 23:59:59"); expect(businessTime("2026-10-06T16:01:00Z")).toBe("2026-10-07 00:01:00"); expect(percentText(null)).toBe("—"); });
  it("字典中文直接来自契约，V保持原始值", () => { expect(statusMeta("COMPLETE").label).toBe("研发完成"); expect(statusMeta("V", "designBomStatus").label).toBe("V"); expect(rdStatuses).toHaveLength(7); });
  it("汇总无分页，筛选只有获权字段，菜单需要read", () => { localStorage.setItem("sessionUser", JSON.stringify({ permissions: ["pmc-rd-progress:*:read", "pmc-rd-progress:orderNo:read"] })); expect(parseFilters(new URLSearchParams("orderNo=A&rdStatus=ABNORMAL&onlyIncomplete=true"))).toEqual({ orderNo: "A" }); expect(reportNavigation()[0]!.children[0]!.label).toBe("研发进度"); expect(reportUrl("summary", { orderNo: "A" }, { page: 2, pageSize: 100, search: "", filters: {} })).not.toContain("page="); });
});

describe("Phase 5.1 周期与共享筛选", () => {
  it("上海日期跨UTC日界仍默认昨天，非法值安全回退", () => {
    expect(defaultPeriod(new Date("2026-10-06T16:01:00Z"))).toEqual({ mode: "day", value: "2026-10-06" });
    expect(defaultPeriod(new Date("2026-10-06T15:59:59Z"))).toEqual({ mode: "day", value: "2026-10-05" });
    expect(readReportPeriod(new URLSearchParams("period=day&periodValue=2026-02-30"), new Date("2026-10-06T16:01:00Z"))).toEqual({ mode: "day", value: "2026-10-06" });
  });
  it.each([
    ["day", "2026-10-05", "2026-10-05", "2026-10-05"],
    ["month", "2026-09", "2026-09-01", "2026-09-30"],
    ["year", "2026", "2026-01-01", "2026-12-31"],
    ["custom", "2026-09-15,2026-10-05", "2026-09-15", "2026-10-05"]
  ] as const)("%s 模式归一化、URL恢复，API不接收UI模式", async (mode, value, from, to) => {
    mount(`/pmc/reports/rd-progress?period=${mode}&periodValue=${value}`, undefined, true);
    await waitFor(() => expect(calls("summary").at(-1)).toContain(`orderDateTo=${to}`));
    expect(calls("summary").at(-1)).toContain(`orderDateFrom=${from}`);
    expect(calls("summary").at(-1)).not.toContain("period=");
    expect(screen.getByTestId("location")).toHaveTextContent(`period=${mode}`);
    expect(calls("items")).toHaveLength(0); expect(screen.queryByPlaceholderText("请输入订单号")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "明细报表" })); await screen.findByText("品项甲");
    expect(calls("items").at(-1)).toContain(`orderDateFrom=${from}`);
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
  });
  it("周期切换正确支持闰月，自定义使用完整区间", () => {
    expect(periodBounds({ mode: "month", value: "2024-02" })).toEqual({ orderDateFrom: "2024-02-01", orderDateTo: "2024-02-29" });
    expect(periodForMode("month", { mode: "day", value: "2026-10-05" })).toEqual({ mode: "month", value: "2026-10" });
    expect(periodBounds({ mode: "custom", value: "2026-10-05,2026-09-15" })).toBeUndefined();
  });
  it("默认和任意条件重置均为按日+上海昨天，并清除维度", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-06T16:01:00Z"));
    try {
      mount("/pmc/reports/rd-progress?period=year&periodValue=2026&division=division-id&rdStatus=ABNORMAL&onlyIncomplete=true", undefined, true);
      await waitFor(() => expect(calls("summary").length).toBeGreaterThan(0));
      fireEvent.click(screen.getByRole("button", { name: "重 置" }));
      await waitFor(() => expect(calls("summary").at(-1)).toContain("orderDateFrom=2026-10-06"));
      expect(calls("summary").at(-1)).toContain("orderDateTo=2026-10-06");
      expect(calls("summary").at(-1)).not.toMatch(/division=|rdStatus=|onlyIncomplete=/);
      expect(screen.getByTestId("location")).toHaveTextContent("period=day");
      cleanup(); mount(undefined, undefined, true);
      await waitFor(() => expect(calls("summary").at(-1)).toContain("orderDateFrom=2026-10-06"));
    } finally { vi.useRealTimers(); }
  });
  it("维度使用候选下拉，提交和跨Tab导出继承完整日期/事业部/状态/未完成", async () => {
    mount("/pmc/reports/rd-progress?period=month&periodValue=2026-09&division=division-id&customer=客户甲&rdStatus=ABNORMAL&designBomStatus=COMPLETE&routingStatus=NOT_STARTED&onlyIncomplete=true", undefined, true);
    for (const label of ["事业部", "客户", "研发状态", "设计BOM状态", "工艺路线状态", "未完成", "日期周期"]) expect(screen.getByRole("combobox", { name: label })).toBeInTheDocument();
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining("field=customerName"), expect.anything()));
    fireEvent.click(screen.getByRole("button", { name: "查 询" }));
    await waitFor(() => expect(decodeURIComponent(calls("summary").at(-1)!)).toContain('"field":"designBomStatus","operator":"in","values":["COMPLETE"]'));
    fireEvent.click(screen.getByRole("tab", { name: "明细报表" })); await screen.findByText("品项甲");
    fireEvent.click(screen.getByTitle("2")); await waitFor(() => expect(calls("items").at(-1)).toContain("page=2"));
    fireEvent.click(await screen.findByRole("button", { name: /导出/ })); await waitFor(() => expect(exportTable).toHaveBeenCalled());
    const request = vi.mocked(exportTable).mock.calls[0]![0];
    expect(request.context).toEqual(expect.objectContaining({ onlyIncomplete: "true", orderDateFrom: "2026-09-01", orderDateTo: "2026-09-30" }));
    expect(JSON.stringify(request.filterGroup)).toContain('"field":"divisionId","operator":"in","values":["division-id"]');
    expect(request.context).not.toHaveProperty("period"); expect(request).not.toHaveProperty("pageSize");
    fireEvent.click(screen.getByRole("tab", { name: "图表看板" })); fireEvent.click(screen.getByRole("tab", { name: "明细报表" }));
    expect(screen.getByTitle("2")).toHaveClass("ant-pagination-item-active");
  });
});


describe("Phase 5.3 多选与完整高级筛选", () => {
  it("多值URL恢复生成IN/AND，重复品名按名称归组，隐藏字段不能进入请求", () => {
    localStorage.setItem("sessionUser", JSON.stringify({permissions:["*"],isSystemAdmin:true}));
    const filters = parseFilters(new URLSearchParams(serializeFilters({orderNo:["A","B"],itemCode:["X","Y"],itemName:["同名","同名"],rdStatus:["NOT_STARTED","WAITING_ROUTING"]})));
    const group = reportFilterGroup(filters);
    expect(group.logic).toBe("AND"); expect(group.rules).toHaveLength(4);
    expect(group.rules[0]).toEqual({field:"orderNo",operator:"in",values:["A","B"]});
    expect(group.rules[2]?.values).toEqual(["同名"]);
    const params = new URLSearchParams(reportUrl("summary",filters).split("?")[1]);
    expect(JSON.parse(params.get("filterGroup")!)).toEqual(group); expect(params.has("pageSize")).toBe(false);
    expect(mergeFilterGroups(group,group).rules).toHaveLength(4);
    const or = {logic:"OR" as const,rules:[{field:"itemSpec",operator:"contains" as const,value:"S"}]};
    expect(mergeFilterGroups(group,or).groups).toEqual([or]);
    localStorage.setItem("sessionUser", JSON.stringify({permissions:["pmc-rd-progress:*:read","pmc-rd-progress:orderNo:read"]}));
    expect(parseFilters(new URLSearchParams(serializeFilters(filters)))).toEqual({orderNo:["A","B"]});
    expect(parseFilters(new URLSearchParams('orderNo=[invalid'))).toEqual({});
  });
  it.each([["订单号","orderNo"],["品号","itemCode"],["品名","itemName"]])("%s远程限量多选，跨搜索保留已选值并影响汇总、明细、导出", async (label, field) => {
    const {container} = mount("/pmc/reports/rd-progress?period=year&periodValue=2026",undefined,true);
    const input = screen.getByRole("combobox", {name:label});
    fireEvent.mouseDown(input); fireEvent.change(input,{target:{value:`${field}-1`}});
    const option = await screen.findByText(`${field}-1`,{selector:'.ant-select-item-option-content'}); fireEvent.click(option);
    fireEvent.change(input,{target:{value:`${field}-2`}});
    fireEvent.click(await screen.findByText(`${field}-2`,{selector:'.ant-select-item-option-content'}));
    const candidateCalls = vi.mocked(api).mock.calls.filter(([path]) => path.includes(`field=${field}`));
    expect(candidateCalls.every(([path]) => path.includes("limit=50") && path.includes("resource=pmc-rd-progress"))).toBe(true);
    expect(input.closest('.ant-select')).toHaveTextContent(`${field}-1`); expect(input.closest('.ant-select')).toHaveTextContent(`${field}-2`);
    fireEvent.click(screen.getByRole("button",{name:"查 询"}));
    await waitFor(() => expect(decodeURIComponent(calls("summary").at(-1)!)).toContain(`"values":["${field}-1","${field}-2"]`));
    fireEvent.click(screen.getByRole("tab",{name:"明细报表"})); await screen.findByText("品项甲");
    expect(container.querySelector('.pmc-rd-filters')).toBeNull();
    fireEvent.click(await screen.findByRole("button",{name:/高级筛选/}));
    const panel = await screen.findByTestId("advanced-filter-panel");
    expect(within(panel).getByText(`${field}-1`)).toBeInTheDocument(); expect(within(panel).getByText(`${field}-2`)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button",{name:"应 用"}));
    await waitFor(() => expect(screen.queryByTestId("advanced-filter-panel")).not.toBeInTheDocument());
    expect(screen.getByRole("button",{name:/高级筛选/})).toHaveTextContent('(2)');
    await waitFor(() => expect(decodeURIComponent(calls("items").at(-1)!)).toContain(`"values":["${field}-1","${field}-2"]`));
    fireEvent.click(await screen.findByRole("button",{name:/导出/})); await waitFor(() => expect(exportTable).toHaveBeenCalled());
    expect(JSON.stringify(vi.mocked(exportTable).mock.calls[0]![0].filterGroup)).toContain(`"values":["${field}-1","${field}-2"]`);
    expect(vi.mocked(exportTable).mock.calls[0]![0]).not.toHaveProperty("pageSize");
    fireEvent.click(screen.getByRole("button",{name:/高级筛选/}));
    fireEvent.click(within(await screen.findByTestId("advanced-filter-panel")).getByRole("button",{name:"重 置"}));
    await waitFor(() => expect(calls("items").at(-1)).not.toContain("filterGroup"));
    expect(calls("items").at(-1)).toContain(`orderDateFrom=${defaultPeriod().value}`);
  });
});
