import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { RdOrderBomReportPage } from './RdOrderBomReportPage';

vi.mock('../../api', () => ({ api: vi.fn(), ApiError: class ApiError extends Error {} }));
vi.mock('../../shared/KdosDataTable', () => ({
  hasResourcePermission: () => true,
  KdosDataTable: (props: any) => <div data-testid="report-table"><span>{props.viewKey}</span><span>{props.columns.map((column: any) => column.title).join('|')}</span></div>
}));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AntApp><RdOrderBomReportPage /></AntApp></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 100 } as never);
});
afterEach(cleanup);

describe('研发中心订单BOM报表页面', () => {
  it('provides three independent views, each using the shared server-side table and view context', async () => {
    mount();
    expect(screen.getByRole('tab', { name: '订单BOM明细报表' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '订单BOM汇总' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '事业部BOM统计' })).toBeInTheDocument();
    expect(await screen.findByText('rd-bom-detail')).toBeInTheDocument();
    expect(screen.getByText(/承接事业部\|订单号\|品号\|品名\|下单日期\|客户交期\|BOM状态\|BOM审核日期\|BOM等待天数\|当前等待天数/)).toBeInTheDocument();
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining('context=%7B%22view%22%3A%22detail%22%7D'), expect.anything()));
    fireEvent.click(screen.getByRole('tab', { name: '订单BOM汇总' }));
    expect(await screen.findByText('rd-bom-orders')).toBeInTheDocument();
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining('context=%7B%22view%22%3A%22orders%22%7D'), expect.anything()));
    fireEvent.click(screen.getByRole('tab', { name: '事业部BOM统计' }));
    expect(await screen.findByText('rd-bom-divisions')).toBeInTheDocument();
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining('context=%7B%22view%22%3A%22divisions%22%7D'), expect.anything()));
  });
});
