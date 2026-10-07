import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { api } from "../../api";
import { downloadApiFile } from "../../shared/legacy-ui";
import { KnowledgeHome, KnowledgeManagement, KnowledgeReader } from "./KnowledgePages";
import { KnowledgeEditor } from "./KnowledgeEditor";
import { KnowledgeCategories } from "./KnowledgeCategories";
import { ModulePortal } from "../portal/ModulePortal";

vi.mock("../../api", () => ({ api: vi.fn() }));
vi.mock("../../shared/legacy-ui", async (original) => ({ ...await original<object>(), downloadApiFile: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./KnowledgeContent", async (original) => ({ ...await original<object>(), KnowledgeRichEditor: ({ value, onChange, disabled }: any) => <textarea aria-label="文章正文" disabled={disabled} value={value?.content?.[0]?.content?.[0]?.text ?? ""} onChange={(event) => onChange({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: event.target.value }] }] })} /> }));
const root = { id: "root", parentId: null, level: 1, name: "人力资源", code: "HR", sortOrder: 0, enabled: true, version: 1 };
const category = { ...root, id: "child", parentId: "root", level: 2, name: "公司制度", code: "child" };
const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "员工请假正文" }] }] };
const article = { id: "article", version: 4, title: "员工请假管理办法", summary: "休假规定", categoryId: "child", categoryName: "公司制度", rootCategoryName: "人力资源", content: body, tags: ["休假"], status: "PUBLISHED", publishedVersion: 2, publisherName: "发布人甲", publishedBy: "member", publishedAt: "2026-10-07T02:00:00Z", viewCount: 3, visibility: { type: "ALL", subjectIds: [] }, attachments: [{ id: "file", articleId: "article", originalName: "制度.txt", contentType: "text/plain", size: 20 }], attachmentIds: ["file"] };
const ordinary = { sub: "member", permissions: ["knowledge-articles:*:read", "knowledge-categories:*:read", ...["knowledge-articles", "knowledge-categories"].flatMap((resource) => tablePermissionFieldsFor(resource as never).map((field) => `${resource}:${field.key}:read`))] };
const editor = { ...ordinary, permissions: [...ordinary.permissions, "knowledge-articles:*:create", "knowledge-articles:*:update", ...tablePermissionFieldsFor("knowledge-articles").filter((field) => field.editable).map((field) => `knowledge-articles:${field.key}:update`)] };
const admin = { sub: "admin", isSystemAdmin: true, permissions: ["*"] };
function mount(element: React.ReactNode, session = admin, route = "/knowledge") {
  localStorage.setItem("sessionUser", JSON.stringify(session));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><AntApp><MemoryRouter initialEntries={[route]}><Routes><Route path="/knowledge/manage/articles/new" element={element} /><Route path="/knowledge/manage/articles/:id/edit" element={element} /><Route path="/knowledge/articles/:id" element={element} /><Route path="*" element={element} /></Routes></MemoryRouter></AntApp></QueryClientProvider>);
}
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); vi.mocked(api).mockImplementation(async (path, init) => {
    if (init?.method === "POST" || init?.method === "PATCH") {
      if (path.endsWith("/attachments")) return { attachment: { id: "uploaded", originalName: "upload.txt", contentType: "text/plain", size: 2 }, version: 5 } as never;
      return { id: "article", version: 5, publishedVersion: 3 } as never;
    }
    if (path.startsWith("/knowledge/categories")) return [root, category] as never;
    if (path === "/knowledge/options") return { users: [{ id: "u1", label: "用户甲" }], organizations: [{ id: "o1", label: "组织甲" }], roles: [{ id: "r1", label: "角色甲" }] } as never;
    if (path.endsWith("/versions")) return [{ publishedVersion: 2, publishedAt: article.publishedAt }, { publishedVersion: 1, publishedAt: article.publishedAt }] as never;
    if (path.includes("/versions/1")) return { ...article, title: "历史标题", publishedVersion: 1, attachments: [] } as never;
    if (path.startsWith("/knowledge/articles/article")) return article as never;
    if (path.startsWith("/knowledge/articles?")) return { rows: [article], total: 1, page: 1, pageSize: 100 } as never;
    if (path.startsWith("/table-filters/rows")) return { rows: [article], total: 1 } as never;
    if (path === "/table-filters/resources") return [{ code: "knowledge-articles", filterableFields: ["title", "status", "categoryId", "tags", "updatedAt", "createdBy"] }] as never;
    return [] as never;
  });
});
afterEach(() => cleanup());

describe("Knowledge Phase 1 frontend", () => {
  it("Portal exposes independent Knowledge card and canonical route", () => { const open = vi.fn(); mount(<ModulePortal user={ordinary} onOpen={open} onLogout={vi.fn()} />, ordinary as never); fireEvent.click(screen.getByRole("button", { name: "进入知识库" })); expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "knowledge", englishTitle: "KNOWLEDGE BASE", path: "/knowledge" })); });
  it("ordinary homepage displays category/article/tags without management controls", async () => { mount(<KnowledgeHome />, ordinary as never); expect(await screen.findByText("员工请假管理办法")).toBeVisible(); expect(screen.getAllByText("人力资源").length).toBeGreaterThan(0); expect(screen.getByText("休假")).toBeVisible(); for (const label of ["新增二级分类", "新建文章", "文章管理"]) expect(screen.queryByRole("button", { name: label })).toBeNull(); });
  it("search sends Chinese query to authorized server with page reset", async () => { mount(<KnowledgeHome />, ordinary as never); await screen.findByText("员工请假管理办法"); fireEvent.change(screen.getByRole("searchbox", { name: "搜索知识" }), { target: { value: "请假" } }); fireEvent.click(screen.getByRole("button", { name: /搜\s*索/ })); await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining("search=%E8%AF%B7%E5%81%87&page=1"))); });
  it("category tree updates existing browse query", async () => { mount(<KnowledgeHome />, ordinary as never); await screen.findByText("员工请假管理办法"); fireEvent.click(screen.getByText("公司制度")); await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining("categoryId=child"))); });
  it("article editors can create articles but not categories", async () => { mount(<KnowledgeHome />, editor as never); await screen.findByText("员工请假管理办法"); expect(screen.getByRole("button", { name: "新建文章" })).toBeVisible(); expect(screen.queryByRole("button", { name: "新增二级分类" })).toBeNull(); });
  it("module administrator can manually create a level-two category", async () => { mount(<KnowledgeCategories />, { ...ordinary, moduleAdminCodes: ["knowledge"] } as never); fireEvent.click(await screen.findByRole("button", { name: /新增二级分类/ })); fireEvent.change(screen.getByLabelText("分类名称"), { target: { value: "培训制度" } }); fireEvent.click(screen.getByRole("button", { name: /OK|确\s*定/ })); await waitFor(() => expect(api).toHaveBeenCalledWith("/knowledge/categories", expect.objectContaining({ method: "POST", body: expect.stringContaining('"parentId":"root"') }))); });
  it("category rename/sort/status popup uses existing update action and expectedVersion", async () => { mount(<KnowledgeCategories />); fireEvent.click(await screen.findByRole("button", { name: "修改分类公司制度" })); fireEvent.change(screen.getByLabelText("分类名称"), { target: { value: "新制度" } }); fireEvent.click(screen.getByRole("button", { name: /OK|确\s*定/ })); await waitFor(() => expect(api).toHaveBeenCalledWith("/knowledge/categories/child", expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"expectedVersion":1') }))); });
  it("reader presents published body/version/metadata and controlled download", async () => { mount(<KnowledgeReader />, ordinary as never, "/knowledge/articles/article"); expect(await screen.findByText("员工请假正文")).toBeVisible(); expect(screen.getByText("版本 v2")).toBeVisible(); expect(screen.getByText("浏览量 3")).toBeVisible(); expect(screen.queryByRole("button", { name: "历史版本" })).toBeNull(); fireEvent.click(screen.getByRole("button", { name: "制度.txt" })); await waitFor(() => expect(downloadApiFile).toHaveBeenCalledWith("/knowledge/attachments/file", "制度.txt")); });
  it("administrator reads immutable historical version", async () => { mount(<KnowledgeReader />, admin, "/knowledge/articles/article"); fireEvent.click(await screen.findByRole("button", { name: "历史版本" })); fireEvent.click(await screen.findByRole("button", { name: /v1 ·/ })); expect(await screen.findByText("历史标题")).toBeVisible(); expect(screen.queryByRole("button", { name: "制度.txt" })).toBeNull(); });
  it("backend rejects are visible on reader and homepage", async () => { vi.mocked(api).mockRejectedValue(new Error("文章不存在或无权访问")); mount(<KnowledgeReader />, ordinary as never, "/knowledge/articles/article"); expect(await screen.findByText("文章不存在或无权访问")).toBeVisible(); });
  it("management reuses standard table search/filter and current server rows", async () => { mount(<KnowledgeManagement />); expect(await screen.findByRole("button", { name: "员工请假管理办法" })).toBeVisible(); expect(screen.getByRole("button", { name: /高级筛选/ })).toBeVisible(); expect(api).toHaveBeenCalledWith(expect.stringContaining("/table-filters/rows?resource=knowledge-articles")); });
  it("ordinary users cannot open management/edit routes", () => { mount(<KnowledgeManagement />, ordinary as never); expect(screen.getByText("当前权限组没有文章管理权限")).toBeVisible(); cleanup(); mount(<KnowledgeEditor />, ordinary as never, "/knowledge/manage/articles/new"); expect(screen.getByText("当前权限组没有文章编辑权限")).toBeVisible(); });
  it("new article saves a structured draft without client contentText", async () => { mount(<KnowledgeEditor />, editor as never, "/knowledge/manage/articles/new"); await waitFor(() => expect(screen.getByText("人力资源")).toBeVisible()); fireEvent.change(screen.getByLabelText("标题"), { target: { value: "新知识" } }); fireEvent.change(screen.getByRole("textbox", { name: "文章正文" }), { target: { value: "安全正文" } }); fireEvent.click(screen.getByRole("button", { name: "保存草稿" })); await waitFor(() => expect(api).toHaveBeenCalledWith("/knowledge/articles", expect.objectContaining({ method: "POST" }))); const call = vi.mocked(api).mock.calls.find(([path, init]) => path === "/knowledge/articles" && init?.method === "POST")!; const payload = JSON.parse(String(call[1]?.body)); expect(payload).toMatchObject({ title: "新知识", categoryId: "root", content: { type: "doc" }, visibility: { type: "ALL", subjectIds: [] } }); expect(payload.contentText).toBeUndefined(); });
  it("published editing saves working copy and republishes using returned version", async () => { mount(<KnowledgeEditor />, editor as never, "/knowledge/manage/articles/article/edit"); await screen.findByDisplayValue("员工请假管理办法"); fireEvent.change(screen.getByLabelText("标题"), { target: { value: "新发布标题" } }); fireEvent.click(screen.getByRole("button", { name: "重新发布" })); await waitFor(() => expect(api).toHaveBeenCalledWith("/knowledge/articles/article/publish", expect.objectContaining({ body: '{"expectedVersion":5}' }))); });
  it("attachment upload binds article and optimistic version", async () => { const view = mount(<KnowledgeEditor />, editor as never, "/knowledge/manage/articles/article/edit"); await screen.findByDisplayValue("员工请假管理办法"); const input = view.container.querySelector('input[type="file"]')!; fireEvent.change(input, { target: { files: [new File(["x"], "upload.txt", { type: "text/plain" })] } }); await waitFor(() => expect(api).toHaveBeenCalledWith("/knowledge/articles/article/attachments", expect.objectContaining({ method: "POST", body: expect.any(FormData) }))); const call = vi.mocked(api).mock.calls.find(([path]) => path.endsWith("/attachments"))!; expect((call[1]?.body as FormData).get("expectedVersion")).toBe("4"); });
  it("ACL form uses existing stable user/organization/role options", async () => { mount(<KnowledgeEditor />, editor as never, "/knowledge/manage/articles/article/edit"); await screen.findByDisplayValue("员工请假管理办法"); fireEvent.mouseDown(screen.getByLabelText("可见范围")); fireEvent.click(await screen.findByText("指定人员")); fireEvent.mouseDown(screen.getByLabelText("可见对象")); await waitFor(() => expect(screen.getByText("用户甲")).toBeVisible()); });
  it("failed publication keeps the saved working version for retry", async () => {
    const base = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (path, init) => { if (path.endsWith("/publish")) throw new Error("分类已停用"); return base(path, init); });
    mount(<KnowledgeEditor />, editor as never, "/knowledge/manage/articles/article/edit"); await screen.findByDisplayValue("员工请假管理办法");
    fireEvent.click(screen.getByRole("button", { name: "重新发布" })); expect(await screen.findByText("工作副本已保存，发布失败：分类已停用")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" })); await waitFor(() => expect(vi.mocked(api).mock.calls.filter(([path, init]) => path === "/knowledge/articles/article" && init?.method === "PATCH")).toHaveLength(2));
    const calls = vi.mocked(api).mock.calls.filter(([path, init]) => path === "/knowledge/articles/article" && init?.method === "PATCH"); expect(JSON.parse(String(calls[1]?.[1]?.body)).expectedVersion).toBe(5);
  });
  it("save failure displays error and retains work", async () => { const base = vi.mocked(api).getMockImplementation()!; vi.mocked(api).mockImplementation(async (path, init) => { if (init?.method === "PATCH") throw new Error("数据已被其他人修改，请刷新后重试"); return base(path, init); }); mount(<KnowledgeEditor />, editor as never, "/knowledge/manage/articles/article/edit"); await screen.findByDisplayValue("员工请假管理办法"); fireEvent.click(screen.getByRole("button", { name: "保存草稿" })); expect(await screen.findByText("数据已被其他人修改，请刷新后重试")).toBeVisible(); expect(screen.getByDisplayValue("员工请假管理办法")).toBeVisible(); });
});
