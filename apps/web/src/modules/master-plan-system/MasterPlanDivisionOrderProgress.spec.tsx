import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mpsDivisionOrderProgressColumns, mpsDivisionOrderProgressFieldKeys, mpsDivisionOrderProgressResource } from "@kdos/contracts";
import { MasterPlanDivisionOrderProgress } from "./MasterPlanDivisionOrderProgress";

const {apiMock,downloadMock}=vi.hoisted(()=>({apiMock:vi.fn(),downloadMock:vi.fn()}));
vi.mock("../../api",()=>({api:apiMock}));
vi.mock("../../shared/legacy-ui",()=>({downloadApiFile:downloadMock}));
vi.mock("../../shared/KdosDataTable",()=>({
  hasSessionResourcePermission:(user:Record<string,unknown>,resource:string,action:string)=>Array.isArray(user.permissions)&&user.permissions.some((p:string)=>p==="*"||p===`${resource}:*:${action}`),
  kdosDefaultPageSize:100,
  KdosDataTable:({columns,dataSource,simple,advancedFilterFields,initialSort,serverData,className}:{columns:Array<{key:string;title:string;fixed?:string|boolean;sorter?:boolean;align?:string;render:(value:unknown,row:Record<string,unknown>)=>unknown}>;dataSource:Array<Record<string,unknown>>;simple?:boolean;advancedFilterFields?:Array<{key:string}>;initialSort?:{field:string;order:string};serverData:{onQueryChange:(query:Record<string,unknown>)=>void};className?:string})=><><div data-testid="table-mode" data-simple={String(Boolean(simple))} data-filter-fields={advancedFilterFields?.map(field=>field.key).join(",")} data-initial-sort={`${initialSort?.field}:${initialSort?.order}`} data-class-name={className}/>{!simple&&<><button onClick={()=>serverData.onQueryChange({page:1,pageSize:100,search:"",filters:{},filterGroup:{logic:"AND",rules:[{field:"orderQuantity",operator:"gte",value:"1000"}]}})}>模拟应用高级查询</button><button onClick={()=>serverData.onQueryChange({page:1,pageSize:100,search:"",filterGroup:{logic:"AND",rules:[{field:"productionStatus",operator:"eq",value:"已完成"}]}})}>模拟筛选已完成</button></>}<table><thead><tr>{columns.map(c=><th key={c.key} data-fixed={String(c.fixed??false)} data-sorter={String(c.sorter??false)} data-align={c.align??""}>{c.title}</th>)}</tr></thead><tbody>{dataSource.map((row,i)=><tr key={i}>{columns.map(c=><td key={c.key} data-align={c.align??""}>{c.render(row[c.key],row) as never}</td>)}</tr>)}</tbody></table></>
}));

const row={id:"synthetic",customerCode:"0001",orderNumber:"0000123",itemCode:"0000456",itemName:"合成品项",orderDate:"2026-10-01",expectedShippingDate:"2026-12-01",orderQuantity:"1200.0000",reviewDueDate:"2026-11-01",drawing:"Y",materialReady:"N",cutting:"N",weldingQuantity:"1199.9600",blankQuantity:"800.0000",surfaceTreatmentQuantity:"1250.0000",packagingQuantity:"0",inboundQuantity:"0",productionStatus:"未完成",bomStatus:"HAS_BOM",inboundVerified:true,weldingComplete:false,blankComplete:false,surfaceTreatmentComplete:true,packagingComplete:false,inboundComplete:false,materialReadyHint:"齐套数据源暂未接入",cuttingHint:"下料状态数据源暂未接入"};
const mount=()=>{const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><MasterPlanDivisionOrderProgress/></QueryClientProvider>)};
beforeEach(()=>{cleanup();vi.clearAllMocks();localStorage.setItem("sessionUser",JSON.stringify({permissions:[`${mpsDivisionOrderProgressResource}:*:read`,`${mpsDivisionOrderProgressResource}:*:export`]}));apiMock.mockImplementation(async(url:string)=>url.endsWith("/meta")?{columns:mpsDivisionOrderProgressColumns,canExport:true}:{rows:[row],total:1,page:1,pageSize:100,diagnostics:{basePlanUnlinked:0,baseDueDateMissing:0,processUnlinked:0,inboundUnverified:0}})});

describe("MasterPlanDivisionOrderProgress",()=>{
  it("renders all 17 fields, fixed textual business identifiers and source-aware status colors",async()=>{
    mount();
    for(const [,label] of mpsDivisionOrderProgressColumns)await screen.findByText(label,{selector:"th"});
    expect(document.querySelectorAll(`th[data-fixed="left"]`)).toHaveLength(4);
    expect(screen.getByText("图纸",{selector:"th"})).toHaveAttribute("data-sorter","false");
    expect(screen.getByTestId("table-mode")).toHaveAttribute("data-simple","false");
    expect(screen.getByTestId("table-mode")).toHaveAttribute("data-initial-sort","orderDate:desc");
    expect(screen.getByTestId("table-mode")).toHaveAttribute("data-class-name","mps-division-order-progress-table");
    expect(screen.getByText("生产状态",{selector:"th"})).toBeInTheDocument();
    expect(screen.getByText("未完成",{selector:"tbody td"})).toBeInTheDocument();
    expect([...document.querySelectorAll("thead th, tbody td")].every(cell=>cell.getAttribute("data-align")==="center")).toBe(true);
    expect(screen.getByTestId("table-mode").getAttribute("data-filter-fields")).toContain("orderQuantity");
    expect(screen.queryByText(/事业四部有效订单品项/)).not.toBeInTheDocument();
    expect(await screen.findByText("0000123")).toBeInTheDocument();expect(screen.getByText("0000456")).toBeInTheDocument();
    expect(screen.getByText("Y")).toHaveClass("ant-tag-green");expect(screen.getAllByText("N").length).toBeGreaterThanOrEqual(2);
    for(const welding of screen.getAllByText("1,200.0"))expect(welding).not.toHaveClass("is-complete");
    expect(screen.getByText("1,250.0")).toHaveClass("is-complete");
    expect(mpsDivisionOrderProgressFieldKeys).toHaveLength(17);
    expect(screen.queryByText("事业四部订单生产进度")).not.toBeInTheDocument();
  });
  it("does not call the report API without the new read permission",()=>{
    localStorage.setItem("sessionUser",JSON.stringify({permissions:["mps-overview-dashboard:*:read"]}));mount();
    expect(screen.getByText("没有事业部订单生产进度报表查看权限")).toBeInTheDocument();expect(apiMock).not.toHaveBeenCalled();
  });
  it("renders unavailable BOM results as N with no third page state",async()=>{
    apiMock.mockImplementation(async(url:string)=>url.endsWith("/meta")?{columns:mpsDivisionOrderProgressColumns,canExport:true}:{rows:[{...row,drawing:"N",bomStatus:"NO_BOM"}],total:1,page:1,pageSize:100,diagnostics:{basePlanUnlinked:0,baseDueDateMissing:0,processUnlinked:0,inboundUnverified:0}});
    mount();
    const cell=await screen.findByText("N",{selector:"tbody tr td"});
    expect(cell).toBeInTheDocument();expect(screen.queryByText("未核验")).not.toBeInTheDocument();
  });
  it("uses the earliest date value and never renders the legacy multi-date label",async()=>{
    apiMock.mockImplementation(async(url:string)=>url.endsWith("/meta")?{columns:mpsDivisionOrderProgressColumns,canExport:true}:{rows:[{...row,orderDate:"2026-11-03",expectedShippingDate:"2026-11-05"}],total:1,page:1,pageSize:100,diagnostics:{basePlanUnlinked:0,baseDueDateMissing:0,processUnlinked:0,inboundUnverified:0}});
    mount();
    expect(await screen.findByText("2026-11-03")).toBeInTheDocument();
    expect(screen.getByText("2026-11-05")).toBeInTheDocument();
    expect(screen.queryByText("多日期")).not.toBeInTheDocument();
    await waitFor(()=>expect(apiMock.mock.calls.some(([url])=>String(url).includes("division-order-progress/fourth?")&&new URLSearchParams(String(url).split("?")[1]).get("sortField")==="orderDate"&&new URLSearchParams(String(url).split("?")[1]).get("sortOrder")==="desc")).toBe(true));
  });
  it("sends advanced query conditions to the real report request",async()=>{
    mount();
    fireEvent.click(await screen.findByRole("button",{name:"模拟应用高级查询"}));
    await waitFor(()=>expect(apiMock.mock.calls.some(([url])=>{
      if(!String(url).includes("division-order-progress/fourth?"))return false;
      const params=new URL("http://test"+String(url)).searchParams;
      return JSON.parse(params.get("filterGroup")??"null")?.rules?.[0]?.field==="orderQuantity";
    })).toBe(true));
  });
  it("includes production status in advanced filters and sends it to the actual report query",async()=>{
    mount();
    expect(screen.getByTestId("table-mode").getAttribute("data-filter-fields")).toContain("productionStatus");
    fireEvent.click(await screen.findByRole("button",{name:"模拟筛选已完成"}));
    await waitFor(()=>expect(apiMock.mock.calls.some(([url])=>{
      if(!String(url).includes("division-order-progress/fourth?"))return false;
      const filter=JSON.parse(new URL("http://test"+String(url)).searchParams.get("filterGroup")??"null");
      return filter?.rules?.[0]?.field==="productionStatus"&&filter.rules[0].value==="已完成";
    })).toBe(true));
  });
});
