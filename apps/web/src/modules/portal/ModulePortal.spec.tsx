import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { ModulePortal } from "./ModulePortal";

vi.mock("../../api", () => ({ api: vi.fn() }));

const mockedApi = vi.mocked(api);
const renderPortal = (user: Record<string, unknown>, onOpen = vi.fn()) => render(<AntApp><ModulePortal user={user} onOpen={onOpen} onLogout={vi.fn()} /></AntApp>);

describe("ModulePortal system access", () => {
  beforeEach(() => { cleanup(); localStorage.clear(); mockedApi.mockReset(); });

  it("hides system management from non-system administrators", () => {
    renderPortal({ username: "demo-manager", roles: ["集团管理员"] });
    expect(screen.queryByText("选择一个模块开始工作。所有模块统一呈现，后续新增能力将在这里持续扩展。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进入系统管理" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "进入PMC中心" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "进入人力资源" })).toBeInTheDocument();
  });

  it("shows system management to system administrators", () => {
    const onOpen = vi.fn();
    renderPortal({ username: "admin", roles: ["系统管理员"], isSystemAdmin: true }, onOpen);
    screen.getByRole("button", { name: "进入系统管理" }).click();
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ path: "/users" }));
  });

  it("shows the administrator viewer entry to module administrators", () => {
    renderPortal({ username: "module-manager", roles: [], isSystemAdmin: false, moduleAdminCodes: ["planning"] });
    expect(screen.getByRole("button", { name: "进入系统管理" })).toBeInTheDocument();
  });

  it("opens PMC at the current master-plan system without retired UI labels", () => {
    const onOpen = vi.fn();
    renderPortal({ username: "planner", roles: [] }, onOpen);
    expect(screen.queryByText("生产主计划", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("月度计划", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("集团主计划大屏", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("主计划系统", { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "进入PMC中心" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ path: "/master-plan-system/mps-erp-orders" }));
  });

  it("loads and saves a personal module order without affecting module access", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ sub: "user-1", username: "member" }));
    mockedApi.mockResolvedValue({ order: ["profile", "planning", "cockpit", "data", "marketing", "hr", "workflow", "system"] });
    renderPortal({ sub: "user-1", username: "member", roles: [], portalModuleOrder: ["profile", "planning"] });
    expect(screen.getAllByRole("button", { name: /^进入/ })[0]).toHaveAccessibleName("进入个人中心");
    fireEvent.click(screen.getByRole("button", { name: "调整顺序" }));
    fireEvent.click(screen.getByRole("button", { name: "下移个人中心" }));
    expect(screen.getAllByLabelText(/^排列/)[0]).toHaveAccessibleName("排列PMC中心");
    fireEvent.click(screen.getByRole("button", { name: "保存顺序" }));
    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith("/auth/preferences/portal-modules", expect.objectContaining({ method: "PUT" })));
    await waitFor(() => expect(JSON.parse(localStorage.getItem("sessionUser") ?? "{}").portalModuleOrder).toEqual(expect.any(Array)));
  });
});
