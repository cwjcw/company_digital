import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reviewDueDateFields } from '@kdos/contracts';
import { api } from '../../api';
import { ReviewDueDates } from './ReviewDueDates';
vi.mock('../../api',async original=>({...await original<object>(),api:vi.fn()}));
const resource='mps-review-due-dates';
const initial={id:'0199ea00-0000-7000-8000-000000000001',version:1,canUpdate:true,orderNumber:'ORDER-1/2',batchNumber:'BATCH-2/2',drawingNumber:'DRAW-1/3',inspectionTimeName:'Inspection',inboundDate:'2026-11-10',quantity:'9007199254740993.1234567890123456789',changeCount:0,previousInboundDate:null,lastChangedAt:null,lastSyncedAt:null};
let row={...initial};
function session(permissions=['*']){localStorage.setItem('sessionUser',JSON.stringify({sub:'test-editor',permissions}));}
function mount(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><ReviewDueDates/></QueryClientProvider>);}
beforeEach(()=>{
 localStorage.clear();session();row={...initial};
 vi.mocked(api).mockImplementation(async(path,opts)=>{
   if(opts?.method==='PATCH'){const body=JSON.parse(String(opts.body));row={...row,...Object.fromEntries(Object.entries(body).filter(([k])=>!['expectedVersion','commandId'].includes(k))),version:row.version+1};return {id:row.id,version:row.version} as never;}
   if(path.endsWith('/meta'))return {fields:reviewDueDateFields,actions:{update:true}} as never;
   if(path.includes('/history'))return {rows:[],total:0} as never;
   if(path.includes('/resources/'))return {rows:[row],total:1} as never;
   return [] as never;
 });
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe('Review due dates manual editor',()=>{
 it('uses the shared edit-mode button, exposes exactly six editable cells and keeps four system columns readonly',async()=>{
   mount();await screen.findByText(initial.orderNumber);expect(screen.queryByRole('textbox',{name:'订单号'})).toBeNull();
   fireEvent.click(screen.getByRole('button',{name:/进入编辑模式/}));
   // Query again inside the assertion: metadata/row refresh can replace an earlier async locator.
   await waitFor(()=>{for(const field of reviewDueDateFields.slice(0,6))expect(screen.getByRole('textbox',{name:field.label})).toBeVisible();});
   for(const field of reviewDueDateFields.slice(6))expect(screen.queryByRole('textbox',{name:field.label})).toBeNull();
   fireEvent.click(screen.getByRole('button',{name:/退出编辑模式/}));expect(screen.queryByRole('textbox',{name:'订单号'})).toBeNull();
 });
 it('sends precise quantity text and the loaded version to the dedicated command and refreshes the row',async()=>{
   mount();await screen.findByText(initial.orderNumber);fireEvent.click(screen.getByRole('button',{name:/进入编辑模式/}));
   const input=screen.getByRole('textbox',{name:'数量'}),quantity='12345678901234567890.00000000000000000001';
   fireEvent.change(input,{target:{value:quantity}});fireEvent.blur(input);fireEvent.blur(input);
   await waitFor(()=>expect(row.version).toBe(2));await waitFor(()=>expect(screen.getByRole('textbox',{name:'数量'})).toHaveValue(quantity));
   const mutations=vi.mocked(api).mock.calls.filter(([,opts])=>opts?.method==='PATCH');expect(mutations).toHaveLength(1);
   expect(mutations[0]![0]).toBe(`/master-plan-system/review-due-dates/${initial.id}/manual-edit`);
   expect(JSON.parse(String(mutations[0]![1]?.body))).toMatchObject({quantity,expectedVersion:1,commandId:expect.any(String)});
 });
 it('shows a real save error, restores the original cell and offers refresh instead of claiming success',async()=>{
   const normal=vi.mocked(api).getMockImplementation()!;vi.mocked(api).mockImplementation(async(path,opts)=>{if(opts?.method==='PATCH')throw new Error('评审交期版本已变化，请刷新后重试');return normal(path,opts);});
   mount();await screen.findByText(initial.orderNumber);fireEvent.click(screen.getByRole('button',{name:/进入编辑模式/}));
   const input=screen.getByRole('textbox',{name:'订单号'});fireEvent.change(input,{target:{value:'OLD-REQUEST'}});fireEvent.blur(input);
   await screen.findByText('评审交期版本已变化，请刷新后重试');expect(input).toHaveValue(initial.orderNumber);expect(row.version).toBe(1);expect(screen.getByRole('button',{name:'刷新后重试'})).toBeVisible();
 });
 it('keeps readonly actors out of edit mode and independently enforces field update and row scope controls',async()=>{
   const fields=reviewDueDateFields.map(f=>({...f,editable:f.key==='quantity'}));
   session([resource+':*:read']);mount();await screen.findByText(initial.orderNumber);expect(screen.queryByRole('button',{name:/进入编辑模式/})).toBeNull();cleanup();
   session([resource+':*:read',resource+':*:update',resource+':quantity:update']);
   const normal=vi.mocked(api).getMockImplementation()!;vi.mocked(api).mockImplementation(async(path,opts)=>path.endsWith('/meta')?{fields,actions:{update:true}} as never:normal(path,opts));
   mount();await screen.findByText(initial.orderNumber);fireEvent.click(screen.getByRole('button',{name:/进入编辑模式/}));
   expect(screen.getByRole('textbox',{name:'数量'})).toBeVisible();expect(screen.queryByRole('textbox',{name:'订单号'})).toBeNull();
   cleanup();row={...row,canUpdate:false};mount();await screen.findByText(initial.orderNumber);fireEvent.click(screen.getByRole('button',{name:/进入编辑模式/}));expect(screen.queryByRole('textbox',{name:'数量'})).toBeNull();
 });
 it('blocks overlapping writes on the same record until its authoritative refresh completes',async()=>{
   let release!:(value:unknown)=>void;const pending=new Promise(resolve=>{release=resolve;});const normal=vi.mocked(api).getMockImplementation()!;
   vi.mocked(api).mockImplementation(async(path,opts)=>{if(opts?.method==='PATCH'){await pending;return normal(path,opts);}return normal(path,opts);});
   mount();await screen.findByText(initial.orderNumber);fireEvent.click(screen.getByRole('button',{name:/进入编辑模式/}));
   const input=screen.getByRole('textbox',{name:'订单号'});fireEvent.change(input,{target:{value:'LATEST'}});fireEvent.blur(input);
   await waitFor(()=>expect(screen.getByRole('textbox',{name:'数量'})).toBeDisabled());fireEvent.blur(input);
   expect(vi.mocked(api).mock.calls.filter(([,opts])=>opts?.method==='PATCH')).toHaveLength(1);
   release(null);await waitFor(()=>expect(screen.getByRole('textbox',{name:'数量'})).not.toBeDisabled());expect(row.orderNumber).toBe('LATEST');
 });
});
