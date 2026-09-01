import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { TablePermissionsPage } from "./TablePermissionsPage";

vi.mock("../../api", () => ({ api: vi.fn() }));

const permissionContext = () => ({
  roles: [{ id: "role-1", name: "所有员工", roleGroupId: "group-1", permissions: [] }],
  roleGroups: [{ id: "group-1", name: "销售" }],
  users: [{ id: "user-1", displayName: "张三", username: "zhangsan", employeeNo: "001", enabled: true, departmentPaths: [["凯南", "销售部"]] }],
  organizations: [{ id: "org-1", name: "凯南", parentId: null, enabled: true }, { id: "org-2", name: "销售部", parentId: "org-1", enabled: true }]
});

describe("TablePermissionsPage", () => {
  const renderPage = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><TablePermissionsPage resourceCode="work-report" /></QueryClientProvider>);
    return client;
  };

  const openRoleEditor = async () => {
    await screen.findByText("对成员发布 · 报工表");
    fireEvent.click(screen.getAllByRole("button", { name: /添加成员/ })[0]!);
    const selector = await screen.findByRole("dialog", { name: "部门成员列表" });
    fireEvent.click(within(selector).getByText("角色"));
    await within(selector).findByText("销售");
    fireEvent.click(within(selector).getAllByRole("checkbox").at(-1)!);
    fireEvent.click(within(selector).getByRole("button", { name: /确\s*定/ }));
    return screen.findByRole("dialog", { name: "添加成员" });
  };

  const chooseCustomPermission = async (editor: HTMLElement) => {
    fireEvent.mouseDown(editor.querySelector(".permission-type-select .ant-select-selector")!);
    fireEvent.click(await screen.findByText("＋ 新建自定义权限"));
    fireEvent.change(within(editor).getByPlaceholderText("填写权限组名称"), { target: { value: "销售自定义权限" } });
    fireEvent.click(within(editor).getByText("字段权限"));
    const visibleCheckbox = editor.querySelector(".permission-field-scroll .permission-field-row input[type='checkbox']")!;
    fireEvent.click(visibleCheckbox);
  };

  afterEach(() => cleanup());
  beforeEach(() => {
    vi.mocked(api).mockReset();
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.startsWith("/admin/table-permission-groups?")) return [] as never;
      if (path.startsWith("/admin/table-permission-context?")) return permissionContext() as never;
      return {} as never;
    });
  });

  it("uses the screenshot two-step member publishing flow", async () => {
    renderPage();
    await screen.findByText("对成员发布 · 报工表");
    fireEvent.click(screen.getAllByRole("button", { name: /添加成员/ })[0]!);
    const selector = await screen.findByRole("dialog", { name: "部门成员列表" });
    for (const tab of ["组织架构", "角色", "成员"]) expect(within(selector).getByText(tab)).toBeInTheDocument();
    fireEvent.click(within(selector).getByText("角色"));
    await within(selector).findByText("销售");
    expect(within(selector).getByText("所有员工")).toBeInTheDocument();
    fireEvent.click(within(selector).getAllByRole("checkbox").at(-1)!);
    fireEvent.click(within(selector).getByRole("button", { name: /确\s*定/ }));
    const editor = await screen.findByRole("dialog", { name: "添加成员" });
    expect(within(editor).getByText("对成员发布")).toBeInTheDocument();
    expect(within(editor).getByText("成员权限")).toBeInTheDocument();
    await waitFor(() => expect(within(editor).getByText("销售-所有员工")).toBeInTheDocument());
  });

  it("submits a complete custom permission and prevents duplicate confirms", async () => {
    let resolveSave!: (value: unknown) => void;
    const saveResponse = new Promise((resolve) => { resolveSave = resolve; });
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path.startsWith("/admin/table-permission-groups?") && !init?.method) return [] as never;
      if (path.startsWith("/admin/table-permission-context?")) return permissionContext() as never;
      if (path === "/admin/table-permission-groups" && init?.method === "POST") return await saveResponse as never;
      return {} as never;
    });
    renderPage();
    const editor = await openRoleEditor();
    await chooseCustomPermission(editor);

    const confirm = within(editor).getByRole("button", { name: /确\s*定/ });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(vi.mocked(api).mock.calls.filter(([path, init]) => path === "/admin/table-permission-groups" && init?.method === "POST")).toHaveLength(1));
    resolveSave({ id: "permission-1" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "添加成员" })).not.toBeInTheDocument());
  });

  it("keeps the editor and draft open with an inline error when saving fails", async () => {
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path.startsWith("/admin/table-permission-groups?") && !init?.method) return [] as never;
      if (path.startsWith("/admin/table-permission-context?")) return permissionContext() as never;
      if (path === "/admin/table-permission-groups" && init?.method === "POST") throw new Error("数据库保存失败");
      return {} as never;
    });
    renderPage();
    const editor = await openRoleEditor();
    await chooseCustomPermission(editor);
    fireEvent.click(within(editor).getByRole("button", { name: /确\s*定/ }));

    expect(await within(editor).findByRole("alert")).toHaveTextContent("数据库保存失败");
    expect(within(editor).getByDisplayValue("销售自定义权限")).toBeInTheDocument();
  });
});
