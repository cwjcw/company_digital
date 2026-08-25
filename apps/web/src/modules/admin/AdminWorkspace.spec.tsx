import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { AdminWorkspace } from "./AdminWorkspace";

vi.mock("../../api", () => ({ api: vi.fn() }));

const employee = { id: "user-1", username: "demo001", displayName: "演示员工", employeeNo: "D001", mobile: "13800000000", enabled: true, departmentPaths: [["凯南", "计划中心"]], roleIds: ["role-1"], roles: ["计划员"] };
const role = { id: "role-1", name: "计划员", roleGroupId: "group-1", userIds: ["user-1"], organizationUnitIds: [], permissions: [] };

describe("AdminWorkspace", () => {
  afterEach(() => { cleanup(); document.body.innerHTML = ""; });
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.startsWith("/admin/users?")) return [employee] as never;
      if (path === "/admin/roles") return [role] as never;
      if (path === "/admin/role-groups") return [{ id: "group-1", name: "系统角色", sortOrder: 0 }] as never;
      if (path === "/admin/organization-units") return [{ id: "org-1", name: "凯南", parentId: null, enabled: true }, { id: "org-2", name: "计划中心", parentId: "org-1", enabled: true }] as never;
      return {} as never;
    });
  });

  it("shows the screenshot-style employee action menu", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AdminWorkspace /></QueryClientProvider>);
    expect(await screen.findByText("演示员工")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "操作-演示员工" }));
    for (const label of ["编辑", "交接工作", "停用", "转移", "离职"]) expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it("separates role groups from roles and exposes role editing", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AdminWorkspace /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "切换到角色" }));
    expect(await screen.findByText("系统角色")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("计划员").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "编辑角色-计划员" }));
    for (const label of ["修改名称", "调整分组", "配置权限", "删除"]) await waitFor(() => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
  });
});
