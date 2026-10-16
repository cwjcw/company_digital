import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { api } from "../../api";
import { MasterPlanDashboardDestination } from "./MasterPlanDashboardDestination";
vi.mock("../../api", () => ({ api: vi.fn() }));
let client: QueryClient;
const fields = tablePermissionFieldsFor("mps-overview-dashboard").map(f => f.key);
function mount(kind: "gaps" | "orders" | "reports", search = "") { client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<MemoryRouter initialEntries={["/destination" + search]}><QueryClientProvider client={client}><MasterPlanDashboardDestination kind={kind} /></QueryClientProvider></MemoryRouter>); }
const urls = () => vi.mocked(api).mock.calls.map(([url]) => new URL(url, "http://fixture"));
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("sessionUser", JSON.stringify({ permissions: ["*"], isSystemAdmin: true })); vi.clearAllMocks();
  vi.mocked(api).mockImplementation(async path => path.includes("/candidates") ? { options: [], hasMore: false } as never : path.includes("/meta") ? { visibleFields: fields, canExport: true } as never : path.includes("/gap-counts") ? { gaps: { overdue: 7 }, visibleFields: fields } as never : { rows: [], total: 0, page: 1, pageSize: 100, visibleFields: fields } as never);
});
afterEach(() => { cleanup(); client?.clear(); });
describe("cockpit destination initialization without changing accepted direct defaults", () => {
  it("direct B still starts at Shanghai yesterday; carried NONE starts unrestricted", async () => {
    const view = mount("orders"); await waitFor(() => expect(urls().some(u => u.pathname.endsWith("/orders"))).toBe(true));
    const direct = urls().find(u => u.pathname.endsWith("/orders"))!; expect(direct.searchParams.get("dateType")).toBe("ORDER"); expect(direct.searchParams.get("dateValue")).toBe(new Date(Date.now() - 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }));
    view.unmount(); client.clear(); vi.mocked(api).mockClear();
    mount("orders", '?from=pmc-cockpit&dateType=NONE&orderNumbers=["SO-CARRIED"]');
    await waitFor(() => expect(urls().some(u => u.pathname.endsWith("/orders"))).toBe(true)); const carried = urls().find(u => u.pathname.endsWith("/orders"))!;
    expect(carried.searchParams.get("dateType")).toBe("NONE"); expect(carried.searchParams.has("dateValue")).toBe(false); expect(carried.searchParams.get("orderNumbers")).toBe('["SO-CARRIED"]');
  });
  it("A selects the exact risk category and preserves the complete date scope", async () => {
    mount("gaps", '?from=pmc-cockpit&gap=overdue&dateType=DELIVERY&datePeriod=MONTH&dateValue=2026-10&customerCode=C-1');
    await screen.findByRole("tab", { name: "延期未完成 7" });
    await waitFor(() => expect(urls().some(u => u.pathname.endsWith("/gaps"))).toBe(true)); const url = urls().find(u => u.pathname.endsWith("/gaps"))!;
    expect(url.searchParams.get("type")).toBe("overdue"); expect(url.searchParams.get("dateType")).toBe("DELIVERY"); expect(url.searchParams.get("dateValue")).toBe("2026-10"); expect(url.searchParams.get("customerCode")).toBe("C-1");
  });
  it("reports mount three independently paginated queries under one carried top scope", async () => {
    mount("reports", '?from=pmc-cockpit&dateType=NONE&customerCode=C-REPORT');
    for (const title of ["计划待完善明细", "工序执行明细", "风险与异常"]) await screen.findByText(title, { selector: ".ant-card-head-title" });
    await waitFor(() => expect(urls().filter(u => u.pathname.includes("/reports/")).length).toBe(3));
    for (const u of urls().filter(u => u.pathname.includes("/reports/"))) { expect(u.searchParams.get("customerCode")).toBe("C-REPORT"); expect(u.searchParams.get("pageSize")).toBe("100"); }
  });
  it("malformed carried scope blocks before any request; target permission still denies", async () => {
    const view = mount("orders", '?from=pmc-cockpit&dateType=ORDER&datePeriod=DAY&dateValue=2026-02-30'); expect(screen.getByText(/链接筛选条件无效/)).toBeInTheDocument(); expect(api).not.toHaveBeenCalled();
    view.unmount(); localStorage.setItem("sessionUser", JSON.stringify({ permissions: ["mps-overview-dashboard:*:read"] })); mount("orders", '?from=pmc-cockpit&dateType=NONE');
    expect(screen.getByText("没有在制订单进度看板权限")).toBeInTheDocument(); expect(api).not.toHaveBeenCalled();
  });
});
