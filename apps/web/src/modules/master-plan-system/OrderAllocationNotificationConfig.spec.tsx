import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderAllocationNotificationConfig } from "./OrderAllocationNotificationConfig";
import { api } from "../../api";
vi.mock("../../api",()=>({api:vi.fn()}));
vi.mock("../../shared/KdosDataTable",()=>({KdosDataTable:({dataSource,columns}:any)=><div>{dataSource.map((row:any)=><div key={row.id}>{columns.map((c:any,i:number)=><span key={i}>{c.render?c.render(row[c.dataIndex],row):String(row[c.dataIndex]??"")}</span>)}</div>)}</div>}));
const units=["事业一部","事业二部","事业三部","事业四部","采购部"];
const configuration={unitOptions:[...units,"仓储部"].map((name,i)=>({id:`d${i}`,name,pathLabel:`凯南 / ${name}`})),issues:[],vendors:units.map((name,i)=>({id:`v${i}`,supplier_name:i===4?"供应链":name,division_id:`d${i}`,divisionName:name,enabled:true,version:1})),recipients:units.map((name,i)=>({id:`r${i}`,division_id:`d${i}`,divisionName:name,user_ids:[],enabled:true,version:1})),rule:{id:"rule",enabled:false,version:3},users:[{id:"test",displayName:"测试人员",employeeNo:"00001",username:"00001",enabled:true,hasWechatId:true}],complete:false};
afterEach(cleanup);
beforeEach(()=>{vi.mocked(api).mockReset();vi.mocked(api).mockImplementation(async()=>configuration as never);});
const mount=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><OrderAllocationNotificationConfig/></QueryClientProvider>);
describe("allocation notification configuration",()=>{
 it("renders business-specific tabs, one official switch and missing recipient notice",async()=>{mount();await screen.findAllByText("采购部");expect(screen.getByRole("tab",{name:"通知接收人对应表"})).toBeVisible();expect(screen.getByText("已停用")).toBeVisible();expect(screen.getByRole("switch")).not.toBeChecked();expect(screen.getByText(/请为已配置的承接单位配置有效接收人员/)).toBeVisible();expect(screen.getAllByText("采购部")[0]).toBeVisible();expect(screen.getByRole("button",{name:"发送文本和Excel测试"})).toBeDisabled();});
 it("uses the canonical rule version to toggle and keeps business config separate",async()=>{mount();await screen.findAllByText("采购部");fireEvent.click(screen.getByRole("switch"));await waitFor(()=>expect(api).toHaveBeenCalledWith("/master-plan-system/order-allocation-notification-config/rule",expect.objectContaining({method:"POST",body:JSON.stringify({enabled:true,expectedVersion:3})})));});
 it("opens employee multi-select under the recipient tab with five units",async()=>{mount();await screen.findAllByText("采购部");fireEvent.click(screen.getByRole("tab",{name:"通知接收人对应表"}));await waitFor(()=>expect(screen.getAllByText("未配置")).toHaveLength(5));fireEvent.click(within(screen.getByRole("tabpanel",{name:"通知接收人对应表"})).getAllByRole("button",{name:/编\s*辑/})[0]!);await screen.findByText("通知接收人员");await waitFor(()=>expect(screen.getByText("企业微信接收人员")).toBeVisible());});
 it("shows a disabled mapping reason and opens its versioned repair form",async()=>{
   vi.mocked(api).mockResolvedValue({...configuration,issues:[{code:"DISABLED_MAPPING",supplierName:"供应链",mappingId:"v4",message:"映射已停用，请核实后启用"}]} as never);
   mount();await screen.findByText("供应商映射配置异常");expect(screen.getByText(/供应链：映射已停用/)).toBeVisible();
   fireEvent.click(screen.getByRole("button",{name:"修复映射"}));const dialog=await screen.findByRole("dialog");await waitFor(()=>expect(within(dialog).getByDisplayValue("供应链")).toBeVisible());
 });
 it("allows selecting an enabled organization outside the five default units",async()=>{
   mount();await screen.findAllByText("采购部");fireEvent.click(screen.getByRole("button",{name:"新增映射"}));
   const dialog=await screen.findByRole("dialog");fireEvent.mouseDown(within(dialog).getByRole("combobox"));expect((await screen.findAllByText("凯南 / 仓储部")).length).toBeGreaterThan(0);
 });
 it("shows a missing mapping and prefills its supplier without creating an organization",async()=>{
   vi.mocked(api).mockResolvedValue({...configuration,issues:[{code:"MISSING_MAPPING",supplierName:"供应链",message:"缺少映射：采购部存在重名"}]} as never);
   mount();await screen.findByText(/供应链：缺少映射/);fireEvent.click(screen.getByRole("button",{name:"修复映射"}));const dialog=await screen.findByRole("dialog");await waitFor(()=>expect(within(dialog).getByDisplayValue("供应链")).toBeVisible());expect(api).not.toHaveBeenCalledWith(expect.anything(),expect.objectContaining({method:"POST"}));
 });

 it("shows an invalid organization by name and lets administrators replace it",async()=>{
   vi.mocked(api).mockResolvedValue({...configuration,unitOptions:configuration.unitOptions.filter(u=>u.id!=="d4"),vendors:configuration.vendors.map(v=>v.id==="v4"?{...v,unitEnabled:false}:v),issues:[{code:"INVALID_ORGANIZATION",supplierName:"供应链",mappingId:"v4",message:"承接组织不存在或已停用"}]} as never);
   mount();await screen.findByText("承接组织无效");fireEvent.click(screen.getByRole("button",{name:"修复映射"}));await waitFor(()=>expect(screen.getByText("采购部（无效）")).toBeVisible());
 });

});
