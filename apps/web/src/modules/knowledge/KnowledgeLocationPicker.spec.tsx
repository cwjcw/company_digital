import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "antd";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import type { KnowledgeSpace } from "@kdos/contracts";
import { api } from "../../api";
import { KnowledgeLocationPicker, type KnowledgeLocationValue } from "./KnowledgeLocationPicker";
vi.mock("../../api", () => ({ api: vi.fn() }));
const spaces = [{ id: "hr", name: "人力资源", canCreate: true }, { id: "denied", name: "只读空间", canCreate: false }] as KnowledgeSpace[];
function Fixture({ folderId }: { folderId?: string }) {
  const [value, setValue] = useState<KnowledgeLocationValue>({ spaceId: "hr", folderId });
  return <KnowledgeLocationPicker spaces={spaces} value={value} onChange={setValue} />;
}
const path = (id: string, title: string, branch?: string) => ({ id, name: title, hasChildren: false,
  breadcrumb: [{ id: "hr", title: "人力资源" }, ...(branch ? [{ id: branch, title: branch }] : []), { id, title }] });
function mount(folderId?: string) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><App><Fixture folderId={folderId} /></App></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 100 } as never);
});
afterEach(cleanup);
it("empty Space defaults to explicit root without querying or showing a parent dropdown", () => {
  mount();
  expect(screen.getByLabelText("保存位置")).toHaveTextContent("人力资源 > 空间根目录");
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(api).not.toHaveBeenCalled();
});
it("resolves the current page and displays the complete authorized path", async () => {
  vi.mocked(api).mockResolvedValue({ rows: [path("policy", "公司制度", "管理制度")], total: 1 } as never);
  mount("policy");
  await waitFor(() => expect(screen.getByLabelText("保存位置")).toHaveTextContent("人力资源 > 管理制度 > 公司制度"));
  expect(api).toHaveBeenCalledWith(expect.stringContaining("selectedId=policy"));
  expect(screen.queryByRole("combobox")).toBeNull();
});
it("opens lazy tree only on change and loads child levels on expansion", async () => {
  vi.mocked(api).mockImplementation(async (url) => ({ rows: url.includes("parentFolderId=policy") || url.includes("selectedId=leaf") ? [path("leaf", "员工手册", "公司制度")] : [{ ...path("policy", "公司制度"), hasChildren: true }], total: 1 } as never));
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "更改位置" }));
  expect(await screen.findByRole("button", { name: "公司制度" })).toBeVisible();
  expect(api).not.toHaveBeenCalledWith(expect.stringContaining("parentFolderId=policy"));
  fireEvent.click(view.container.querySelector('.ant-tree-switcher')!);
  fireEvent.click(await screen.findByRole("button", { name: "员工手册" }));
  await waitFor(() => expect(screen.getByLabelText("保存位置")).toHaveTextContent("员工手册"));
  expect(screen.queryByLabelText("搜索保存位置")).toBeNull();
});
it("search distinguishes duplicate titles by full path and can find results beyond 100", async () => {
  vi.mocked(api).mockImplementation(async (url) => {
    const p = new URL(url, "http://fixture").searchParams;
    if (p.has("selectedId")) return { rows: [path("late", "公司制度", "事业四部")], total: 1 } as never;
    if (p.has("search")) return { rows: p.get("page") === "2" ? [path("late", "公司制度", "事业四部")] : [path("first", "公司制度", "事业一部"), path("second", "公司制度", "事业二部")], total: 101, page: Number(p.get("page")), pageSize: 100 } as never;
    return { rows: [], total: 0 } as never;
  });
  mount(); fireEvent.click(screen.getByRole("button", { name: "更改位置" }));
  fireEvent.change(screen.getByLabelText("搜索保存位置"), { target: { value: "公司制度" } });
  expect(await screen.findByRole("button", { name: "人力资源 > 事业一部 > 公司制度" })).toBeVisible();
  expect(screen.getByRole("button", { name: "人力资源 > 事业二部 > 公司制度" })).toBeVisible();
  fireEvent.click(screen.getByTitle("2"));
  fireEvent.click(await screen.findByRole("button", { name: "人力资源 > 事业四部 > 公司制度" }));
  await waitFor(() => expect(screen.getByLabelText("保存位置")).toHaveTextContent("事业四部 > 公司制度"));
  expect(api).toHaveBeenCalledWith(expect.stringContaining("page=2"));
});
it("does not offer a read-only Space and marks an unauthorized selected parent invalid", async () => {
  const valid = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App><KnowledgeLocationPicker spaces={spaces} value={{ spaceId: "hr", folderId: "forbidden" }} onChange={vi.fn()} onValidityChange={valid} /></App></QueryClientProvider>);
  await waitFor(() => expect(valid).toHaveBeenLastCalledWith(false));
  await screen.findByText(/当前位置不可创建知识/);
  fireEvent.click(screen.getByRole("button", { name: "更改位置" }));
  fireEvent.mouseDown(document.querySelector('.ant-select-selector')!);
  expect(screen.queryByText("只读空间")).toBeNull();
});

it.each([
  ["upload", "文件将保存到所选空间或文件夹内。"],
  ["create", "新页面将创建在所选位置。"],
  ["import", "转换后的在线文章将创建在所选位置。"],
  ["move", "当前知识及历史子页面将移动到所选文件夹；已发布内容需发布后更新阅读位置。"],
] as const)("explains the %s operation accurately without changing target authorization", (operation, description) => {
  const valid = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><KnowledgeLocationPicker operation={operation} spaces={spaces} value={{ spaceId: "hr" }} onChange={vi.fn()} onValidityChange={valid} /></QueryClientProvider>);
  expect(screen.getByText(new RegExp(description))).toBeVisible();
  expect(valid).toHaveBeenCalledWith(true);
});

it("creates a child folder inside the picker and selects the new empty folder immediately", async () => {
  const createSpaces=[{id:"hr",name:"人力资源",canCreate:true,canCreateFolders:true}] as KnowledgeSpace[];
  vi.mocked(api).mockImplementation(async (url) => url==="/knowledge/folders" ? {id:"new",version:1} as never : {rows:url.includes("selectedId=new")?[path("new","新目录")]:[],total:url.includes("selectedId=new")?1:0,page:1,pageSize:100} as never);
  function CreationFixture() {const [value,setValue]=useState<KnowledgeLocationValue>({spaceId:"hr"});return <KnowledgeLocationPicker spaces={createSpaces} value={value} onChange={setValue}/>;}
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><App><CreationFixture/></App></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button",{name:"更改位置"}));fireEvent.click(screen.getByRole("button",{name:"在所选位置新建文件夹"}));
  fireEvent.change(screen.getByLabelText("文件夹名称"),{target:{value:"新目录"}});fireEvent.click(screen.getByRole("button",{name:"创建文件夹"}));
  await waitFor(()=>expect(screen.getByLabelText("保存位置")).toHaveTextContent("人力资源 > 新目录"));
  expect(api).toHaveBeenCalledWith("/knowledge/folders",expect.objectContaining({method:"POST",body:JSON.stringify({spaceId:"hr",parentFolderId:null,name:"新目录"})}));
});
