import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "antd";
import { api } from "../../api";
import { EquipmentRegisterPage, EquipmentStatusReportPage } from "./EquipmentPages";

vi.mock("../../api", () => ({
  api: vi.fn(),
  getValue: vi.fn(),
  containsText: vi.fn()
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><EquipmentStatusReportPage /></QueryClientProvider>);
}

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
    fireEvent.click(await screen.findByRole("button", { name: /删除/ }));
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

  it("sends the displayed monitoring label with the stable monitored field key", async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === "/auth/me") return { permissions: ["equipment-register:*:read"] } as never;
      if (path === "/directory/users") return [] as never;
      if (path.startsWith("/equipment/assets?")) return { rows: [], total: 0, page: 1, pageSize: 50 } as never;
      throw new Error(`unexpected request: ${path}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><EquipmentRegisterPage /></QueryClientProvider>);

    await waitFor(() => expect(view.container.querySelector('[data-resource="equipment-register"]')).toBeInTheDocument());
    const toolbar = view.container.querySelector<HTMLElement>('[data-resource="equipment-register"] .kdos-data-table-toolbar')!;
    fireEvent.click(within(toolbar).getByRole("button", { name: /筛选$/ }));
    fireEvent.change(await screen.findByPlaceholderText("筛选状态填报"), { target: { value: "需要填报" } });

    await waitFor(() => expect(vi.mocked(api).mock.calls.some(([path]) => {
      if (!String(path).startsWith("/equipment/assets?")) return false;
      return new URL(String(path), "http://kdos.local").searchParams.get("monitored") === "需要填报";
    })).toBe(true));
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
