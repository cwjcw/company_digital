import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "antd";
import { api } from "../../api";
import { EquipmentDashboardPage, EquipmentRegisterPage, EquipmentStatusReportPage } from "./EquipmentPages";

vi.mock("../../api", () => ({
  api: vi.fn(),
  getValue: vi.fn(),
  containsText: vi.fn()
}));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><EquipmentStatusReportPage /></QueryClientProvider>);
}

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><EquipmentDashboardPage /></QueryClientProvider>);
}

function shanghaiYesterday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return new Date(Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day")) - 1)).toISOString().slice(0, 10);
}

const dashboardResponse = {
  windowStart: "2026-09-14", windowEnd: "2026-09-14", windowDays: 1,
  metrics: { dailyRecordedEquipment: 1 }, divisionRows: [], departmentRows: [], filters: { divisions: [], departments: [] }
};

describe("EquipmentStatusReportPage live permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("does not trust stale local permissions to open the create dialog", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ permissions: ["equipment-status-report:*:create"] }));
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/auth/me") return { permissions: [] } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    renderPage();
    await waitFor(() => expect(api).toHaveBeenCalledWith("/auth/me"));
    expect(screen.queryByRole("button", { name: /填报设备状态/ })).not.toBeInTheDocument();
    expect(vi.mocked(api).mock.calls.some(([path]) => path === "/equipment/status-options")).toBe(false);
  });

  it("loads status equipment candidates and opens the dialog with live create permission", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/auth/me") return { permissions: ["equipment-status-report:*:create"] } as never;
      if (path === "/equipment/status-options") return {
        equipment: [{ id: "asset-1", equipmentCode: "A001", equipmentName: "设备甲", divisionId: "d1", divisionName: "事业一部", usageDepartmentId: null, usageDepartmentName: "生产部" }],
        users: [], organizations: [], faultReasons: []
      } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    renderPage();
    const button = await screen.findByRole("button", { name: /填报设备状态/ });
    expect(screen.getByRole("button", { name: /导出模板/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^导入$/ })).not.toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(api).mock.calls.some(([path]) => path === "/equipment/status-options")).toBe(true));
    fireEvent.click(button);
    expect(await screen.findByRole("dialog", { name: "填报设备状态" })).toBeInTheDocument();
  });

  it("deletes a status row with its optimistic version in the query string", async () => {
    const row = {
      id: "status-1", equipmentId: "asset-1", equipmentCode: "A001", equipmentName: "设备甲",
      divisionId: "d1", divisionName: "事业一部", usageDepartmentId: null, usageDepartmentName: "生产部",
      reportDate: "2026-09-07", runtimeMinutes: 60, faultMinutes: 0, faultReason: null,
      responsibleUserIds: [], responsibleUsers: [], version: 3
    };
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/auth/me") return { isSystemAdmin: true, permissions: [] } as never;
      if (path === "/equipment/status-reports/status-1?expectedVersion=3" && init?.method === "DELETE") return { id: row.id, active: false, version: 4 } as never;
      if (path.startsWith("/equipment/status-reports?")) return { rows: [row], total: 1, page: 1, pageSize: 50 } as never;
      throw new Error(`unexpected request: ${path}`);
    });

    const confirm = vi.spyOn(Modal, "confirm").mockReturnValue({} as ReturnType<typeof Modal.confirm>);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /删除/ }, { timeout: 10_000 }));
    expect(confirm).toHaveBeenCalledOnce();
    await confirm.mock.calls[0]![0].onOk?.();

    await waitFor(() => expect(api).toHaveBeenCalledWith("/equipment/status-reports/status-1?expectedVersion=3", { method: "DELETE" }));
  });
});

describe("EquipmentRegisterPage server filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("only exposes the single advanced filter entry (legacy 筛选 drawer and header filters removed)", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/auth/me") return { permissions: ["equipment-register:*:read"] } as never;
      if (path === "/directory/users") return [] as never;
      if (path === "/table-filters/resources") return [{ code: "equipment-register", filterableFields: ["equipmentCode", "monitored"] }] as never;
      if (path.startsWith("/equipment/assets?")) return { rows: [], total: 0, page: 1, pageSize: 50 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><EquipmentRegisterPage /></QueryClientProvider>);

    await waitFor(() => expect(view.container.querySelector('[data-resource="equipment-register"]')).toBeInTheDocument());
    const toolbar = view.container.querySelector<HTMLElement>('[data-resource="equipment-register"] .kdos-data-table-toolbar')!;
    /* KN-FILTER-002：工具栏只保留快速搜索 + 高级筛选。 */
    expect(await within(toolbar).findByRole("button", { name: /高级筛选/ })).toBeEnabled();
    expect(within(toolbar).queryByRole("button", { name: /^筛选/ })).not.toBeInTheDocument();
    /* 列头不再提供第二套筛选入口。 */
    expect(view.container.querySelectorAll(".ant-table-filter-trigger").length).toBe(0);
  });

  it("renders planned startup time in hours and minutes", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/auth/me") return { permissions: ["equipment-register:*:read"] } as never;
      if (path.startsWith("/equipment/assets?")) return { rows: [{
        id: "asset-1", divisionId: "d1", divisionName: "事业一部", usageDepartmentId: null, usageDepartmentName: "生产部",
        equipmentCode: "A001", equipmentName: "设备甲", purchaseDate: null, plannedStartupMinutes: 510,
        monitored: false, responsibleUserIds: [], responsibleUsers: [], version: 1
      }], total: 1, page: 1, pageSize: 50 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><EquipmentRegisterPage /></QueryClientProvider>);

    expect(await screen.findByText("8小时30分钟")).toBeInTheDocument();
  });
});

describe("EquipmentDashboardPage date filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith("/equipment/dashboard?")) return dashboardResponse as never;
      throw new Error(`unexpected request: ${path}`);
    });
  });

  const dashboardPaths = () => vi.mocked(api).mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith("/equipment/dashboard?"));
  const selectPeriod = async (label: string) => {
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "设备驾驶舱统计周期" }));
    const option = await screen.findByText(label, { selector: ".ant-select-item-option-content" });
    fireEvent.click(option.parentElement!);
  };

  it("defaults to Shanghai yesterday in day mode and requests the matching daily window", async () => {
    renderDashboard();
    const expected = shanghaiYesterday();
    await waitFor(() => expect(dashboardPaths()).toContain(`/equipment/dashboard?periodType=day&period=${expected}`));
    expect(screen.getByText("按日", { selector: ".ant-select-selection-item" })).toBeInTheDocument();
    expect(screen.getByLabelText("设备驾驶舱统计日期")).toHaveValue(expected);
    expect(screen.getByText("有数据设备")).toBeInTheDocument();
  });

  it("restores Shanghai yesterday on clear and retains month, year, and custom filters", async () => {
    renderDashboard();
    const expected = shanghaiYesterday();
    await waitFor(() => expect(dashboardPaths()).toContain(`/equipment/dashboard?periodType=day&period=${expected}`));

    await selectPeriod("按月");
    await waitFor(() => expect(dashboardPaths().some((path) => new URL(path, "http://kdos.local").searchParams.get("periodType") === "month")).toBe(true));
    await selectPeriod("按年");
    await waitFor(() => expect(dashboardPaths().some((path) => new URL(path, "http://kdos.local").searchParams.get("periodType") === "year")).toBe(true));
    await selectPeriod("自定义日期");
    await waitFor(() => expect(dashboardPaths().some((path) => new URL(path, "http://kdos.local").searchParams.get("periodType") === "custom")).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "清空筛选" }));
    await waitFor(() => expect(dashboardPaths().at(-1)).toBe(`/equipment/dashboard?periodType=day&period=${expected}`));
  }, 15_000);
});
