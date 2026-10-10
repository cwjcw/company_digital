import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KnowledgePageResult, KnowledgeSpace } from "@kdos/contracts";
import { api } from "../../api";
import { KnowledgePageTree } from "./KnowledgePageTree";
vi.mock("../../api",async(original)=>({...await original<object>(),api:vi.fn()}));
const space:KnowledgeSpace={id:"hr",code:"HR",name:"人力资源",description:"",icon:"book",sortOrder:0,status:"ACTIVE",version:1};
const row=(title:string)=>({id:title,title,hasChildren:false});
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe("shared published/management lazy Knowledge tree",()=>{
  it("retains loaded nodes when the consumer changes its navigation callback",async()=>{
    vi.mocked(api).mockResolvedValue({rows:[row("正式目录")],total:1} as never);
    const original=vi.fn(),next=vi.fn();const ui=render(<KnowledgePageTree space={space} working={false} refresh={0} onOpen={original}/>);
    await screen.findByRole("button",{name:"正式目录"});ui.rerender(<KnowledgePageTree space={space} working={false} refresh={0} onOpen={next}/>);
    fireEvent.click(screen.getByRole("button",{name:"正式目录"}));expect(next).toHaveBeenCalled();expect(original).not.toHaveBeenCalled();expect(api).toHaveBeenCalledTimes(1);
  });
  it("ignores a previous Space's late paginated response",async()=>{
    let release!:(result:KnowledgePageResult)=>void;const pending=new Promise<KnowledgePageResult>(resolve=>{release=resolve;});
    vi.mocked(api).mockImplementation(async(path)=>path.includes("/other/")?{rows:[row("其他空间目录")],total:1} as never:path.includes("page=2")?pending as never:{rows:[row("旧空间目录")],total:101} as never);
    const onOpen=vi.fn();const ui=render(<KnowledgePageTree space={space} working={false} refresh={0} onOpen={onOpen}/>);
    fireEvent.click(await screen.findByRole("button",{name:"加载更多"}));await waitFor(()=>expect(api).toHaveBeenCalledWith(expect.stringContaining("page=2")));
    ui.rerender(<KnowledgePageTree space={{...space,id:"other"}} working={false} refresh={0} onOpen={onOpen}/>);await screen.findByRole("button",{name:"其他空间目录"});
    await act(async()=>release({rows:[row("旧空间迟到目录")] as never,total:101,page:2,pageSize:100}));await waitFor(()=>expect(screen.queryByRole("button",{name:"旧空间迟到目录"})).toBeNull());
  });
  it("failed root loads have an explicit retry",async()=>{
    vi.mocked(api).mockRejectedValueOnce(new Error("目录加载失败")).mockResolvedValueOnce({rows:[row("已恢复目录")],total:1} as never);
    render(<KnowledgePageTree space={space} working={false} refresh={0} onOpen={vi.fn()}/>);await screen.findByText("目录加载失败");fireEvent.click(screen.getByRole("button",{name:/重\s*试/}));await screen.findByRole("button",{name:"已恢复目录"});
  });
  it("catches paginated failures and prevents duplicate load-more requests",async()=>{
    let reject!:(error:Error)=>void;const pending=new Promise<never>((_resolve,rejectPromise)=>{reject=rejectPromise;});
    vi.mocked(api).mockResolvedValueOnce({rows:[row("正式目录")],total:101} as never).mockImplementationOnce(()=>pending);
    render(<KnowledgePageTree space={space} working={false} refresh={0} onOpen={vi.fn()}/>);
    const more=await screen.findByRole("button",{name:"加载更多"});fireEvent.click(more);fireEvent.click(more);expect(api).toHaveBeenCalledTimes(2);
    await act(async()=>reject(new Error("更多目录加载失败")));await screen.findByText("更多目录加载失败");expect(screen.getByRole("button",{name:/重\s*试/})).toBeInTheDocument();
  });
});
