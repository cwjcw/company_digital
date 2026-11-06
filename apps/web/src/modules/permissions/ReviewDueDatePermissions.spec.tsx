import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { reviewDueDateFields } from '@kdos/contracts';
import { api } from '../../api';
import { TablePermissionsPage } from './TablePermissionsPage';
vi.mock('../../api',async original=>({...await original<object>(),api:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('offers independent visible/update checkboxes for nine business fields and disables all four system updates',async()=>{
 const group={id:'synthetic',displayName:'Synthetic review permissions',groupType:'CUSTOM',dataScope:'ALL',dataMatch:'ALL',enabled:true,subjects:[],permissions:[{fieldKey:'*',read:true},...reviewDueDateFields.map(f=>({fieldKey:f.key,read:true,update:false}))]};
 vi.mocked(api).mockImplementation(async path=>path.includes('table-permission-context')?{roles:[],roleGroups:[],users:[],organizations:[]} as never:[group] as never);
 render(<BrowserRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TablePermissionsPage resourceCode="mps-review-due-dates"/></QueryClientProvider></BrowserRouter>);
 fireEvent.click(await screen.findByRole('button',{name:/编辑/}));fireEvent.click(await screen.findByRole('tab',{name:'字段权限'}));
 for(const field of reviewDueDateFields){
   const label=screen.getByText(field.label,{exact:true}),checks=within(label.closest('.permission-field-row') as HTMLElement).getAllByRole('checkbox');
   expect(checks).toHaveLength(2);expect(checks[0]).not.toBeDisabled();
   if(field.editable){expect(checks[1]).not.toBeDisabled();fireEvent.click(checks[1]!);expect(checks[1]).toBeChecked();expect(checks[0]).toBeChecked();fireEvent.click(checks[1]!);expect(checks[1]).not.toBeChecked();}
   else expect(checks[1]).toBeDisabled();
 }
 const all=within(document.querySelector('.permission-field-row.all') as HTMLElement).getAllByRole('checkbox');fireEvent.click(all[1]!);for(const f of reviewDueDateFields.filter(f=>!f.editable)){expect(within(screen.getByText(f.label,{exact:true}).closest('.permission-field-row') as HTMLElement).getAllByRole('checkbox')[1]).not.toBeChecked();}
 expect(vi.mocked(api).mock.calls.every(([,opts])=>!opts?.method||opts.method==='GET')).toBe(true);
});

it('clamps legacy disabled edit states, create-only save keeps legal fields and member identity',async()=>{
 const group={id:'synthetic-base-group',version:7,displayName:'合成事业四部',groupType:'CUSTOM',dataScope:'ALL',dataMatch:'ALL',dataRules:[],enabled:true,subjects:[{type:'USER',id:'synthetic-user'}],permissions:[{fieldKey:'*',read:true,create:true,update:true},{fieldKey:'deliveryNumber',read:true,update:true},{fieldKey:'plannedQuantity',read:true,update:true}]};
 vi.mocked(api).mockImplementation(async(path,opts)=>{if(opts?.method==='PATCH')return group as never;if(path.includes('table-permission-context'))return {roles:[],roleGroups:[],users:[{id:'synthetic-user',displayName:'合成用户',username:'synthetic-user'}],organizations:[]} as never;return [group] as never;});
 render(<BrowserRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TablePermissionsPage resourceCode="mps-base-plans"/></QueryClientProvider></BrowserRouter>);
 fireEvent.click(await screen.findByRole('button',{name:/编辑/}));fireEvent.click(await screen.findByRole('tab',{name:'字段权限'}));
 const delivery=within(screen.getByText('交期编码',{exact:true}).closest('.permission-field-row') as HTMLElement).getAllByRole('checkbox');expect(delivery[1]).toBeDisabled();expect(delivery[1]).not.toBeChecked();
 fireEvent.click(screen.getByRole('tab',{name:'操作权限'}));
 const add=screen.getByText('添加',{exact:true});fireEvent.click(within(add.closest('label') as HTMLElement).getByRole('checkbox'));
 fireEvent.click(screen.getByRole('button',{name:'确 定'}));
 await vi.waitFor(()=>expect(vi.mocked(api).mock.calls.some(([,o])=>o?.method==='PATCH')).toBe(true));const body=JSON.parse(String(vi.mocked(api).mock.calls.find(([,o])=>o?.method==='PATCH')![1]!.body));expect(body).toEqual({version:7,actions:['read','update']});
});

it.each(['mps-monthly-plans','mps-base-plans','mps-weekly-plans'])('%s action-only PATCH does not send lifecycleStatus to an older API',async resource=>{
 const group={id:'synthetic',version:2,displayName:'合成历史组',groupType:'CUSTOM',dataScope:'CUSTOM',dataMatch:'ALL',dataRules:[{fieldKey:'orderNumber',operator:'EQ',value:'SYN'}],enabled:true,subjects:[{type:'USER',id:'synthetic-user'}],permissions:[{fieldKey:'*',read:true,create:true},{fieldKey:'orderNumber',read:true,update:false},{fieldKey:'lifecycleStatus',read:true,update:false}]};
 vi.mocked(api).mockImplementation(async(path,opts)=>{if(opts?.method==='PATCH'){const body=JSON.parse(String(opts.body));if(body.fields)throw Error('旧API不认识lifecycleStatus');return group as never;}if(path.includes('table-permission-context'))return {roles:[],roleGroups:[],users:[{id:'synthetic-user',displayName:'合成用户',username:'synthetic-user'}],organizations:[]} as never;return [group] as never;});
 render(<BrowserRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><TablePermissionsPage resourceCode={resource}/></QueryClientProvider></BrowserRouter>);
 fireEvent.click(await screen.findByRole('button',{name:/编辑/}));fireEvent.click(screen.getByRole('tab',{name:'操作权限'}));fireEvent.click(within(screen.getByText('添加',{exact:true}).closest('label') as HTMLElement).getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'确 定'}));
 await vi.waitFor(()=>expect(vi.mocked(api).mock.calls.some(([,opts])=>opts?.method==='PATCH')).toBe(true));expect(JSON.parse(String(vi.mocked(api).mock.calls.find(([,opts])=>opts?.method==='PATCH')![1]!.body))).toEqual({version:2,actions:['read']});
});
