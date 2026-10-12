import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { api } from "../../api";
import { TablePermissionButton } from "../../shared/KdosDataTable";
import { KnowledgeSettings } from "./KnowledgeSettings";
import { KnowledgeManagement } from "./KnowledgePages";

vi.mock("../../api", async (original) => ({ ...(await original<object>()), api: vi.fn() }));
const hr = { id: "hr", code: "HR", name: "人力资源", status: "ACTIVE", version: 3, icon: "book", canManage: true, canCreate: true, accessLevel: "FULL_ACCESS", canManageFolders: true };
const permissions = ["knowledge-spaces:*:read", "knowledge-spaces:*:update", "knowledge-pages:*:read", ...["knowledge-spaces", "knowledge-pages"].flatMap(r => tablePermissionFieldsFor(r as never).map(f => `${r}:${f.key}:read`)), "knowledge-spaces:access:update"];
const roles = [
  { name: "系统管理员", session: { isSystemAdmin: true, permissions: ["*"] }, platform: true, members: true },
  { name: "Knowledge模块管理员", session: { moduleAdminCodes: ["knowledge"], permissions: [] }, platform: true, members: true },
  { name: "空间负责人FULL_ACCESS", session: { permissions }, platform: false, members: true },
  { name: "普通员工", session: { permissions: permissions.filter(p => !p.endsWith(":update")) }, platform: false, members: false },
  { name: "其他模块管理员兼空间负责人", session: { moduleAdminCodes: ["planning"], permissions }, platform: false, members: true }
];
const capabilities = { canManage: true, canManageFolders: true, canCreatePages: false, canEditPages: false, canManagePages: true, canCreateSpaces: false, canManageSpaces: true, canArchive: false, canTrash: false };

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  vi.mocked(api).mockImplementation(async path => {
    if (path === "/knowledge/options") return { users: [{ id: "user", label: "测试成员" }], organizations: [{ id: "org", label: "测试组织" }], roles: [{ id: "role", label: "测试角色" }] } as never;
    if (path.endsWith("/access")) return [{ subjectType: "ALL", subjectId: null, accessLevel: "VIEWER" }] as never;
    if (path.startsWith("/knowledge/spaces") && !path.includes("/folders") && !path.includes("/tree")) return [hr] as never;
    if (path.startsWith("/table-filters/rows")) return { rows: [hr], total: 1 } as never;
    if (path.startsWith("/table-filters/resources")) return [{ code: "knowledge-spaces", filterableFields: ["name"] }] as never;
    if (path.includes("/folders") || path.includes("/tree")) return { rows: [], total: 0, page: 1, pageSize: 100 } as never;
    return [] as never;
  });
});
afterEach(() => { cleanup(); localStorage.clear(); });
function mount(element: React.ReactNode, path = "/knowledge/manage/spaces") {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><App><MemoryRouter initialEntries={[path]}>{element}</MemoryRouter></App></QueryClientProvider>);
}

describe("Knowledge权限入口角色与范围", () => {
  it.each(roles)("$name：空间管理单一入口，Space ACL不扩大平台权限", async ({ session, platform, members }) => {
    localStorage.setItem("sessionUser", JSON.stringify(session)); mount(<KnowledgeSettings />);
    await screen.findByText("人力资源");
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(screen.queryAllByRole("link", { name: /空间操作权限/ })).toHaveLength(platform ? 1 : 0);
    expect(screen.queryByRole("link", { name: /页面与文件操作权限/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /权限管理/ })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /成员与权限/ })).toHaveLength(members ? 1 : 0);
  });

  it.each(roles)("$name：页面与文件顶部仅显示获权的独立入口", async ({ session, platform }) => {
    localStorage.setItem("sessionUser", JSON.stringify(session)); mount(<KnowledgeManagement capabilities={capabilities} />, "/knowledge/manage?spaceId=hr");
    await screen.findByLabelText("搜索知识页面");
    expect(screen.queryAllByRole("link", { name: /页面与文件操作权限/ })).toHaveLength(platform ? 1 : 0);
    expect(screen.queryByRole("link", { name: /空间操作权限/ })).not.toBeInTheDocument();
    if (platform) expect(screen.getByRole("link", { name: /页面与文件操作权限/ })).toHaveAttribute("href", expect.stringContaining("/permissions/knowledge-pages?from="));
  });

  it("成员与权限仍打开原KnowledgeAccess，保留四种对象和三级权限，不执行授权写入", async () => {
    localStorage.setItem("sessionUser", JSON.stringify({ permissions })); mount(<KnowledgeSettings />);
    fireEvent.click(await screen.findByRole("button", { name: /成员与权限/ }));
    await screen.findByRole("dialog", { name: "空间成员与权限" });
    expect(api).toHaveBeenCalledWith("/knowledge/spaces/hr/access");
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "权限对象类型1" }));
    for (const title of ["全公司", "人员", "组织", "角色"]) expect((await screen.findAllByTitle(title)).some(node => node.classList.contains("ant-select-item-option"))).toBe(true);
    fireEvent.click(screen.getByTitle("人员"));
    fireEvent.mouseDown(screen.getAllByRole("combobox").at(-1)!);
    for (const title of ["只读", "编辑", "完全管理"]) expect((await screen.findAllByTitle(title)).some(node => node.classList.contains("ant-select-item-option"))).toBe(true);
    expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("其他模块按钮默认文案及目标保持不变，label只改变显示文字", () => {
    localStorage.setItem("sessionUser", JSON.stringify({ isSystemAdmin: true }));
    mount(<><TablePermissionButton resource="equipment-register" /><TablePermissionButton resource="knowledge-pages" label="页面与文件操作权限" /></>);
    expect(screen.getByRole("link", { name: /权限管理/ })).toHaveAttribute("href", expect.stringContaining("/permissions/equipment-register?from="));
    expect(screen.getByRole("link", { name: /页面与文件操作权限/ })).toHaveAttribute("href", expect.stringContaining("/permissions/knowledge-pages?from="));
  });
});
