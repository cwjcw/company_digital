import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { RdOrderBomReportPage } from './RdOrderBomReportPage';
import { formatRdBomDate } from './rd-bom-report-display';

vi.mock('../../api', () => ({ api: vi.fn(), ApiError: class ApiError extends Error {} }));
vi.mock('../../shared/KdosDataTable', () => ({
  hasResourcePermission: () => true,
  KdosDataTable: (props: any) => <div data-testid="report-table">
    <span>{props.viewKey}</span>
    <span data-testid="column-titles">{props.columns.map((column: any) => column.title).join('|')}</span>
    <span data-testid="column-alignments">{props.columns.map((column: any) => column.align).join('|')}</span>
    <span data-testid="date-render">{props.columns.find((column: any) => column.key === 'orderDate')?.render?.('2026-11-10 14:52:36')}</span>
    <span data-testid="empty-date-render">{JSON.stringify(props.columns.find((column: any) => column.key === 'customerDueDate')?.render?.(null))}</span>
  </div>
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
    expect(screen.getByRole('tab', { name: '订单BOM明细' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '订单BOM汇总' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '事业部BOM统计' })).toBeInTheDocument();
    expect(await screen.findByText('rd-bom-detail')).toBeInTheDocument();
    expect(screen.getByTestId('column-titles')).toHaveTextContent('承接事业部|订单号|品号|品名|下单日期|客户交期|BOM状态|BOM审核日期|BOM等待天数|当前等待天数');
    expect(screen.getByTestId('column-alignments')).toHaveTextContent(/^center(\|center)*$/);
    expect(screen.getByTestId('date-render')).toHaveTextContent('2026-11-10');
    expect(screen.getByTestId('empty-date-render')).toHaveTextContent('""');
    expect(screen.queryByText('订单BOM报表')).not.toBeInTheDocument();
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining('context=%7B%22view%22%3A%22detail%22%7D'), expect.anything()));
    fireEvent.click(screen.getByRole('tab', { name: '订单BOM汇总' }));
    expect(await screen.findByText('rd-bom-orders')).toBeInTheDocument();
    expect(screen.getByTestId('column-alignments').textContent?.split('|').every(value => value === 'center')).toBe(true);
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining('context=%7B%22view%22%3A%22orders%22%7D'), expect.anything()));
    fireEvent.click(screen.getByRole('tab', { name: '事业部BOM统计' }));
    expect(await screen.findByText('rd-bom-divisions')).toBeInTheDocument();
    expect(screen.getByTestId('column-alignments').textContent?.split('|').every(value => value === 'center')).toBe(true);
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining('context=%7B%22view%22%3A%22divisions%22%7D'), expect.anything()));
  });

  it('converts timezone-bearing instants to the Shanghai calendar day without shifting local calendar values', async () => {
    mount();
    expect(await screen.findByText('rd-bom-detail')).toBeInTheDocument();
    expect(screen.getByTestId('date-render')).toHaveTextContent('2026-11-10');
    // The component's date formatter is also used by date columns carrying explicit offsets.
    expect(formatRdBomDate('2026-11-09T16:30:00.000Z')).toBe('2026-11-10');
    expect(formatRdBomDate('2026-11-10 00:00:00')).toBe('2026-11-10');
  });
});
