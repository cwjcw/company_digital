import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { KnowledgeCapabilities } from "@kdos/contracts";
import { KnowledgeRoutes } from "./KnowledgeRoutes";
const state=vi.hoisted(()=>({data:{} as KnowledgeCapabilities}));
vi.mock("../../shared/KdosDataTable",()=>({hasResourcePermission:()=>true}));
vi.mock("./knowledge-portal",()=>({useKnowledgeCapabilities:()=>({data:state.data,isPending:false})}));
vi.mock("./KnowledgePages",()=>({KnowledgeManagement:()=> <div>已进入知识工作台</div>}));
vi.mock("./KnowledgePortal",()=>({KnowledgeHome:()=>null,KnowledgeQueryState:()=>null,KnowledgeReader:()=>null,KnowledgeSpaceBrowse:()=>null}));
afterEach(cleanup);
function mount(extra:Partial<KnowledgeCapabilities>,path="/knowledge/manage"){
 state.data={canManage:false,canManageFolders:false,canCreatePages:false,canEditPages:false,canManagePages:false,canCreateSpaces:false,canManageSpaces:false,canArchive:false,canTrash:false,...extra};
 render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/knowledge/*" element={<KnowledgeRoutes/>}/></Routes></MemoryRouter>);
}
it("allows a folder-only manager into the workspace without requiring an editable page",()=>{
 mount({canManage:true,canManageFolders:true});expect(screen.getByText("已进入知识工作台")).toBeVisible();expect(screen.getByRole("link",{name:"页面与文件"})).toBeVisible();
});
it("folder management does not grant entry to page editing routes",()=>{
 mount({canManage:true,canManageFolders:true},"/knowledge/manage/pages/page-id?edit=1");expect(screen.getByText("当前权限不能进入此知识管理区域")).toBeVisible();expect(screen.queryByText("已进入知识工作台")).toBeNull();
});
it("denies the workspace to a reader without management capabilities",()=>{
 mount({});expect(screen.getByText("当前权限不能进入此知识管理区域")).toBeVisible();expect(screen.queryByText("已进入知识工作台")).toBeNull();
});
it("preserves the existing page creator workspace entry",()=>{
 mount({canManage:true,canCreatePages:true});expect(screen.getByText("已进入知识工作台")).toBeVisible();
});
