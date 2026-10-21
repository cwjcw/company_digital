import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {api} from '../../api';
import {FinanceOrderTable,FinanceOrderDashboard} from './FinanceOrders';
import {useEffect} from 'react';
vi.mock('../../api',async original=>({...await original<object>(),api:vi.fn()}));
vi.mock('../../shared/charts/KdosChart',()=>({KdosChart:({ariaLabel,onDataClick,option}:any)=><button onClick={()=>onDataClick?.({name:'国内',dataIndex:0})}>{ariaLabel}{option?.xAxis?.data?.map((month:string)=><span key={month}>{month}</span>)}</button>}));
vi.mock('../../shared/KdosDataTable',async original=>({...await original<object>(),KdosDataTable:({columns,toolbar,contextFilterGroup,dataSource,serverData}:any)=>{const onQueryChange=serverData?.onQueryChange;useEffect(()=>{onQueryChange?.({page:1,pageSize:100,search:'',filters:{},filterGroup:{logic:'AND',rules:[]}});},[onQueryChange]);return <div data-testid="record-table">{columns.map((c:any)=><span key={c.dataIndex}>{c.title}</span>)}{dataSource?.map((r:any)=><div key={r.id}>{columns.map((c:any)=><span key={c.dataIndex}>{c.render?.(r[c.dataIndex],r)}</span>)}</div>)}{toolbar}<pre>{JSON.stringify(contextFilterGroup)}</pre></div>;}}));
function mount(component:React.ReactNode,url='/finance/orders/monthly',user:any={permissions:['*']}){localStorage.setItem('sessionUser',JSON.stringify(user));return render(<MemoryRouter initialEntries={[url]}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}>{component}</QueryClientProvider></MemoryRouter>);}
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();vi.mocked(api).mockImplementation(async p=>p.endsWith('/revision')?{revision:'synthetic-v1'} as never:p.includes('dashboard')?{totals:{orders:2,amount:'100.30',average:'50.15',pendingAmount:'0.00',pendingOrders:0,pendingCustomers:0},channels:[{category:'内销',amount:'100.30',share:'1'}],departments:[{category:'业务一部',amount:'100.30',share:'1'}],months:Array.from({length:12},(_,i)=>({month:`2025-${String(i+1).padStart(2,'0')}`,amount:i?'0.00':'100.30',wan:i?'0.000000':'0.010030'})),matrix:[],quality:{excludedOrders:1,excludedAmount:'3.00'}} as never:{rows:[],total:0,canInspectExceptions:true} as never);});
afterEach(cleanup);
describe('Finance E10 UI',()=>{
 it('shows earliest order dates without adding a template column and preserves dashboard money',async()=>{
  const original=vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async(p,...args)=>{
   if(p.includes('/table-filters/rows'))return {rows:[{id:'conflict',deliveryDate:'2025-02-01',deliveryDateConflict:true,orderTotal:'100.30'}],total:1} as never;
   const result:any=await original(p,...args);if(p.includes('dashboard'))result.totals.deliveryDateConflicts=1;return result;
  });
  const view=mount(<FinanceOrderTable monthly/>);await screen.findByText('2025-02-01');expect(screen.queryByText('预交货日冲突')).toBeNull();expect(screen.getByText('100.30')).toBeVisible();expect(screen.getByTestId('record-table').querySelectorAll(':scope > span')).toHaveLength(15);view.unmount();
  mount(<FinanceOrderDashboard/>);await screen.findByText('期间累计接单发生额');expect(screen.queryByText(/(?:多个预交货日|预交货日冲突)\s*\d+\s*张/)).toBeNull();
 });
 it('shows exactly 34 Chinese source columns and no upload control',async()=>{mount(<FinanceOrderTable/>);await screen.findByText('本币合计金额');expect(screen.getByTestId('record-table').querySelectorAll(':scope > span')).toHaveLength(34);expect(screen.queryByText('导入')).toBeNull();expect(screen.getByText('刷新E10数据')).toBeVisible();});
 it('monthly has exactly fifteen columns and propagates complete drilldown filters',async()=>{mount(<FinanceOrderTable monthly/>,'/finance/orders/monthly?year=2025&month=2&salesperson=测试&customerCode=A140-2&salesChannel=待分类');await screen.findByText('本月发生额');expect(screen.getByTestId('record-table').querySelectorAll(':scope > span')).toHaveLength(15);const call=vi.mocked(api).mock.calls.find(([p])=>p.includes('/table-filters/rows'))![0];const group=JSON.parse(new URLSearchParams(call.split('?')[1]).get('filterGroup')!);expect(JSON.parse(new URLSearchParams(call.split('?')[1]).get('context')!)).toEqual({monthFrom:'2025-02',monthTo:'2025-02'});expect(JSON.stringify(group)).toContain('contains_any');expect(JSON.stringify(group)).toContain('A140-2');expect(JSON.stringify(group)).toContain('is_empty');});
 it('does not request data for unauthorized users',()=>{mount(<FinanceOrderTable/>,undefined,{permissions:[],moduleAdminCodes:['planning']});expect(screen.getByText('当前权限组不能查看销售订单数据')).toBeVisible();expect(api).not.toHaveBeenCalled();});
 it('renders original dashboard headers and all twelve months without the excluded-money banner',async()=>{mount(<FinanceOrderDashboard/>);await screen.findByText('期间累计接单发生额');expect(screen.queryByText(/待复核订单.*暂未纳入统计/)).toBeNull();for(const label of ['分类','接单发生额/本币含税','期间占比','期间合计','客户编号','期间累计接单发生额','发生年月','接单发生额/元','接单发生额/万元','合计'])expect(screen.getAllByText(label,{exact:true}).length).toBeGreaterThan(0);expect((await screen.findAllByText('2025-12'))[0]).toBeVisible();});
 it('manual refresh submits the protected command with explicit mode',async()=>{mount(<FinanceOrderTable/>);await screen.findByText('本币合计金额');fireEvent.click(screen.getByText('刷新E10数据'));await waitFor(()=>expect(api).toHaveBeenCalledWith('/finance/e10-orders/refresh',expect.objectContaining({method:'POST',body:JSON.stringify({mode:'FULL'})})));});
 it('starts only one ranking request after the standard table supplies its initial query',async()=>{
  mount(<FinanceOrderDashboard/>);await waitFor(()=>expect(vi.mocked(api).mock.calls.filter(([p])=>p.endsWith('/ranking'))).toHaveLength(1));
  const call=vi.mocked(api).mock.calls.find(([p])=>p.endsWith('/ranking'))!;expect(JSON.parse(call[1]!.body as string)).toMatchObject({pageSize:100,page:1,filterGroup:{logic:'AND',rules:[]}});
 });
 it('reuses fresh scoped results on reentry, then refreshes both reports for a new source/classification revision',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const renderDashboard=()=>render(<MemoryRouter><QueryClientProvider client={client}><FinanceOrderDashboard/></QueryClientProvider></MemoryRouter>);
  localStorage.setItem('sessionUser',JSON.stringify({sub:'SYN-A',permissions:['*']}));let view=renderDashboard();
  const count=(end:string)=>vi.mocked(api).mock.calls.filter(([p])=>p.endsWith(end)).length;
  await waitFor(()=>expect(count('/ranking')).toBe(1));view.unmount();view=renderDashboard();await waitFor(()=>expect(count('/revision')).toBe(2));expect(count('/dashboard')).toBe(1);expect(count('/ranking')).toBe(1);
  const original=vi.mocked(api).getMockImplementation()!;vi.mocked(api).mockImplementation(async(p,...args)=>p.endsWith('/revision')?{revision:'synthetic-v2'} as never:original(p,...args));
  await client.invalidateQueries({queryKey:['finance-order-revision']});await waitFor(()=>expect(count('/dashboard')).toBe(2));await waitFor(()=>expect(count('/ranking')).toBe(2));
  view.unmount();localStorage.setItem('sessionUser',JSON.stringify({sub:'SYN-B',permissions:['*']}));renderDashboard();await waitFor(()=>expect(count('/dashboard')).toBe(3));await waitFor(()=>expect(count('/ranking')).toBe(3));
 });
 it('does not request freshness, totals or ranking without dashboard permission',()=>{
  mount(<FinanceOrderDashboard/>,undefined,{permissions:[]});expect(screen.getByText('当前权限组不能查看统计大屏')).toBeVisible();expect(api).not.toHaveBeenCalled();
 });
 it('manual display refresh refetches current reports without starting an E10 import',async()=>{
  mount(<FinanceOrderDashboard/>);await waitFor(()=>expect(vi.mocked(api).mock.calls.filter(([p])=>p.endsWith('/ranking'))).toHaveLength(1));
  await waitFor(()=>expect(screen.getByRole('button',{name:'刷新'})).not.toHaveClass('ant-btn-loading'));fireEvent.click(screen.getByRole('button',{name:'刷新'}));await waitFor(()=>expect(vi.mocked(api).mock.calls.filter(([p])=>p.endsWith('/dashboard'))).toHaveLength(2));expect(vi.mocked(api).mock.calls.some(([p])=>p.endsWith('/refresh'))).toBe(false);
 });

 it('drops previous amounts when live authorization changes before the new scoped response arrives',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});localStorage.setItem('sessionUser',JSON.stringify({sub:'SYN-A',permissions:['*']}));
  render(<MemoryRouter><QueryClientProvider client={client}><FinanceOrderDashboard/></QueryClientProvider></MemoryRouter>);await screen.findAllByText('100.30');
  const original=vi.mocked(api).getMockImplementation()!;let resolveNew:((value:any)=>void)|undefined;
  vi.mocked(api).mockImplementation(async(p,...args)=>p.endsWith('/revision')?{revision:'synthetic-restricted',accessRevision:'synthetic-new-scope'} as never:p.endsWith('/dashboard')?new Promise(resolve=>{resolveNew=resolve;}) as never:original(p,...args));
  await client.invalidateQueries({queryKey:['finance-order-revision']});await waitFor(()=>expect(resolveNew).toBeDefined());expect(screen.queryAllByText('100.30')).toHaveLength(0);
  resolveNew!({totals:{orders:1,amount:'20.00',average:'20.00',pendingAmount:'0'},channels:[],departments:[],months:[],matrix:[]});await screen.findAllByText('20.00');
 });

});
