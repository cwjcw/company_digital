import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { reviewDueDateCreateFields,reviewDueDateFields } from '@kdos/contracts';
import { api } from '../../api';
import { ReviewDueDates } from './ReviewDueDates';
vi.mock('../../api',async original=>({...await original<object>(),api:vi.fn()}));
const resource='mps-review-due-dates',quantity='900719925474099312345.000000000000000000001';
let rows:Record<string,unknown>[]=[];
const mount=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ReviewDueDates/></QueryClientProvider>);
const fill=async()=>{
 const dialog=screen.getByRole('dialog',{name:'新增评审交期'});
 fireEvent.mouseDown(within(dialog).getByRole('combobox',{name:'事业部'}));fireEvent.click(await screen.findByText('凯南 / 事业一部'));
 for(const [name,value]of [['订单号','CREATE-1/2'],['批次号','CREATE-2/2'],['品项编码','CREATE-1/3'],['数量',quantity]])fireEvent.change(within(dialog).getByRole('textbox',{name}),{target:{value}});
 const date=within(dialog).getByRole('textbox',{name:'入库时间'});fireEvent.change(date,{target:{value:'2026-12-01'}});fireEvent.keyDown(date,{key:'Enter',code:'Enter'});fireEvent.blur(date);
};
beforeEach(()=>{
 rows=[];localStorage.clear();localStorage.setItem('sessionUser',JSON.stringify({sub:'synthetic',permissions:['*']}));
 vi.mocked(api).mockImplementation(async(path,opts)=>{
  if(opts?.method==='POST'){const body=JSON.parse(String(opts.body));rows=[{...body,id:'0199ea00-0000-7000-8000-000000000001',version:1,changeCount:null}];return {id:rows[0]!.id,version:1} as never;}
  if(path.includes('/references/organizations'))return [{id:'0199ea00-0000-7000-8000-000000000010',name:'事业一部',pathLabel:'凯南 / 事业一部'}] as never;if(path.endsWith('/meta'))return {fields:reviewDueDateFields,createFields:reviewDueDateCreateFields,actions:{update:true,create:true}} as never;
  if(path.includes('/resources/'))return {rows,total:rows.length} as never;
  return [] as never;
 });
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe('Review due dates dedicated manual creation',()=>{
 it('shows create in the existing toolbar on an empty table, with nine ordered business fields and no system inputs',async()=>{
  mount();const create=await screen.findByRole('button',{name:/^新\s*增$/});expect(create.closest('.kdos-data-table-toolbar')).toBeTruthy();fireEvent.click(create);
  const dialog=screen.getByRole('dialog',{name:'新增评审交期'}),labels=dialog.querySelectorAll('.ant-form-item-label label');expect(Array.from(labels).map(x=>x.textContent)).toEqual(reviewDueDateCreateFields.map(f=>f.label));expect(within(dialog).getAllByRole('textbox')).toHaveLength(7);
  for(const field of reviewDueDateFields.filter(f=>!f.editable))expect(within(dialog).queryByRole('textbox',{name:field.label})).toBeNull();
 });
 it('validates required fields, accepts correction, prevents double clicks, sends exact quantity and refreshes rows/count',async()=>{
  mount();fireEvent.click(await screen.findByRole('button',{name:/^新\s*增$/}));fireEvent.click(screen.getByRole('button',{name:/^保\s*存$/}));await screen.findByText('订单号必填');expect(vi.mocked(api).mock.calls.some(([,opts])=>opts?.method==='POST')).toBe(false);
  await fill();const save=screen.getByRole('button',{name:/^保\s*存$/});fireEvent.click(save);fireEvent.click(save);
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'新增评审交期'})).toBeNull());await screen.findByText('CREATE-1/2');
  const calls=vi.mocked(api).mock.calls.filter(([,opts])=>opts?.method==='POST');expect(calls).toHaveLength(1);expect(calls[0]![0]).toBe('/master-plan-system/review-due-dates/manual-create');expect(JSON.parse(String(calls[0]![1]?.body))).toMatchObject({quantity,inboundDate:'2026-12-01',commandId:expect.any(String)});expect(rows[0]!.changeCount).toBeNull();
 });
 it('preserves failed drafts and reuses the command identity when retrying an unchanged payload',async()=>{
  const normal=vi.mocked(api).getMockImplementation()!;let attempts=0;
  vi.mocked(api).mockImplementation(async(path,opts)=>{if(opts?.method==='POST'&&attempts++===0)throw new Error('网络连接失败，请重试');return normal(path,opts);});
  mount();fireEvent.click(await screen.findByRole('button',{name:/^新\s*增$/}));await fill();fireEvent.click(screen.getByRole('button',{name:/^保\s*存$/}));await screen.findByText('网络连接失败，请重试');expect(screen.getByRole('textbox',{name:'数量'})).toHaveValue(quantity);expect(screen.getByRole('textbox',{name:'订单号'})).toHaveValue('CREATE-1/2');
  fireEvent.click(screen.getByRole('button',{name:/^保\s*存$/}));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'新增评审交期'})).toBeNull());const bodies=vi.mocked(api).mock.calls.filter(([,opts])=>opts?.method==='POST').map(([,opts])=>JSON.parse(String(opts?.body)));expect(bodies).toHaveLength(2);expect(bodies[0].commandId).toBe(bodies[1].commandId);
 });
 it('hides create when the resource grant or server field/scope capability is absent',async()=>{
  localStorage.setItem('sessionUser',JSON.stringify({permissions:[resource+':*:read']}));mount();await screen.findByRole('button',{name:/高级筛选/});expect(screen.queryByRole('button',{name:/^新\s*增$/})).toBeNull();cleanup();localStorage.setItem('sessionUser',JSON.stringify({permissions:['*']}));
  const normal=vi.mocked(api).getMockImplementation()!;vi.mocked(api).mockImplementation(async(path,opts)=>path.endsWith('/meta')?{fields:reviewDueDateFields,createFields:[],actions:{create:false}} as never:normal(path,opts));mount();await waitFor(()=>expect(api).toHaveBeenCalled());expect(screen.queryByRole('button',{name:/^新\s*增$/})).toBeNull();
 });
 it('allows a create-only user to open the form without reading rows, and clears a cancelled draft on reopen',async()=>{
  localStorage.setItem('sessionUser',JSON.stringify({permissions:[resource+':*:create',...reviewDueDateCreateFields.map(f=>`${resource}:${f.key}:read`)]}));
  const normal=vi.mocked(api).getMockImplementation()!;vi.mocked(api).mockImplementation(async(path,opts)=>path.endsWith('/meta')?{fields:[],createFields:reviewDueDateCreateFields,actions:{create:true,update:false}} as never:normal(path,opts));
  mount();fireEvent.click(await screen.findByRole('button',{name:/^新\s*增$/}));fireEvent.change(screen.getByRole('textbox',{name:'订单号'}),{target:{value:'CANCELLED'}});fireEvent.click(screen.getByRole('button',{name:/^取\s*消$/}));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'新增评审交期'})).toBeNull());fireEvent.click(screen.getByRole('button',{name:/^新\s*增$/}));expect(screen.getByRole('textbox',{name:'订单号'})).toHaveValue('');expect(vi.mocked(api).mock.calls.some(([path])=>/\/resources\/[^/?]+\?/.test(path))).toBe(false);
 });
});
