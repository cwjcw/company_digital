import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { api } from "../../api";
import { downloadApiFile } from "../../shared/legacy-ui";
import { MpsDashboardDetailTable } from "./MasterPlanDashboardTable";
vi.mock("../../api",()=>({api:vi.fn()}));
vi.mock("../../shared/legacy-ui",()=>({downloadApiFile:vi.fn().mockResolvedValue(undefined)}));
vi.mock("../../shared/KdosDataTable",()=>({ kdosDefaultPageSize:100, KdosDataTable:({viewKey,serverData}:any)=><button aria-label={`${viewKey}第3页排序`} onClick={()=>serverData.onQueryChange({page:3,pageSize:50,sortField:"orderNumber",sortOrder:"desc"})}>第3页</button> }));
const keys=["plan-readiness","process-execution","risk-exception"] as const;
const titles=["计划待完善明细","工序执行明细","风险与异常"];
const filters={customerCode:"C-1",orderNumbers:["SO-1"],dateType:"ORDER" as const,datePeriod:"MONTH" as const,dateValue:"2026-10"};
let client:QueryClient;
beforeEach(()=>{vi.clearAllMocks();vi.mocked(api).mockResolvedValue({rows:[],total:300,page:1,pageSize:100,visibleFields:tablePermissionFieldsFor("mps-overview-dashboard").map(f=>f.key)} as never);});
afterEach(()=>{cleanup();client?.clear();});
function mount(){client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}>{keys.map(tableKey=><MpsDashboardDetailTable key={tableKey} tableKey={tableKey} filters={filters} session="ordinary-dashboard-session" canExport/>)}</QueryClientProvider>);}
const urls=()=>vi.mocked(api).mock.calls.map(([url])=>new URL(url,"http://fixture"));
const latest=(key:string)=>urls().filter(url=>url.pathname.endsWith('/'+key)).at(-1)!;
describe("REV2 independent standard reports",()=>{
  it("sends three independent requests and changing one pagination/sort leaves the other two at page1",async()=>{
    mount();await waitFor(()=>expect(api).toHaveBeenCalledTimes(3));
    for(const key of keys){expect(latest(key).searchParams.get("page")).toBe("1");expect(latest(key).searchParams.get("pageSize")).toBe("100");}
    fireEvent.click(screen.getByRole("button",{name:"plan-readiness第3页排序"}));
    await waitFor(()=>expect(latest("plan-readiness").searchParams.get("page")).toBe("3"));
    expect(latest("plan-readiness").searchParams.get("sortField")).toBe("orderNumber");
    for(const key of keys.slice(1)){expect(latest(key).searchParams.get("page")).toBe("1");expect(latest(key).searchParams.has("sortField")).toBe(false);}
  });
  it("local search/process/status/risk filters are independent and each export inherits only its own filters plus top scope",async()=>{
    mount();await waitFor(()=>expect(api).toHaveBeenCalledTimes(3));
    const input=await screen.findByRole("searchbox",{name:"计划待完善明细搜索"});fireEvent.change(input,{target:{value:"准备关键词"}});fireEvent.keyDown(input,{key:"Enter",code:"Enter"});
    await waitFor(()=>expect(latest("plan-readiness").searchParams.get("search")).toBe("准备关键词"));
    fireEvent.mouseDown(screen.getByRole("combobox",{name:"工序执行明细工序"}));fireEvent.click(await screen.findByText("下料",{selector:".ant-select-item-option-content"}));
    fireEvent.click(screen.getByRole("checkbox",{name:"只看未完成"}));
    await waitFor(()=>expect(latest("process-execution").searchParams.get("onlyIncomplete")).toBe("true"));
    expect(latest("process-execution").searchParams.get("processCode")).toBe("cutting");
    fireEvent.mouseDown(screen.getByRole("combobox",{name:"风险类型"}));fireEvent.click(await screen.findByText("生产异常",{selector:".ant-select-item-option-content"}));
    await waitFor(()=>expect(latest("risk-exception").searchParams.get("riskType")).toBe("生产异常"));
    for(const title of titles)fireEvent.click(within(screen.getByText(title,{selector:".ant-card-head-title"}).closest('.ant-card')!).getByRole("button",{name:"导出"}));
    await waitFor(()=>expect(downloadApiFile).toHaveBeenCalledTimes(3));
    const exported=vi.mocked(downloadApiFile).mock.calls.map(([url])=>new URL(url,"http://fixture"));
    for(const url of exported){expect(url.searchParams.get("customerCode")).toBe("C-1");expect(url.searchParams.get("orderNumbers")).toBe('["SO-1"]');expect(url.searchParams.get("dateType")).toBe("ORDER");}
    const ready=exported.find(u=>u.searchParams.get("tableKey")==="plan-readiness")!,process=exported.find(u=>u.searchParams.get("tableKey")==="process-execution")!,risk=exported.find(u=>u.searchParams.get("tableKey")==="risk-exception")!;
    expect(ready.searchParams.get("search")).toBe("准备关键词");expect(ready.searchParams.has("processCode")).toBe(false);expect(ready.searchParams.has("riskType")).toBe(false);
    expect(process.searchParams.get("processCode")).toBe("cutting");expect(process.searchParams.get("onlyIncomplete")).toBe("true");expect(process.searchParams.has("search")).toBe(false);expect(process.searchParams.has("riskType")).toBe(false);
    expect(risk.searchParams.get("riskType")).toBe("生产异常");expect(risk.searchParams.has("processCode")).toBe(false);expect(risk.searchParams.has("search")).toBe(false);
  });
});
