import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "antd";
import { api } from "../../api";
import { EquipmentDashboardPage, EquipmentRegisterPage, EquipmentStatusReportPage } from "./EquipmentPages";

const chartProps = vi.hoisted(() => [] as Array<{ option: any; ariaLabel: string; empty?: boolean }>);

vi.mock("../../api", () => ({
  api: vi.fn(),
  getValue: vi.fn(),
  containsText: vi.fn()
}));

vi.mock("../../shared/charts", async () => {
  const React = await import("react");
  return {
    KdosChart: (props: { option: any; ariaLabel: string; empty?: boolean }) => {
      chartProps.push(props);
      return React.createElement("div", { role: "img", "aria-label": props.ariaLabel, "data-kdos-chart": "true" });
    },
    formatChartDate: (value: string | undefined) => value ? `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日` : "—",
    formatChartDuration: (value: number | null | undefined) => value == null ? "—" : `${Math.floor(value / 60)}小时${value % 60 ? `${value % 60}分钟` : ""}`,
    formatChartPercent: (value: number | null | undefined) => value == null ? "—" : `${Number(value).toFixed(1)}%`
  };
});

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

const trendRows = Array.from({ length: 7 }, (_, index) => ({ date: `2026-09-${String(index + 15).padStart(2, "0")}`, expectedEquipmentCount: 100, filledEquipmentCount: 90 + index, unfilledEquipmentCount: 10 - index, reportingRate: 90 + index, plannedRuntimeMinutes: 47_940, runtimeMinutes: 37_680, utilizationRate: index === 0 ? null : index === 6 ? 105 : 78.6 }));
const divisionTwoTrendRows = trendRows.map((row, index) => ({ ...row, expectedEquipmentCount: 50, filledEquipmentCount: 35 + index, unfilledEquipmentCount: 15 - index, reportingRate: 70 + index, plannedRuntimeMinutes: 4_320, runtimeMinutes: index === 6 ? 4_752 : 3_240, utilizationRate: index === 0 ? null : index === 6 ? 110 : 75 }));

const dashboardResponse = {
  windowStart: "2026-09-14", windowEnd: "2026-09-14", windowDays: 1,
  metrics: { dailyRecordedEquipment: 1 }, divisionRows: [], departmentRows: [], filters: { divisions: [], departments: [] },
  operationsMonitoring: {
    yesterday: { date: "2026-09-21", expectedEquipmentCount: 150, filledEquipmentCount: 120, unfilledEquipmentCount: 30, reportingRate: 80, plannedRuntimeMinutes: 1080, runtimeMinutes: 1380, utilizationRate: 83.3 },
    yesterdayDivisionRows: [
      { divisionId: "division-1", division: "凯南事业一部", expectedEquipmentCount: 100, filledEquipmentCount: 90, unfilledEquipmentCount: 10, reportingRate: 90, plannedRuntimeMinutes: 1080, runtimeMinutes: 900, utilizationRate: 83.3 },
      { divisionId: "division-2", division: "凯南事业二部", expectedEquipmentCount: 50, filledEquipmentCount: 30, unfilledEquipmentCount: 20, reportingRate: 60, plannedRuntimeMinutes: 0, runtimeMinutes: 480, utilizationRate: null }
    ],
    yesterdayDepartmentRows: [
      { divisionId: "division-1", division: "凯南事业一部", departmentId: "department-1", department: "五金车间", expectedEquipmentCount: 20, filledEquipmentCount: 19, unfilledEquipmentCount: 1, reportingRate: 95, plannedRuntimeMinutes: 480, runtimeMinutes: 420, utilizationRate: 87.5 },
      { divisionId: "division-1", division: "凯南事业一部", departmentId: "department-2", department: "木作车间", expectedEquipmentCount: 80, filledEquipmentCount: 71, unfilledEquipmentCount: 9, reportingRate: 88.8, plannedRuntimeMinutes: 600, runtimeMinutes: 480, utilizationRate: 80 },
      { divisionId: "division-2", division: "凯南事业二部", departmentId: "department-3", department: "五金车间", expectedEquipmentCount: 50, filledEquipmentCount: 30, unfilledEquipmentCount: 20, reportingRate: 60, plannedRuntimeMinutes: 0, runtimeMinutes: 480, utilizationRate: null }
    ],
    sevenDayTrend: {
      total: trendRows,
      divisions: [
        { divisionId: "division-1", divisionName: "凯南事业一部", rows: trendRows },
        { divisionId: "division-2", divisionName: "凯南事业二部", rows: divisionTwoTrendRows }
      ]
    }
  }
};

describe("EquipmentStatusReportPage live permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    chartProps.length = 0;
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
    chartProps.length = 0;
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

  it("renders total and per-division ECharts dual-line trends with one shared axis", async () => {
    const view = renderDashboard();
    expect(await screen.findByText("设备运行与填报监控")).toBeInTheDocument();
    expect(await screen.findByText("昨日填报率")).toBeInTheDocument();
    expect(screen.getAllByText("80.0%").length).toBeGreaterThan(0);
    expect(screen.getByText("昨日稼动率")).toBeInTheDocument();
    expect(screen.getByText("实际 23小时0分钟 / 计划 18小时0分钟")).toBeInTheDocument();
    expect(screen.getByText("昨日事业部填报与稼动情况")).toBeInTheDocument();
    expect(screen.getByText("昨日部门填报与稼动情况")).toBeInTheDocument();
    const divisionMonitoringTable = screen.getByText("昨日事业部填报与稼动情况").closest(".ant-card") as HTMLElement;
    const departmentMonitoringTable = screen.getByText("昨日部门填报与稼动情况").closest(".ant-card") as HTMLElement;
    expect(within(divisionMonitoringTable).queryAllByText("使用部门/车间")).toHaveLength(0);
    expect(within(departmentMonitoringTable).queryAllByText("使用部门/车间").length).toBeGreaterThan(0);
    expect(screen.getAllByText("所属事业部").length).toBeGreaterThan(0);
    expect(screen.getAllByText("事业一部").length).toBeGreaterThan(0);
    expect(screen.getAllByText("事业二部").length).toBeGreaterThan(0);
    expect(screen.getAllByText("五金车间")).toHaveLength(2);
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("7小时0分钟")).toBeInTheDocument();
    expect(screen.getByText("87.5%")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("层级")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "最近7天总体填报率与稼动率趋势" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /最近7天填报率与稼动率趋势/ })).toHaveLength(2);
    expect(view.container.querySelectorAll("[data-kdos-chart='true']")).toHaveLength(3);
    const options = chartProps.slice(-3).map((props) => props.option);
    expect(options).toHaveLength(3);
    for (const option of options) {
      expect(option.series).toHaveLength(2);
      expect(option.xAxis.data).toEqual(trendRows.map((row) => row.date));
      expect(option.yAxis.min).toBe(0);
      expect(option.yAxis.max).toBe(120);
    }
    expect(options[0].series[1].data[0]).toBeNull();
    expect(options[0].series[1].data[6]).toBe(105);
    expect(options[0].tooltip.formatter([{ dataIndex: 6 }])).toContain("实际运行 628小时");
    expect(options[0].tooltip.formatter([{ dataIndex: 6 }])).toContain("稼动率 105.0%");
  }, 15_000);

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
