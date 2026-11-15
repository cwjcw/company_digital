import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mpsDivisionOrderProgressColumns, mpsDivisionOrderProgressFieldKeys, mpsDivisionOrderProgressResource } from "@kdos/contracts";
import { MasterPlanDivisionOrderProgress } from "./MasterPlanDivisionOrderProgress";

const {apiMock,downloadMock}=vi.hoisted(()=>({apiMock:vi.fn(),downloadMock:vi.fn()}));
vi.mock("../../api",()=>({api:apiMock}));
vi.mock("../../shared/legacy-ui",()=>({downloadApiFile:downloadMock}));
vi.mock("../../shared/KdosDataTable",()=>({
  hasSessionResourcePermission:(user:Record<string,unknown>,resource:string,action:string)=>Array.isArray(user.permissions)&&user.permissions.some((p:string)=>p==="*"||p===`${resource}:*:${action}`),
  KdosDataTable:({columns,dataSource}:{columns:Array<{key:string;title:string;fixed?:string|boolean;sorter?:boolean;render:(value:unknown,row:Record<string,unknown>)=>unknown}>;dataSource:Array<Record<string,unknown>>})=><table><thead><tr>{columns.map(c=><th key={c.key} data-fixed={String(c.fixed??false)} data-sorter={String(c.sorter??false)}>{c.title}</th>)}</tr></thead><tbody>{dataSource.map((row,i)=><tr key={i}>{columns.map(c=><td key={c.key}>{c.render(row[c.key],row) as never}</td>)}</tr>)}</tbody></table>
}));

const row={id:"synthetic",customerCode:"0001",orderNumber:"0000123",itemCode:"0000456",itemName:"合成品项",orderDate:"2026-10-01",expectedShippingDate:"2026-12-01",orderQuantity:"1200.0000",reviewDueDate:"2026-11-01",drawing:"Y",materialReady:"N",cutting:"N",weldingQuantity:"1199.9600",blankQuantity:"800.0000",surfaceTreatmentQuantity:"1250.0000",packagingQuantity:"0",inboundQuantity:"0",bomStatus:"HAS_BOM",inboundVerified:true,weldingComplete:false,blankComplete:false,surfaceTreatmentComplete:true,packagingComplete:false,inboundComplete:false,materialReadyHint:"齐套数据源暂未接入",cuttingHint:"下料状态数据源暂未接入"};
const mount=()=>{const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><MasterPlanDivisionOrderProgress/></QueryClientProvider>)};
beforeEach(()=>{cleanup();vi.clearAllMocks();localStorage.setItem("sessionUser",JSON.stringify({permissions:[`${mpsDivisionOrderProgressResource}:*:read`,`${mpsDivisionOrderProgressResource}:*:export`]}));apiMock.mockImplementation(async(url:string)=>url.endsWith("/meta")?{columns:mpsDivisionOrderProgressColumns,canExport:true}:{rows:[row],total:1,page:1,pageSize:100,diagnostics:{basePlanUnlinked:0,baseDueDateMissing:0,processUnlinked:0,inboundUnverified:0,bomUnverified:false}})});

describe("MasterPlanDivisionOrderProgress",()=>{
  it("renders all 16 fields, fixed textual business identifiers and source-aware status colors",async()=>{
    mount();
    for(const [,label] of mpsDivisionOrderProgressColumns)await screen.findByText(label,{selector:"th"});
    expect(document.querySelectorAll(`th[data-fixed="left"]`)).toHaveLength(4);
    expect(screen.getByText("图纸",{selector:"th"})).toHaveAttribute("data-sorter","false");
    expect(await screen.findByText("0000123")).toBeInTheDocument();expect(screen.getByText("0000456")).toBeInTheDocument();
    expect(screen.getByText("Y")).toHaveClass("ant-tag-green");expect(screen.getAllByText("N").length).toBeGreaterThanOrEqual(2);
    for(const welding of screen.getAllByText("1,200.0"))expect(welding).not.toHaveClass("is-complete");
    expect(screen.getByText("1,250.0")).toHaveClass("is-complete");
    expect(mpsDivisionOrderProgressFieldKeys).toHaveLength(16);
  });
  it("does not call the report API without the new read permission",()=>{
    localStorage.setItem("sessionUser",JSON.stringify({permissions:["mps-overview-dashboard:*:read"]}));mount();
    expect(screen.getByText("没有事业部订单生产进度报表查看权限")).toBeInTheDocument();expect(apiMock).not.toHaveBeenCalled();
  });
});
