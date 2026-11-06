import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { MasterPlanReviewApplicationDialog } from './MasterPlanReviewApplicationDialog';
vi.mock('../../api', () => ({ api: vi.fn() }));
const clients: QueryClient[] = [];
const info = { reviewId: 'SYN-REVIEW', reviewVersion: 2, orderNumber: 'SYN-ORDER', itemCode: 'SYN-ITEM', divisionName: '合成事业三部', demandId: 'SYN-DEMAND', batchNumber: '01', reviewDate: '2026-12-15', customerDate: '2026-12-20', canApply: true, canBind: false, blockers: [], history: [{ id: 'SYN-APP', baseId: 'SYN-B1', deliveryNumber: '001', reviewVersion: 1, date: '2026-12-10', appliedAt: '2026-11-06T01:00:00.000Z', syncStatus: 'SUCCESS' }], candidates: [{ id: 'SYN-B1', version: 3, deliveryNumber: '001', quantity: '60.0000', customerDate: '2026-12-20', reviewDate: '2026-12-10', status: 'ACTIVE', protected: true, canUpdate: true, appliedVersion: 1, appliedDate: '2026-12-10', pending: true, otherReview: false }, { id: 'SYN-B2', version: 1, deliveryNumber: '002', quantity: '40.0000', customerDate: '2026-12-20', reviewDate: '2026-12-01', status: 'ACTIVE', protected: false, canUpdate: true, appliedVersion: null, appliedDate: null, pending: false, otherReview: false }] };
function show() { const c = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(c); const onSaved = vi.fn(async () => { }); render(<App><QueryClientProvider client={c}><MasterPlanReviewApplicationDialog id={info.reviewId} onClose={vi.fn()} onSaved={onSaved}/></QueryClientProvider></App>); return { onSaved }; }
beforeEach(() => vi.clearAllMocks());
afterEach(() => { cleanup(); clients.forEach(c => c.clear()); clients.length = 0; });
describe('explicit review-to-batch application', () => {
    it('does not auto-select/broadcast; shows current version, pending review and old evidence', async () => { vi.mocked(api).mockResolvedValue(info as never); show(); await screen.findByText('有新评审待应用'); expect(screen.getByRole('checkbox', { name: '选择批次001' })).not.toBeChecked(); expect(screen.getByRole('checkbox', { name: '选择批次002' })).not.toBeChecked(); expect(screen.getByText('预览应用交期').closest('button')).toBeDisabled(); expect(screen.getByText('实际应用日期快照')).toBeInTheDocument(); expect(vi.mocked(api).mock.calls.every(([, o]) => !o?.method)).toBe(true); });
    it('only selected B1 is previewed, failed confirm preserves selection/reason/key, success distinguishes failed downstream', async () => { let fail = true; vi.mocked(api).mockImplementation(async (p, o) => { if (p.endsWith('/preview'))
        return { info, request: JSON.parse(String(o!.body)), allowed: true, blockers: [], changes: [{ baseId: 'SYN-B1', deliveryNumber: '001', before: '2026-12-10', after: '2026-12-15' }], previewHash: 'SYN-HASH' } as never; if (p.endsWith('/confirm')) {
        if (fail)
            throw Error('合成版本冲突');
        return { reviewId: info.reviewId, applicationIds: ['SYN-APP2'], outboxId: 'SYN-EVENT', syncStatus: 'PENDING' } as never;
    } if (p.endsWith('/status'))
        return { status: 'FAILED', last_error: '合成同步失败' } as never; return info as never; }); const h = show(); fireEvent.click(await screen.findByRole('checkbox', { name: '选择批次001' })); fireEvent.change(screen.getByLabelText('评审应用原因'), { target: { value: '合成只应用第一批' } }); fireEvent.click(screen.getByText('预览应用交期')); await screen.findByText('基础批次001：2026-12-10 → 2026-12-15'); const pre = JSON.parse(String(vi.mocked(api).mock.calls.find(([p]) => p.endsWith('/preview'))![1]!.body)); expect(pre.targets).toEqual([{ baseId: 'SYN-B1', expectedVersion: 3 }]); fireEvent.click(screen.getByText('确认应用所选批次')); await screen.findByText('合成版本冲突'); expect(screen.getByRole('checkbox', { name: '选择批次001' })).toBeChecked(); expect(screen.getByLabelText('评审应用原因')).toHaveValue('合成只应用第一批'); const body = vi.mocked(api).mock.calls.find(([p]) => p.endsWith('/confirm'))![1]!.body; fail = false; fireEvent.click(screen.getByText('确认应用所选批次')); await screen.findByText('合成同步失败'); expect(vi.mocked(api).mock.calls.filter(([p]) => p.endsWith('/confirm'))[1]![1]!.body).toBe(body); await waitFor(() => expect(h.onSaved).toHaveBeenCalled()); });
    it('unconfirmed demand cannot apply; binding reuses existing controlled command', async () => { vi.mocked(api).mockResolvedValue({ ...info, demandId: null, canApply: false, canBind: true, candidates: [], history: [], blockers: ['需求关联尚未确认'] } as never); show(); await screen.findByText('需求关联尚未确认'); expect(screen.queryByText('预览应用交期')).not.toBeInTheDocument(); expect(screen.getByText('确认需求关联')).toBeInTheDocument(); });
    it('read failure is visible, never becomes a default application', async () => { vi.mocked(api).mockRejectedValue(Error('合成读取失败')); show(); await screen.findByText('合成读取失败'); expect(screen.queryByText('确认应用所选批次')).not.toBeInTheDocument(); });
    it('refresh after a version conflict preserves user selection/reason and previews the new versions', async () => {
        let version = 2;
        vi.mocked(api).mockImplementation(async (p, o) => { if (p.endsWith('/preview'))
            return { info, request: JSON.parse(String(o!.body)), allowed: true, blockers: [], changes: [], previewHash: 'SYN-HASH' } as never; return { ...info, reviewVersion: version, candidates: info.candidates.map(c => ({ ...c, version: c.version + version - 2 })) } as never; });
        show();
        fireEvent.click(await screen.findByRole('checkbox', { name: '选择批次001' }));
        fireEvent.change(screen.getByLabelText('评审应用原因'), { target: { value: '保留我的原因' } });
        version = 3;
        fireEvent.click(screen.getByText('刷新评审与批次版本'));
        await waitFor(() => expect(vi.mocked(api).mock.calls.filter(([p]) => !p.endsWith('/preview')).length).toBeGreaterThan(1));
        await waitFor(() => expect(screen.getByText('预览应用交期').closest('button')).not.toBeDisabled());
        fireEvent.click(screen.getByText('预览应用交期'));
        await waitFor(() => expect(vi.mocked(api).mock.calls.some(([p]) => p.endsWith('/preview'))).toBe(true));
        const body = JSON.parse(String(vi.mocked(api).mock.calls.find(([p]) => p.endsWith('/preview'))![1]!.body));
        expect(body).toMatchObject({ expectedReviewVersion: 3, targets: [{ baseId: 'SYN-B1', expectedVersion: 4 }] });
        expect(screen.getByLabelText('评审应用原因')).toHaveValue('保留我的原因');
    });
});
