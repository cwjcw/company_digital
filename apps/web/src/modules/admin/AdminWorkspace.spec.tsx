import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    const menu = await screen.findByRole("menu");
    for (const label of ["修改名称", "调整分组", "删除"]) expect(within(menu).getByText(label)).toBeInTheDocument();
    expect(within(menu).queryByText("配置权限")).not.toBeInTheDocument();
  });

  it("adds role members by person or organization", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AdminWorkspace /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "切换到角色" }));
    await screen.findByText("系统角色");
    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));
    await waitFor(() => expect(screen.getAllByText("添加成员").length).toBeGreaterThan(1));
    const dialog = screen.getAllByText("添加成员").find((element) => element.classList.contains("ant-modal-title"))?.closest(".ant-modal") as HTMLElement;
    expect(within(dialog).getByText("按人员添加")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText("按组织添加"));
    expect(await within(dialog).findByText("组织架构")).toBeInTheDocument();
    expect(within(dialog).getByText("凯南")).toBeInTheDocument();
  });

  it("shows the screenshot-style role-group menu and creates a role inside that group", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AdminWorkspace /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "切换到角色" }));
    await screen.findByText("系统角色");
    fireEvent.click(screen.getByRole("button", { name: "编辑角色组-系统角色" }));
    const groupMenu = await screen.findByRole("menu");
    for (const label of ["修改名称", "添加角色", "删除"]) expect(within(groupMenu).getByText(label)).toBeInTheDocument();
    fireEvent.click(within(groupMenu).getByText("添加角色"));
    const dialog = (await screen.findByText("创建角色")).closest(".ant-modal") as HTMLElement;
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText("所属分组").closest(".ant-select")).toHaveClass("ant-select-disabled");
  });

  it("submits role rename instead of silently closing", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AdminWorkspace /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "切换到角色" }));
    await screen.findByText("系统角色");
    fireEvent.click(screen.getByRole("button", { name: "编辑角色-计划员" }));
    const roleMenu = await screen.findByRole("menu");
    fireEvent.click(within(roleMenu).getByText("修改名称"));
    const dialog = (await screen.findByText("修改角色名称")).closest(".ant-modal") as HTMLElement;
    expect(dialog).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("角色名称"), { target: { value: "计划员（已修改）" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /OK|确 定/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/roles/role-1", expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ name: "计划员（已修改）" })
    })));
  });

  it("uses a controlled confirmation dialog and submits role deletion", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AdminWorkspace /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "切换到角色" }));
    await screen.findByText("系统角色");
    fireEvent.click(screen.getByRole("button", { name: "编辑角色-计划员" }));
    const roleMenu = await screen.findByRole("menu");
    fireEvent.click(within(roleMenu).getByText("删除"));
    const dialog = (await screen.findByText("删除角色“计划员”？")).closest(".ant-modal") as HTMLElement;
    expect(dialog).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /删\s*除/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/roles/role-1", { method: "DELETE" }));
  });
});
