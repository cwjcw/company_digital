import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MpsLifecyclePreview } from '@kdos/contracts';
import { api } from '../../api';
import { MasterPlanLifecycleDialog } from './MasterPlanLifecycleDialog';

vi.mock('../../api', () => ({ api: vi.fn() }));
const clients: QueryClient[]=[];
const preview: MpsLifecyclePreview={
  resource:'mps-weekly-plans',recordId:'synthetic-id',operation:'CANCEL',currentStatus:'ACTIVE',targetStatus:'CANCELLED',
  orderNumber:'SYN-ORDER',itemCode:'SYN-ITEM',divisionId:'synthetic-division',divisionName:'合成事业部',plannedQuantity:'10',expectedVersion:3,
  facts:{reportCount:0,reportedQuantity:'0',hasInbound:false,outsourcingDependencies:0,workOrderDependencies:0},
  affectedPlans:[],allowed:true,blockers:[],requiredPermissions:[],writesEnabled:true,previewToken:'synthetic-preview',expiresAt:Date.now()+300000
};
function show(){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);
  const onClose=vi.fn(),onCompleted=vi.fn(async()=>{});
  render(<QueryClientProvider client={client}><MasterPlanLifecycleDialog resource="mps-weekly-plans" id="synthetic-id" operation="CANCEL" onClose={onClose} onCompleted={onCompleted}/></QueryClientProvider>);
  return {onClose,onCompleted};
}
beforeEach(()=>vi.clearAllMocks());
afterEach(()=>{cleanup();for(const client of clients)client.clear();clients.length=0;});
describe('lifecycle preview and protected confirmation',()=>{
  it('shows switch-off blockers and never submits a write',async()=>{
    vi.mocked(api).mockResolvedValue({...preview,allowed:false,writesEnabled:false,blockers:['计划生命周期写入开关默认关闭']} as never);
    show();await screen.findByText('计划生命周期写入开关默认关闭');
    fireEvent.change(screen.getByLabelText('操作原因'),{target:{value:'合成取消原因'}});
    expect(screen.getByRole('button',{name:'确认执行'})).toBeDisabled();expect(api).toHaveBeenCalledTimes(1);
  });
  it('requires reason, sends version/token/key once and preserves entered reason on failure',async()=>{
    vi.mocked(api).mockImplementation(async(path)=>{if(path.endsWith('/preview'))return preview as never;throw Error('预览后的事实已变化');});
    const {onCompleted,onClose}=show();await screen.findByText('SYN-ORDER / SYN-ITEM');
    const button=screen.getByRole('button',{name:'确认执行'});expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('操作原因'),{target:{value:'保留此纠错原因'}});fireEvent.click(button);
    await screen.findByText('预览后的事实已变化');
    expect(screen.getByLabelText('操作原因')).toHaveValue('保留此纠错原因');expect(onClose).not.toHaveBeenCalled();expect(onCompleted).not.toHaveBeenCalled();
    const body=JSON.parse(vi.mocked(api).mock.calls[1]![1]!.body as string);
    expect(body).toMatchObject({operation:'CANCEL',expectedVersion:3,previewToken:'synthetic-preview',reason:'保留此纠错原因'});expect(body.idempotencyKey).toBeTruthy();
    fireEvent.click(button);await waitFor(()=>expect(api).toHaveBeenCalledTimes(3));
    expect(JSON.parse(vi.mocked(api).mock.calls[2]![1]!.body as string).idempotencyKey).toBe(body.idempotencyKey);
  });
  it('previews without writing, then refreshes only after a successful explicit confirmation',async()=>{
    vi.mocked(api).mockImplementation(async path=>(path.endsWith('/preview')?preview:{lifecycleStatus:'CANCELLED'}) as never);
    const {onClose,onCompleted}=show();await screen.findByText('合成事业部');expect(api).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('操作原因'),{target:{value:'无执行事实取消'}});
    fireEvent.click(screen.getByRole('button',{name:'确认执行'}));
    await waitFor(()=>expect(onCompleted).toHaveBeenCalledTimes(1));expect(onClose).toHaveBeenCalledTimes(1);
  });
});
