import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tablePermissionFieldsFor, mpsOrderProgressResource as resource } from "@kdos/contracts";
import { api } from "../../api";
import { downloadApiFile } from "../../shared/legacy-ui";
import { MasterPlanOrderProgress, ProcessCell } from "./MasterPlanOrderProgress";
vi.mock("../../api",()=>({api:vi.fn()}));vi.mock("../../shared/legacy-ui",()=>({downloadApiFile:vi.fn().mockResolvedValue(undefined)}));
const fields=tablePermissionFieldsFor(resource).map(f=>f.key),order={id:"0199bb00-0000-7000-8000-000000000010",orderNumber:"ORDER-A",divisionName:"事业甲",orderProductionProgress:".75",orderProgressBasis:"有效工序＋入库",orderCompletionRate:"0.1234",unfinishedItemCount:3};
const item={id:"0199bb00-0000-7000-8000-000000000020",orderId:order.id,itemCode:"ITEM-A",itemName:"测试品项",itemProductionProgress:".5866667",itemProgressBasis:"下料、包装＋入库",sourceKind:"月计划",requiredQuantity:"500",dispatchedWeeklyQuantity:"300",cuttingReportedQuantity:"255",cuttingProductionProgress:"0.51",cuttingStatus:"已完成",packagingReportedQuantity:"525",packagingProductionProgress:"1.05",packagingStatus:"延期",woodStatus:null};
let client:QueryClient,canExport=true,denied=false;
const urls=()=>vi.mocked(api).mock.calls.map(([u])=>new URL(u,"http://fixture"));
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();localStorage.setItem('sessionUser',JSON.stringify({sub:"fixture-user",permissions:["*"]}));canExport=true;denied=false;
  vi.mocked(api).mockImplementation(async(u:string)=>{const url=new URL(u,"http://fixture");if(url.pathname.endsWith('/meta'))return {visibleFields:fields,canExport}as never;
    if(url.pathname.endsWith('/orders')){if(denied)throw new Error('读取失败');return {rows:[order],total:1,page:1,pageSize:100,visibleFields:fields}as never;}
    if(url.pathname.endsWith('/items'))return {rows:[item],total:1,page:1,pageSize:100,visibleFields:fields}as never;
    if(url.pathname.includes('/detail/'))return {rows:[{id:"fixture-weekly",deliveryNumber:"001",plannedQuantity:200}],total:1,page:1,pageSize:100,visibleFields:["deliveryNumber","plannedQuantity"]}as never;
    return {options:[],hasMore:false}as never;});});
afterEach(()=>{cleanup();client?.clear()});
function mount(){client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><MasterPlanOrderProgress/></QueryClientProvider>)}
describe("In-production order progress",()=>{
  it("defaults to unfinished, loads only orders first and preserves formal rate; expansion is lazy and collapsible",async()=>{
    const {container}=mount();await screen.findByText('ORDER-A');expect(screen.getByText('12.3%')).toBeInTheDocument();expect(screen.getByText('75%')).toBeInTheDocument();expect(urls().some(u=>u.pathname.endsWith('/items'))).toBe(false);
    const initial=urls().find(u=>u.pathname.endsWith('/orders'))!;expect(initial.searchParams.get('onlyUnfinishedOrders')).toBe('true');expect(initial.searchParams.get('onlyUnfinishedItems')).toBe('true');expect(initial.searchParams.get('pageSize')).toBe('100');
    fireEvent.click(container.querySelector('button.ant-table-row-expand-icon')!);await screen.findByRole('button',{name:'ITEM-A'});expect(screen.getByText('51%')).toBeInTheDocument();expect(screen.getByText('58.7%')).toBeInTheDocument();expect(screen.getByText('105%')).toBeInTheDocument();expect(screen.getAllByText('无记录').length).toBeGreaterThan(0);
    fireEvent.click(container.querySelector('button.ant-table-row-expand-icon')!);expect(container.querySelector('button.ant-table-row-expand-icon')).toHaveAttribute('aria-expanded','false');
  });
  it("expanded table exports its own order while the top item export keeps the complete scope",async()=>{
    const {container}=mount();await screen.findByText('ORDER-A');fireEvent.click(container.querySelector('button.ant-table-row-expand-icon')!);await screen.findByRole('button',{name:'ITEM-A'});
    fireEvent.click(screen.getByRole('button',{name:'导出本订单品号'}));fireEvent.click(screen.getByRole('button',{name:'导出品号生产进度明细'}));await waitFor(()=>expect(downloadApiFile).toHaveBeenCalledTimes(2));
    const calls=vi.mocked(downloadApiFile).mock.calls.map(([u])=>new URL(u,"http://fixture"));expect(calls[0]!.searchParams.get('orderNumbers')).toBe('["ORDER-A"]');expect(calls[1]!.searchParams.has('orderNumbers')).toBe(false);
  });
  it("opens permission-checked detail with exact stable IDs and retains batch labels",async()=>{
    const {container}=mount();await screen.findByText('ORDER-A');fireEvent.click(container.querySelector('button.ant-table-row-expand-icon')!);fireEvent.click(await screen.findByRole('button',{name:'ITEM-A'}));
    await screen.findByText('001');const detail=urls().find(u=>u.pathname.includes('/detail/'))!;expect(detail.searchParams.get('orderId')).toBe(order.id);expect(detail.searchParams.get('itemId')).toBe(item.id);expect(detail.searchParams.get('onlyUnfinishedOrders')).toBe('true');
  });
  it("two exports are independent, inherit unfinished and date filters and never depend on expansion",async()=>{
    mount();await screen.findByText('ORDER-A');fireEvent.click(screen.getByRole('button',{name:'导出订单进度汇总'}));fireEvent.click(screen.getByRole('button',{name:'导出品号生产进度明细'}));
    await waitFor(()=>expect(downloadApiFile).toHaveBeenCalledTimes(2));const calls=vi.mocked(downloadApiFile).mock.calls.map(([u])=>new URL(u,"http://fixture"));expect(calls.map(u=>u.pathname.split('/').at(-1))).toEqual(['orders','items']);for(const u of calls){expect(u.searchParams.get('onlyUnfinishedOrders')).toBe('true');expect(u.searchParams.get('dateType')).toBe('ORDER');expect(u.searchParams.has('itemId')).toBe(false);expect(u.searchParams.has('orderId')).toBe(false);}
  });
  it("no export hides all export entries; no new read cannot borrow old overview",async()=>{
    canExport=false;mount();await screen.findByText('ORDER-A');expect(screen.queryByRole('button',{name:'导出订单进度汇总'})).not.toBeInTheDocument();cleanup();client.clear();vi.mocked(api).mockClear();localStorage.setItem('sessionUser',JSON.stringify({permissions:['mps-overview-dashboard:*:read']}));mount();expect(screen.getByText('没有在制订单进度看板权限')).toBeInTheDocument();expect(api).not.toHaveBeenCalled();
  });
  it("unfinished toggles refresh server queries, preserve date context and reset expansion",async()=>{
    const {container}=mount();await screen.findByText('ORDER-A');fireEvent.click(container.querySelector('button.ant-table-row-expand-icon')!);await screen.findByRole('button',{name:'ITEM-A'});
    fireEvent.click(screen.getByRole('checkbox',{name:'只看未完成品号'}));await waitFor(()=>expect(urls().filter(u=>u.pathname.endsWith('/orders')).at(-1)?.searchParams.get('onlyUnfinishedItems')).toBe('false'));await waitFor(()=>expect(container.querySelector('button.ant-table-row-expand-icon')).toHaveAttribute('aria-expanded','false'));
    fireEvent.click(screen.getByRole('checkbox',{name:'只看未完成订单'}));await waitFor(()=>expect(urls().filter(u=>u.pathname.endsWith('/orders')).at(-1)?.searchParams.get('onlyUnfinishedOrders')).toBe('false'));
  });
  it("exposes query failures without manufacturing zero-complete data",async()=>{denied=true;mount();expect(await screen.findByText('读取失败')).toBeInTheDocument();expect(screen.queryByText('100%')).not.toBeInTheDocument()});
  it("process status and quantity progress are independent; absent evidence never claims not applicable",()=>{
    const {container}=render(<ProcessCell row={{id:'fixture',cuttingProductionProgress:"1.05",cuttingStatus:"延期",cuttingReportedQuantity:"525"}} code="cutting" fields={fields}/>);expect(within(container).getByText('105%')).toBeInTheDocument();expect(within(container).getByText('延期')).toBeInTheDocument();expect(container.textContent).not.toContain('不适用');
  });
});
