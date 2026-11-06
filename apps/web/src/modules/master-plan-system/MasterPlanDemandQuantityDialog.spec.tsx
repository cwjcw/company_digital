import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { MasterPlanDemandQuantityDialog } from './MasterPlanDemandQuantityDialog';
vi.mock('../../api', () => ({ api: vi.fn() }));
const clients: QueryClient[] = [];
const snapshot = { demandId: 'synthetic-demand', demandVersion: 4, orderNumber: 'SYN-ORDER', itemCode: 'SYN-ITEM', status: 'ACTIVE', required: '120.0000', allocated: '100.0000', fulfilled: '0.0000', remainingReserved: '100.0000', heldReserved: '0.0000', cancelledFulfilled: '0.0000', unallocated: '20.0000', overallocated: '0.0000', relationStatus: 'CONFIRMED', trusted: true, blockers: [], canUpdate: true, canCreate: true, batches: [] };
function show(resource = 'mps-monthly-plans') { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client); const onSaved = vi.fn(async () => { }); render(<App><QueryClientProvider client={client}><MasterPlanDemandQuantityDialog resource={resource} id="synthetic-id" onClose={vi.fn()} onSaved={onSaved}/></QueryClientProvider></App>); return { onSaved }; }
beforeEach(() => vi.clearAllMocks());
afterEach(() => { cleanup(); clients.forEach(c => c.clear()); clients.length = 0; });
describe('quantity preview/confirm', () => {
    it('shows exact balances and requires explicit preflight; readonly no commands', async () => { vi.mocked(api).mockResolvedValue({ ...snapshot, canUpdate: false } as never); show(); await screen.findByText('有效需求数量'); expect(screen.getByText('待分配')).toBeInTheDocument(); expect(screen.queryByText('预览数量调整')).not.toBeInTheDocument(); });
    it('historical NULL relation cannot be mistaken for zero', async () => { vi.mocked(api).mockResolvedValue({ demandId: null } as never); show('mps-base-plans'); await screen.findByText('本批次需求关联尚未确认，请先确认需求关联'); expect(screen.queryByText('确认数量调整')).not.toBeInTheDocument(); });
    it('keeps input/key after failed confirm, reports queue separately and refreshes on success', async () => {
        let fail = true;
        vi.mocked(api).mockImplementation(async (path, o) => { if (path.endsWith('/preview'))
            return { snapshot, allowed: true, blockers: [], changes: [{ id: 'NEW', before: '0.0000', after: '20.0000' }], request: JSON.parse(String(o!.body)), previewHash: 'synthetic-hash' } as never; if (path.endsWith('/confirm')) {
            if (fail)
                throw Error('合成版本冲突');
            return { demandId: snapshot.demandId, batchIds: ['synthetic-base'], outboxId: 'synthetic-outbox', syncStatus: 'PENDING' } as never;
        } if (path.includes('/status/'))
            return { status: 'FAILED', last_error: '合成下游失败' } as never; return snapshot as never; });
        const h = show();
        await screen.findByLabelText('调整数量');
        fireEvent.change(screen.getByLabelText('调整数量'), { target: { value: '20' } });
        fireEvent.change(screen.getByLabelText('数量调整原因'), { target: { value: '合成核对' } });
        fireEvent.click(screen.getByText('预览数量调整'));
        await screen.findByText('新增批次：0.0000 → 20.0000');
        fireEvent.click(screen.getByText('确认数量调整'));
        await screen.findByText('合成版本冲突');
        expect(screen.getByLabelText('数量调整原因')).toHaveValue('合成核对');
        const first = vi.mocked(api).mock.calls.find(([p]) => p.endsWith('/confirm'))![1]!.body;
        fail = false;
        fireEvent.click(screen.getByText('确认数量调整'));
        await screen.findByText('合成下游失败');
        expect(screen.getByText(/数量已保存；下游同步：FAILED/)).toBeInTheDocument();
        expect(vi.mocked(api).mock.calls.filter(([p]) => p.endsWith('/confirm'))[1]![1]!.body).toBe(first);
        await waitFor(() => expect(h.onSaved).toHaveBeenCalled());
    });
    it('unknown fulfillment shows blocker and disables actionable preview', async () => { vi.mocked(api).mockResolvedValue({ ...snapshot, trusted: false, unallocated: null, fulfilled: null, blockers: ['履约归属待确认'] } as never); show(); await screen.findByText('履约归属待确认'); expect(screen.getByText('预览数量调整').closest('button')).toBeDisabled(); });
});
it('first-batch allocation loads existing create-field definitions rather than guessing dates or dictionaries',async()=>{
  vi.mocked(api).mockImplementation(async p=>p.endsWith('/meta')?{createFields:[{key:'latestReviewDueDate',label:'最迟评审交期',type:'date',editable:true},{key:'manufacturingMethod',label:'生产方式',type:'dictionary',editable:true,options:[{value:'自制',label:'自制'}]}]} as never:{...snapshot,batches:[]} as never);
  show();await screen.findByRole('combobox',{name:'数量操作'});fireEvent.mouseDown(screen.getByRole('combobox',{name:'数量操作'}));fireEvent.click(await screen.findByText('分配至新批次'));await screen.findByRole('textbox',{name:'最迟评审交期'});expect(screen.getByRole('combobox',{name:'生产方式'})).toBeInTheDocument();expect(screen.queryByText('确认数量调整')).not.toBeInTheDocument();expect(vi.mocked(api).mock.calls.some(([,o])=>o?.method==='POST')).toBe(false);
});
