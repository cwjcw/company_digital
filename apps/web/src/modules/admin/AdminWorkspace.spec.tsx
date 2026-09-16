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
      if (path === "/admin/users?options=1") return [employee] as never;
      if (path.startsWith("/admin/users?")) return { rows: [employee], total: 1, page: 1, pageSize: 50 } as never;
      if (path.startsWith("/admin/users?")) return { rows: [employee], total: 1, page: 1, pageSize: 50 } as never;
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

  it("finds members below a child department that has the same name as its parent", async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.startsWith("/admin/users?")) return [
        { id: "direct", username: "direct", displayName: "二级直属成员", enabled: true, departmentPaths: [["厦门凯南展示制品有限公司", "营销中心"]], roleIds: [] },
        { id: "descendant", username: "descendant", displayName: "子部门成员", enabled: true, departmentPaths: [["厦门凯南展示制品有限公司", "营销中心", "业务部"]], roleIds: [] },
        { id: "quotation", username: "quotation", displayName: "报价部成员", enabled: true, departmentPaths: [["厦门凯南展示制品有限公司", "营销中心", "报价部"]], roleIds: [] }
      ] as never;
      if (path.startsWith("/admin/users?")) return { rows: [employee], total: 1, page: 1, pageSize: 50 } as never;
      if (path === "/admin/roles") return [role] as never;
      if (path === "/admin/role-groups") return [{ id: "group-1", name: "系统角色", sortOrder: 0 }] as never;
      if (path === "/admin/organization-units") return [
        { id: "company", name: "厦门凯南展示制品有限公司", parentId: null, enabled: true },
        { id: "marketing-level-1", name: "营销中心", parentId: "company", enabled: true },
        { id: "quotation", name: "报价部", parentId: "marketing-level-1", enabled: true },
        { id: "marketing-level-2", name: "营销中心", parentId: "marketing-level-1", enabled: true },
        { id: "sales", name: "业务部", parentId: "marketing-level-2", enabled: true }
      ] as never;
      return {} as never;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AdminWorkspace /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "切换到角色" }));
    await screen.findByText("系统角色");
    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));
    const dialog = screen.getAllByText("添加成员").find((element) => element.classList.contains("ant-modal-title"))?.closest(".ant-modal") as HTMLElement;
    fireEvent.click(within(dialog).getByText("按组织添加"));
    const sameNameDepartments = await within(dialog).findAllByText("营销中心");
    fireEvent.click(sameNameDepartments[1]!);
    expect(await within(dialog).findByText("二级直属成员")).toBeInTheDocument();
    expect(within(dialog).getByText("子部门成员")).toBeInTheDocument();
    expect(within(dialog).queryByText("报价部成员")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("该部门没有符合条件的在职成员")).not.toBeInTheDocument();
  });

  it("persists a department scope instead of freezing its current users into the role", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AdminWorkspace /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "切换到角色" }));
    await screen.findByText("系统角色");
    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));
    const dialog = screen.getAllByText("添加成员").find((element) => element.classList.contains("ant-modal-title"))?.closest(".ant-modal") as HTMLElement;
    fireEvent.click(within(dialog).getByText("按组织添加"));
    fireEvent.click(await within(dialog).findByText("计划中心"));
    fireEvent.click(within(dialog).getByText("按部门动态授权"));
    fireEvent.click(within(dialog).getByRole("button", { name: /OK|确 定/ }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/roles/role-1", {
      method: "PATCH",
      body: JSON.stringify({ userIds: ["user-1"], organizationUnitIds: ["org-2"] })
    }));
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
