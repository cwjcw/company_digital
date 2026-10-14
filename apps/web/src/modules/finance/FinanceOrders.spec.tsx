import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {api} from '../../api';
import {FinanceOrderTable,FinanceOrderDashboard} from './FinanceOrders';
vi.mock('../../api',async original=>({...await original<object>(),api:vi.fn()}));
vi.mock('../../shared/charts/KdosChart',()=>({KdosChart:({ariaLabel,onDataClick,option}:any)=><button onClick={()=>onDataClick?.({name:'国内',dataIndex:0})}>{ariaLabel}{option?.xAxis?.data?.map((month:string)=><span key={month}>{month}</span>)}</button>}));
vi.mock('../../shared/KdosDataTable',async original=>({...await original<object>(),KdosDataTable:({columns,toolbar,contextFilterGroup,dataSource}:any)=><div data-testid="record-table">{columns.map((c:any)=><span key={c.dataIndex}>{c.title}</span>)}{dataSource?.map((r:any)=><div key={r.id}>{columns.map((c:any)=><span key={c.dataIndex}>{c.render?.(r[c.dataIndex],r)}</span>)}</div>)}{toolbar}<pre>{JSON.stringify(contextFilterGroup)}</pre></div>}));
function mount(component:React.ReactNode,url='/finance/orders/monthly',user:any={permissions:['*']}){localStorage.setItem('sessionUser',JSON.stringify(user));return render(<MemoryRouter initialEntries={[url]}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}>{component}</QueryClientProvider></MemoryRouter>);}
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();vi.mocked(api).mockImplementation(async p=>p.includes('dashboard')?{totals:{orders:2,amount:'100.30',average:'50.15',pendingAmount:'0.00',pendingOrders:0,pendingCustomers:0},channels:[{category:'内销',amount:'100.30',share:'1'}],departments:[{category:'业务一部',amount:'100.30',share:'1'}],months:Array.from({length:12},(_,i)=>({month:`2025-${String(i+1).padStart(2,'0')}`,amount:i?'0.00':'100.30',wan:i?'0.000000':'0.010030'})),matrix:[],quality:{excludedOrders:1,excludedAmount:'3.00'}} as never:{rows:[],total:0,canInspectExceptions:true} as never);});
afterEach(cleanup);
describe('Finance E10 UI',()=>{
 it('shows earliest order dates without adding a template column and preserves dashboard money',async()=>{
  const original=vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async(p,...args)=>{
   if(p.includes('/table-filters/rows'))return {rows:[{id:'conflict',deliveryDate:'2025-02-01',deliveryDateConflict:true,orderTotal:'100.30'}],total:1} as never;
   const result:any=await original(p,...args);if(p.includes('dashboard'))result.totals.deliveryDateConflicts=1;return result;
  });
  const view=mount(<FinanceOrderTable monthly/>);await screen.findByText('2025-02-01');expect(screen.queryByText('预交货日冲突')).toBeNull();expect(screen.getByText('100.30')).toBeVisible();expect(screen.getByTestId('record-table').querySelectorAll(':scope > span')).toHaveLength(9);view.unmount();
  mount(<FinanceOrderDashboard/>);await screen.findByText('年累计本币总金额');expect(screen.queryByText(/(?:多个预交货日|预交货日冲突)\s*\d+\s*张/)).toBeNull();
 });
 it('shows exactly 34 Chinese source columns and no upload control',async()=>{mount(<FinanceOrderTable/>);await screen.findByText('本币合计金额');expect(screen.getByTestId('record-table').querySelectorAll(':scope > span')).toHaveLength(34);expect(screen.queryByText('导入')).toBeNull();expect(screen.getByText('刷新E10数据')).toBeVisible();});
 it('monthly has exactly nine columns and propagates complete drilldown filters',async()=>{mount(<FinanceOrderTable monthly/>,'/finance/orders/monthly?year=2025&month=2&salesperson=测试&customerCode=A140-2&salesChannel=待分类');await screen.findByText('本币总金额');expect(screen.getByTestId('record-table').querySelectorAll(':scope > span')).toHaveLength(9);const call=vi.mocked(api).mock.calls.find(([p])=>p.includes('/table-filters/rows'))![0];const group=JSON.parse(new URLSearchParams(call.split('?')[1]).get('filterGroup')!);expect(JSON.stringify(group)).toContain('2025-02');expect(JSON.stringify(group)).toContain('contains_any');expect(JSON.stringify(group)).toContain('A140-2');expect(JSON.stringify(group)).toContain('is_empty');});
 it('does not request data for unauthorized users',()=>{mount(<FinanceOrderTable/>,undefined,{permissions:[],moduleAdminCodes:['planning']});expect(screen.getByText('当前权限组不能查看销售订单数据')).toBeVisible();expect(api).not.toHaveBeenCalled();});
 it('renders original dashboard headers and all twelve months without the excluded-money banner',async()=>{mount(<FinanceOrderDashboard/>);await screen.findByText('年累计本币总金额');expect(screen.queryByText(/待复核订单.*暂未纳入统计/)).toBeNull();for(const label of ['分类','金额/本币含税','年占比','年合计','客户编号','年累计本币总金额','年月','本币合计金额/元','本币合计金额/万元','合计'])expect(screen.getAllByText(label,{exact:true}).length).toBeGreaterThan(0);expect((await screen.findAllByText('2025-12'))[0]).toBeVisible();});
 it('manual refresh submits the protected command with explicit mode',async()=>{mount(<FinanceOrderTable/>);await screen.findByText('本币合计金额');fireEvent.click(screen.getByText('刷新E10数据'));await waitFor(()=>expect(api).toHaveBeenCalledWith('/finance/e10-orders/refresh',expect.objectContaining({method:'POST',body:JSON.stringify({mode:'FULL'})})));});
});
