import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tablePermissionFieldsFor, type KnowledgeCapabilities } from "@kdos/contracts";
import { api } from "../../api";
import { KnowledgeRoutes } from "./KnowledgeRoutes";
vi.mock("../../api", async (original) => ({ ...await original<object>(), api: vi.fn() }));
vi.mock("./KnowledgeFilePreview", () => ({ KnowledgeFilePreview: ({ file, scope, canRetry }: any) => <div>私有预览 {file.originalName} {scope.mode} {scope.versionId}{canRetry && "管理员重试"}</div> }));
const reader = { permissions: ["knowledge-spaces:*:read", "knowledge-pages:*:read", ...["knowledge-pages", "knowledge-spaces"].flatMap(r => tablePermissionFieldsFor(r as never).map(f => `${r}:${f.key}:read`))] };
const space = { id: "hr", name: "人力资源", icon: "book", description: "真实空间说明", status: "ACTIVE", canCreate: false, canManage: false };
const article = { id: "p", spaceId: "hr", parentId: null, title: "已发布制度", contentMode: "RICH_TEXT", publishedAt: "2026-10-09T01:00:00+08:00", description: "制度摘要", breadcrumb: [{id:"hr",title:"人力资源"},{id:"p",title:"已发布制度"}], spaceName:"人力资源", content: { type:"doc",content:[{type:"heading",attrs:{level:2},content:[{type:"text",text:"制度章节"}]},{type:"paragraph",content:[{type:"text",text:"正式正文"}]}] } };
const none: KnowledgeCapabilities = { canManage:false,canCreatePages:false,canEditPages:false,canManagePages:false,canCreateSpaces:false,canManageSpaces:false,canArchive:false,canTrash:false };
let caps = none;
function mount(path = "/knowledge", user: any = reader) {
  localStorage.setItem("sessionUser", JSON.stringify(user));
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}><App><MemoryRouter initialEntries={[path]}><Routes><Route path="/knowledge/*" element={<KnowledgeRoutes />} /></Routes></MemoryRouter></App></QueryClientProvider>);
}
beforeEach(() => {
  caps = {...none}; vi.clearAllMocks(); localStorage.clear();
  vi.mocked(api).mockImplementation(async (path) => {
    if(path === "/knowledge/capabilities") return caps as never;
    if(path === "/knowledge/spaces") return [space] as never;
    if(path.startsWith("/knowledge/pages/p?")) return article as never;
    if(path.includes("/tree")) return {rows:[],total:0,page:1,pageSize:100} as never;
    if(path.startsWith("/knowledge/pages?") || path.startsWith("/knowledge/search?")) {const p = new URLSearchParams(path.split("?")[1]);return {rows:[article],total:21,page:Number(p.get("page")??1),pageSize:Number(p.get("pageSize")??10)} as never;}
    return [] as never;
  });
});
afterEach(cleanup);
describe("Knowledge employee portal", () => {
  it("defaults readers and administrators to published homepage without management controls", async () => {
    mount(); await screen.findByRole("heading",{name:"凯南知识库"}); await screen.findByText("真实空间说明");
    await screen.findByRole("link",{name:"已发布制度"});
    expect(screen.queryByRole("link",{name:"进入知识管理"})).toBeNull();
    for(const label of ["新建知识","空间设置","回收站","编辑","发布"]) expect(screen.queryByRole("button",{name:label})).toBeNull();
    expect(api).toHaveBeenCalledWith(expect.stringContaining("sortField=publishedAt&sortOrder=desc"));
    expect(api).not.toHaveBeenCalledWith(expect.stringContaining("mode=working"));
  });
  it("shows separate management only with derived actual capability", async () => {
    caps={...none,canManage:true,canEditPages:true};mount();await screen.findByRole("link",{name:"进入知识管理"});
    expect(screen.queryByRole("button",{name:"编辑"})).toBeNull();
  });
  it("pages recent results beyond the initial ten", async () => {
    mount();fireEvent.click(await screen.findByRole("button",{name:"查看更多"}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith(expect.stringContaining("page=2&pageSize=10")));
  });
  it("searches only published scope and presents authorized path/type/summary/date", async () => {
    mount("/knowledge?search=制度");await screen.findByText("制度摘要");
    expect(api).toHaveBeenCalledWith(expect.stringMatching(/\/knowledge\/search\?mode=published.*search=/));
    expect(screen.getByText("人力资源 > 已发布制度")).toBeInTheDocument();
    expect(screen.getByText("在线文章")).toBeInTheDocument();
    expect(screen.queryByText(/草稿修改时间/)).toBeNull();
  });
  it.each(["/knowledge/manage","/knowledge/manage/pages/p?mode=working","/knowledge/manage/spaces","/knowledge/manage/trash"])("rejects unauthorized management route %s without draft queries", async path => {
    mount(path);await screen.findByText("当前权限不能进入此知识管理区域");
    expect(vi.mocked(api).mock.calls.some(([url])=>url.includes("mode=working"))).toBe(false);
  });
  it("denies users without Knowledge read before any Knowledge API request", async () => {
    mount("/knowledge",{permissions:[]});expect(screen.getByText("当前权限组不能查看知识库")).toBeInTheDocument();expect(api).not.toHaveBeenCalled();
  });
  it("legacy working/edit links do not grant reader draft access", async () => {
    mount("/knowledge/pages/p?mode=working&edit=1");await screen.findByText("当前权限不能查看或编辑工作草稿");
    expect(vi.mocked(api).mock.calls.some(([url])=>url.includes("/pages/p"))).toBe(false);
  });
  it("stable shared links read published rich content and provide a TOC", async () => {
    mount("/knowledge/pages/p");await screen.findByRole("heading",{name:"已发布制度"});await screen.findByText("正式正文");
    expect(screen.getByRole("link",{name:"制度章节"})).toHaveAttribute("href","#knowledge-heading-0");
    expect(api).toHaveBeenCalledWith("/knowledge/pages/p?mode=published");expect(screen.queryByRole("button",{name:"编辑"})).toBeNull();
  });
  it("historical FILE preview keeps authenticated published version scope", async () => {
    const base=vi.mocked(api).getMockImplementation()!;vi.mocked(api).mockImplementation((p,i)=>p.includes("/pages/p?") ? Promise.resolve({...article,contentMode:"FILE",primaryFile:{id:"file",originalName:"历史制度.docx"}} as never):base(p,i));
    mount("/knowledge/pages/p?versionId=v1");await screen.findByText("私有预览 历史制度.docx published v1");
    expect(api).toHaveBeenCalledWith("/knowledge/pages/p?mode=published&versionId=v1");expect(screen.queryByText("管理员重试")).toBeNull();
  });
  it("empty Space uses a meaningful directory empty state and no creation selector", async () => {
    mount("/knowledge/spaces/hr");await screen.findAllByText("暂无可见知识");expect(screen.getByRole("button",{name:"空间根目录"})).toBeInTheDocument();expect(screen.queryByRole("combobox")).toBeNull();
  });
  it("network failures provide retry without inventing knowledge rows", async () => {
    const base=vi.mocked(api).getMockImplementation()!;let fail=true;
    vi.mocked(api).mockImplementation((p,i)=>p.startsWith("/knowledge/pages?")&&fail?Promise.reject(new Error("暂时无法加载知识")):base(p,i));
    mount();await screen.findByText("暂时无法加载知识");fail=false;fireEvent.click(screen.getByRole("button",{name:/重\s*试/}));await screen.findByRole("link",{name:"已发布制度"});
  });
});
