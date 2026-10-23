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
 expect(vi.mocked(api).mock.calls.every(([,opts])=>!opts?.method||opts.method==='GET')).toBe(true);
});
