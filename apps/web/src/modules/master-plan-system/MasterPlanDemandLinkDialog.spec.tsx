import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { MasterPlanDemandLinkDialog } from './MasterPlanDemandLinkDialog';
vi.mock('../../api',()=>({api:vi.fn()}));
const clients:QueryClient[]=[];
const info={schemaReady:true,recordId:'synthetic-base',recordVersion:7,demandId:null,demandVersion:null,canBind:true};
function show(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);const onClose=vi.fn(),onSaved=vi.fn(async()=>{});render(<App><QueryClientProvider client={client}><MasterPlanDemandLinkDialog resource="mps-base-plans" id="synthetic-base" onClose={onClose} onSaved={onSaved}/></QueryClientProvider></App>);return {onClose,onSaved};}
beforeEach(()=>vi.clearAllMocks());
afterEach(()=>{cleanup();for(const client of clients)client.clear();clients.length=0;});
describe('demand first-link command',()=>{
  it('shows schema absence without allowing writes',async()=>{vi.mocked(api).mockResolvedValue({...info,schemaReady:false,canBind:false} as never);show();await screen.findByText('需求关联功能尚未发布');expect(screen.queryByText('确认首次关联')).not.toBeInTheDocument();});
  it('shows stable demand and provisional gap without rebind controls',async()=>{vi.mocked(api).mockResolvedValue({...info,demandId:'synthetic-demand',canBind:false,balance:{allocated:'100.0000',difference:'20.0000'}} as never);show();await screen.findByText('synthetic-demand');expect(screen.getByText(/已关联批次计划量/)).toHaveTextContent('20.0000');expect(screen.queryByLabelText('目标需求ID')).not.toBeInTheDocument();});
  it('requires target check and reason; preserves input/idempotency after failure',async()=>{
    let fail=true;
    vi.mocked(api).mockImplementation(async(path,options)=>{if(options?.method==='POST'){if(fail)throw new Error('合成并发冲突');return {demandId:'synthetic-demand'} as never;}if(path.includes('/demands/'))return {id:'synthetic-demand',version:9,orderNumber:'SYN-ORDER',itemCode:'SYN-ITEM'} as never;return info as never;});
    const h=show();await screen.findByLabelText('目标需求ID');expect(screen.getByText('确认首次关联').closest('button')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('目标需求ID'),{target:{value:'synthetic-demand'}});fireEvent.click(screen.getByText('核对目标需求'));await screen.findByText(/SYN-ORDER/);
    fireEvent.change(screen.getByLabelText('关联原因'),{target:{value:'合成首次关联'}});fireEvent.click(screen.getByText('确认首次关联'));await screen.findByText('合成并发冲突');expect(screen.getByLabelText('关联原因')).toHaveValue('合成首次关联');
    const first=vi.mocked(api).mock.calls.find(([,o])=>o?.method==='POST')![1]!.body;
    fail=false;fireEvent.click(screen.getByText('确认首次关联'));await waitFor(()=>expect(h.onClose).toHaveBeenCalled());
    const writes=vi.mocked(api).mock.calls.filter(([,o])=>o?.method==='POST');expect(writes).toHaveLength(2);expect(writes[1]![1]!.body).toBe(first);expect(JSON.parse(String(first))).toMatchObject({expectedVersion:7,expectedDemandVersion:9,reason:'合成首次关联'});
  });
  it('read failure is visible and never becomes a default binding',async()=>{vi.mocked(api).mockRejectedValue(new Error('合成读取失败'));show();await screen.findByText('合成读取失败');expect(screen.queryByText('确认首次关联')).not.toBeInTheDocument();});
});
