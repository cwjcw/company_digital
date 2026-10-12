import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { api } from "../../api";
import { KnowledgeRoutes } from "./KnowledgeRoutes";
vi.mock("../../api", async original => ({ ...await original<object>(), api: vi.fn() }));
vi.mock("./KnowledgeFilePreview", () => ({ KnowledgeFilePreview: ({ file, scope }: any) => <div>在线预览 {file.originalName} {scope.mode} {scope.versionId}</div> }));
const readPermissions = ["knowledge-pages:*:read", "knowledge-spaces:*:read", ...(["knowledge-pages", "knowledge-spaces"] as const).flatMap(r => tablePermissionFieldsFor(r).map(f => `${r}:${f.key}:read`))];
const users = {
  reader: { permissions: readPermissions },
  editor: { permissions: [...readPermissions, "knowledge-pages:*:create", "knowledge-pages:*:update", "knowledge-pages:*:import", ...tablePermissionFieldsFor("knowledge-pages").map(f => `knowledge-pages:${f.key}:update`)] },
  admin: { permissions: ["*"], isSystemAdmin: true }
};
type Role = keyof typeof users;
let role: Role;
const root = { id: "hr", title: "人力资源", kind: "space" };
const folders = [
  { id: "f1", name: "公司制度", parentFolderId: null, breadcrumb: [root, { id: "f1", title: "公司制度", kind: "folder" }] },
  { id: "f2", name: "人事制度", parentFolderId: "f1", breadcrumb: [root, { id: "f1", title: "公司制度", kind: "folder" }, { id: "f2", title: "人事制度", kind: "folder" }] },
  { id: "f3", name: "员工考勤", parentFolderId: "f2", breadcrumb: [root, { id: "f1", title: "公司制度", kind: "folder" }, { id: "f2", title: "人事制度", kind: "folder" }, { id: "f3", title: "员工考勤", kind: "folder" }] }
];
const records = [
  { id: "legacy", title: "历史制度", parentId: null, folderId: null, hasChildren: true, breadcrumb: [root, { id: "legacy", title: "历史制度", kind: "page" }] },
  { id: "child", title: "历史子制度", parentId: "legacy", folderId: null, hasChildren: true, breadcrumb: [root, { id: "legacy", title: "历史制度", kind: "page" }, { id: "child", title: "历史子制度", kind: "page" }] },
  { id: "old-file", title: "旧考勤文件", parentId: "child", folderId: null, hasChildren: false, breadcrumb: [root, { id: "legacy", title: "历史制度", kind: "page" }, { id: "child", title: "历史子制度", kind: "page" }, { id: "old-file", title: "旧考勤文件", kind: "page" }] },
  { id: "file", title: "考勤制度.pdf", parentId: null, folderId: "f3", hasChildren: false, breadcrumb: [...folders[2]!.breadcrumb, { id: "file", title: "考勤制度.pdf", kind: "page" }] }
].map(p => ({ ...p, spaceId: "hr", spaceName: "人力资源", status: "PUBLISHED", version: 1, contentMode: p.id.includes("file") ? "FILE" : "RICH_TEXT", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] }, primaryFile: p.id.includes("file") ? { id: "asset-" + p.id, originalName: p.title, contentType: "application/pdf" } : undefined }));
function mount(path: string, r: Role = "reader") {
  role = r; localStorage.setItem("sessionUser", JSON.stringify(users[r]));
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><App><MemoryRouter initialEntries={[path]}><Routes><Route path="/knowledge/*" element={<KnowledgeRoutes />} /></Routes></MemoryRouter></App></QueryClientProvider>);
}
beforeEach(() => {
  role = "reader"; vi.clearAllMocks(); localStorage.clear();
  vi.mocked(api).mockImplementation(async path => {
    const url = new URL(path, "http://test"), q = url.searchParams;
    if (url.pathname === "/knowledge/capabilities") return { canManage: role !== "reader", canManageFolders: role !== "reader", canCreatePages: role !== "reader", canEditPages: role !== "reader", canManagePages: role === "admin", canCreateSpaces: role === "admin", canManageSpaces: role === "admin", canArchive: role === "admin", canTrash: role === "admin" } as never;
    if (url.pathname === "/knowledge/spaces") return [{ id: "hr", name: "人力资源", status: "ACTIVE", accessLevel: role === "reader" ? "VIEWER" : role === "editor" ? "EDITOR" : "FULL_ACCESS", canCreate: role !== "reader", canCreateFolders: role !== "reader", canManage: role === "admin" }] as never;
    if (url.pathname.endsWith("/folders")) { const rows = folders.filter(f => q.get("selectedId") ? f.id === q.get("selectedId") : f.parentFolderId === q.get("parentFolderId")); return { rows, total: rows.length, page: 1, pageSize: 20 } as never; }
    if (url.pathname.endsWith("/tree")) { const rows = records.filter(p => p.parentId === q.get("parentId") && (q.has("parentId") || p.folderId === (q.get("folderId") || null))); return { rows, total: rows.length, page: 1, pageSize: 20 } as never; }
    if (url.pathname.startsWith("/knowledge/pages/")) return records.find(p => p.id === url.pathname.split("/")[3]) as never;
    return [] as never;
  });
});
afterEach(cleanup);
describe("Knowledge one directory navigation", () => {
  it.each(["reader", "editor", "admin"] as Role[])("uses one published directory for %s without duplicate trees or root buttons", async r => {
    const ui = mount("/knowledge/spaces/hr", r);
    const folder = await screen.findByRole("button", { name: "公司制度" });
    expect(folder.querySelector('[data-icon="folder"]')).not.toBeNull();
    const page = await screen.findByRole("button", { name: "历史制度" });
    expect(page.querySelector('[data-icon="file"]')).not.toBeNull();
    expect(screen.queryByRole("tree")).toBeNull(); expect(ui.container.querySelector(".knowledge-directory")).toBeNull();
    expect(screen.queryByRole("button", { name: "空间根目录" })).toBeNull();
    expect(vi.mocked(api).mock.calls.some(([p]) => p.includes("legacyOnly") || p.includes("mode=working"))).toBe(false);
  });
  it("navigates three levels, reads a FILE and returns through the complete breadcrumb", async () => {
    mount("/knowledge/spaces/hr");
    for (const name of ["公司制度", "人事制度", "员工考勤"]) fireEvent.click(await screen.findByRole("button", { name }));
    fireEvent.click(await screen.findByRole("button", { name: "考勤制度.pdf" }));
    await screen.findByText("在线预览 考勤制度.pdf published");
    fireEvent.click(screen.getByRole("link", { name: "人事制度" }));
    await screen.findByRole("button", { name: "员工考勤" });
    fireEvent.click(within(screen.getByRole("main")).getByRole("button", { name: "人力资源" }));
    await screen.findByRole("button", { name: "公司制度" }); expect(screen.queryByRole("button", { name: "返回上级目录" })).toBeNull();
  });
  it.each(["reader", "admin"] as Role[])("preserves multi-level historical parent pages and original reader links for %s", async r => {
    mount("/knowledge/spaces/hr", r);
    fireEvent.click(await screen.findByRole("button", { name: "浏览子页面：历史制度" }));
    await screen.findByRole("button", { name: "阅读当前知识" });
    fireEvent.click(await screen.findByRole("button", { name: "浏览子页面：历史子制度" }));
    fireEvent.click(await screen.findByRole("button", { name: "旧考勤文件" }));
    await screen.findByRole("heading", { name: "旧考勤文件" });
    fireEvent.click(screen.getByRole("link", { name: "历史子制度" }));
    await screen.findByRole("button", { name: "旧考勤文件" });
    fireEvent.click(within(screen.getByRole("main")).getByRole("button", { name: "历史制度" }));
    await screen.findByRole("button", { name: "历史子制度" });
    for (const [path] of vi.mocked(api).mock.calls.filter(([path]) => path.includes("/tree?") && path.includes("parentId="))) expect(new URL(path, "http://test").searchParams.has("folderId")).toBe(false);
  });
  it.each(["editor", "admin"] as Role[])("keeps authorized management actions above a single list for %s", async r => {
    const ui = mount("/knowledge/manage?spaceId=hr", r);
    await screen.findByRole("button", { name: "公司制度" });
    expect(screen.getByRole("combobox", { name: "知识空间" })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "新建知识" })).toBeInTheDocument();
    expect(ui.container.querySelector(".knowledge-management-controls")).not.toBeNull();
    expect(ui.container.querySelector(".knowledge-sidebar")).toBeNull(); expect(screen.queryByRole("tree")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "浏览子页面：历史制度" }));
    fireEvent.click(await screen.findByRole("button", { name: "浏览子页面：历史子制度" }));
    fireEvent.click(await screen.findByRole("button", { name: "旧考勤文件" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/knowledge/pages/old-file?mode=published"));
  });
  it("retains an actual folder selector in the upload form", async () => {
    mount("/knowledge/manage?spaceId=hr", "editor"); await screen.findByRole("button", { name: "上传文件" }); fireEvent.click(screen.getByRole("button", { name: "上传文件" }));
    fireEvent.click(await screen.findByRole("button", { name: "更改位置" }));
    await screen.findByRole("tree"); expect(screen.getByLabelText("搜索保存位置")).toBeInTheDocument();
  });
  it("pages all 105 knowledge entries beyond the first hundred in the unified list", async () => {
    const original = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation((p,i) => {
      if (p.includes("/tree?")) { const q = new URL(p,"http://test").searchParams, page = Number(q.get("page") || 1); const all = Array.from({length:105}, (_,index) => ({...records[3],id:`many-${index+1}`,title:`资料${index+1}`,parentId:null,folderId:null})); return Promise.resolve({rows:all.slice((page-1)*20,page*20),total:105,page,pageSize:20} as never); }
      return original(p,i);
    });
    mount("/knowledge/spaces/hr"); await screen.findByRole("button",{name:"资料20"});
    fireEvent.click(screen.getByTitle("6")); await screen.findByRole("button",{name:"资料105"});
    expect(screen.getAllByRole("button",{name:/^资料/})).toHaveLength(5);
  });
  it("does not query children of an inaccessible or cross-space legacy parent", async () => {
    const original = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation((p,i) => p.startsWith("/knowledge/pages/legacy?") ? Promise.resolve({ ...records[0], spaceId: "other" } as never) : original(p,i));
    mount("/knowledge/spaces/hr?parentId=legacy"); await screen.findByText("该知识页面不属于当前知识空间");
    expect(vi.mocked(api).mock.calls.some(([p]) => p.includes("/tree?") && p.includes("parentId=legacy"))).toBe(false);
  });
});
