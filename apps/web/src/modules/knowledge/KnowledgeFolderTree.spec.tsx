import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../api";
import { KnowledgeFolderTree } from "./KnowledgeFolderTree";
vi.mock("../../api",()=>({api:vi.fn()}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const row=(id:string,hasChildren=false)=>({id,name:id,hasChildren,breadcrumb:[{id:"hr",title:"人力资源"},{id,title:id}]});
const result=(rows:ReturnType<typeof row>[],total=rows.length,page=1)=>({rows,total,page,pageSize:100});
const expand=(name:string)=>fireEvent.click(screen.getByRole("button",{name}).closest(".ant-tree-treenode")!.querySelector(".ant-tree-switcher")!);
function mount(){const select=vi.fn(),client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});render(<QueryClientProvider client={client}><KnowledgeFolderTree spaceId="hr" onSelect={select}/></QueryClientProvider>);return{select,client};}
it("lazily expands three levels in one tree and selects an empty leaf",async()=>{
  vi.mocked(api).mockImplementation(async url=>{const p=new URL(String(url),"http://test").searchParams.get("parentFolderId");return result([row(p==="公司制度"?"人事制度":p==="人事制度"?"空文件夹":"公司制度",p!=="人事制度")]) as never;});
  const {select}=mount();await screen.findByRole("button",{name:"公司制度"});expand("公司制度");await screen.findByRole("button",{name:"人事制度"});expand("人事制度");fireEvent.click(await screen.findByRole("button",{name:"空文件夹"}));expect(select).toHaveBeenCalledWith("空文件夹");expect(screen.getAllByRole("tree")).toHaveLength(1);
});
it("loads beyond the first hundred child folders without truncation or duplicate pages",async()=>{
  vi.mocked(api).mockImplementation(async url=>{const q=new URL(String(url),"http://test").searchParams;if(!q.get("parentFolderId"))return result([row("公司制度",true)]) as never;const second=q.get("page")==="2";return result(Array.from({length:second?5:100},(_,i)=>row("子目录"+(second?100+i:i))),105,second?2:1) as never;});
  const {select}=mount();await screen.findByRole("button",{name:"公司制度"});expand("公司制度");fireEvent.click(await screen.findByRole("button",{name:"加载更多子文件夹"}));fireEvent.click(await screen.findByRole("button",{name:"子目录104"}));expect(select).toHaveBeenCalledWith("子目录104");expect(screen.getAllByRole("button",{name:/^子目录/})).toHaveLength(105);
});
it("shows a failed child load and retries without hiding the parent or selecting another folder",async()=>{
  let failed=false;vi.mocked(api).mockImplementation(async url=>{if(!new URL(String(url),"http://test").searchParams.get("parentFolderId"))return result([row("公司制度",true)]) as never;if(!failed){failed=true;throw Error("目录加载失败");}return result([row("空目录")]) as never;});
  const {select}=mount();await screen.findByRole("button",{name:"公司制度"});expand("公司制度");fireEvent.click(await screen.findByRole("button",{name:"重试加载子目录"}));await waitFor(()=>expect(screen.getByRole("button",{name:"空目录"})).toBeVisible());expect(select).not.toHaveBeenCalled();
});
