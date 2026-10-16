import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mpsDashboardGaps, tablePermissionFieldsFor } from "@kdos/contracts";
import { api } from "../../api";
import { downloadApiFile } from "../../shared/legacy-ui";
import { MasterPlanGaps } from "./MasterPlanGaps";
vi.mock("../../api", () => ({ api: vi.fn() }));
vi.mock("../../shared/legacy-ui", () => ({ downloadApiFile: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../shared/KdosDataTable", async original => ({
  ...await original<typeof import("../../shared/KdosDataTable")>(),
  KdosDataTable: ({ viewKey, serverData }: any) => <button aria-label={`${viewKey}第2页排序`} onClick={() => serverData.onQueryChange({ page: 2, pageSize: 50, sortField: "orderNumber", sortOrder: "desc" })}>分页</button>
}));
const resource = "mps-overview-dashboard", fields = tablePermissionFieldsFor(resource).map(f => f.key);
let client: QueryClient;
function mount(permissions = ["*"], isSystemAdmin = true) {
  localStorage.setItem("sessionUser", JSON.stringify({ sub: "gaps-test", permissions, isSystemAdmin }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MasterPlanGaps /></QueryClientProvider>);
}
const urls = () => vi.mocked(api).mock.calls.map(([url]) => new URL(url, "http://fixture"));
const latest = (key: string) => urls().filter(u => u.pathname.endsWith("/gaps") && u.searchParams.get("type") === key).at(-1)!;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  vi.mocked(api).mockImplementation(async path => {
    const url = new URL(path, "http://fixture");
    if (url.pathname.endsWith("/gap-counts")) return { gaps: Object.fromEntries(mpsDashboardGaps.map((g, i) => [g.key, i + 1])), visibleFields: fields } as never;
    if (url.pathname.endsWith("/candidates")) return { options: [{ value: "SO-GAPS", label: "SO-GAPS" }], hasMore: false } as never;
    return { rows: [], total: 125, page: 1, pageSize: 100, visibleFields: fields } as never;
  });
});
afterEach(() => { cleanup(); client?.clear(); });
describe("REV3-A independent gaps dashboard", () => {
  it("shows nine authoritative KPIs/tabs, loads only first list and never requests full summary", async () => {
    mount(); await screen.findByRole("tab", { name: "未进入出货计划 1" });
    for (const [i, g] of mpsDashboardGaps.entries()) {
      expect(screen.getByRole("button", { name: `${g.title} ${i + 1}` })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: `${g.title} ${i + 1}` })).toBeInTheDocument();
    }
    expect(urls().filter(u => u.pathname.endsWith("/gaps"))).toHaveLength(1);
    expect(urls().some(u => u.pathname.endsWith("/dashboard"))).toBe(false);
    expect(screen.queryByText("订单概况")).not.toBeInTheDocument();
    expect(screen.queryByText("待处理事项大屏")).not.toBeInTheDocument();
  });
  it("KPI selects each list; every independent export inherits its own type and English name", async () => {
    mount(); await screen.findByRole("tab", { name: "未进入出货计划 1" });
    for (const [i, g] of mpsDashboardGaps.entries()) {
      fireEvent.click(screen.getByRole("button", { name: `${g.title} ${i + 1}` }));
      await waitFor(() => expect(latest(g.key)?.searchParams.get("pageSize")).toBe("100"));
      expect(screen.getByRole("tab", { name: `${g.title} ${i + 1}` })).toHaveAttribute("aria-selected", "true");
      fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: "导出" }));
      await waitFor(() => expect(downloadApiFile).toHaveBeenCalledTimes(i + 1));
      const [url, filename] = vi.mocked(downloadApiFile).mock.calls[i]!;
      expect(new URL(url, "http://fixture").searchParams.get("tableKey")).toBe(g.key);
      expect(filename).toMatch(/^mps_[a-z_]+_\d{8}\.xlsx$/);
    }
  });
  it("retains each tab pagination/sort/search independently, local search leaves KPI counts alone", async () => {
    mount(); const input = await screen.findByRole("searchbox", { name: "未进入出货计划搜索" });
    fireEvent.change(input, { target: { value: "独立搜索" } }); fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(latest("missing-shipping-plan").searchParams.get("search")).toBe("独立搜索"));
    fireEvent.click(screen.getByRole("button", { name: "missing-shipping-plan第2页排序" }));
    await waitFor(() => expect(latest("missing-shipping-plan").searchParams.get("page")).toBe("2"));
    fireEvent.click(screen.getByRole("tab", { name: "未入库 6" }));
    await waitFor(() => expect(latest("no-inbound").searchParams.get("page")).toBe("1"));
    expect(latest("no-inbound").searchParams.has("search")).toBe(false);
    fireEvent.click(screen.getByRole("tab", { name: "未进入出货计划 1" }));
    fireEvent.click(within(screen.getByRole("tabpanel")).getByRole("button", { name: "导出" }));
    const exported = new URL(vi.mocked(downloadApiFile).mock.calls.at(-1)![0], "http://fixture");
    expect(exported.searchParams.get("page")).toBe("2"); expect(exported.searchParams.get("sortOrder")).toBe("desc");
    expect(exported.searchParams.get("search")).toBe("独立搜索");
    expect(urls().filter(u => u.pathname.endsWith("/gap-counts"))).toHaveLength(1);
  });
  it("top remote order/date scope resets lists and applies to counts/export; clear preserves REV2 no-date", async () => {
    mount(); await screen.findByRole("combobox", { name: "订单号" });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "订单号" }));
    fireEvent.click(await screen.findByText("SO-GAPS", { selector: ".ant-select-item-option-content" }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "日期类型" }));
    fireEvent.click(screen.getByText("订单日期", { selector: ".ant-select-item-option-content" }));
    await waitFor(() => expect(latest("missing-shipping-plan").searchParams.get("dateType")).toBe("ORDER"));
    expect(latest("missing-shipping-plan").searchParams.get("orderNumbers")).toBe('["SO-GAPS"]');
    const count = urls().filter(u => u.pathname.endsWith("/gap-counts")).at(-1)!;
    expect(count.searchParams.get("dateType")).toBe("ORDER"); expect(count.searchParams.get("orderNumbers")).toBe('["SO-GAPS"]');
    fireEvent.click(screen.getByRole("button", { name: "清空筛选" }));
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "日期周期" })).not.toBeInTheDocument());
    const before = urls().filter(u => u.pathname.endsWith("/gap-counts")).length;
    fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
    await waitFor(() => expect(urls().filter(u => u.pathname.endsWith("/gap-counts")).length).toBeGreaterThan(before));
  });
  it("no read makes no requests; read without export hides all downloads", async () => {
    const view = mount(["mps-monthly-plans:*:read"], false);
    expect(screen.getByText("没有待处理事项大屏查看权限")).toBeInTheDocument(); expect(api).not.toHaveBeenCalled();
    view.unmount(); mount([`${resource}:*:read`], false);
    await screen.findByRole("tab", { name: "未进入出货计划 1" });
    expect(screen.queryByRole("button", { name: "导出" })).not.toBeInTheDocument();
  });
  it("shows query errors and restricted empty metrics without fabricating nine zeros", async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error("缺口查询失败"));
    const view = mount(); expect(await screen.findByText("缺口查询失败")).toBeInTheDocument();
    view.unmount(); client.clear();
    vi.mocked(api).mockResolvedValue({ gaps: {}, visibleFields: [] } as never);
    mount(); expect(await screen.findByText("暂无可见指标")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });
});
