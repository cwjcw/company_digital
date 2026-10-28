import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { message, ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { logisticsBusinessFields, logisticsResource as resource } from '@kdos/contracts';
import { api } from '../../api';
import { LogisticsLedgerPage } from './LogisticsLedgerPage';
vi.mock('../../api', async () => ({ ...(await vi.importActual('../../api')), api: vi.fn() }));
const clients: QueryClient[] = [];
let ledger: Record<string, unknown>[];
let preview: Record<string, unknown>;
let writes: Array<{ url: string; body: any }>;
let holdSave = false; let releaseSave: () => void;
function page() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client); return render(<QueryClientProvider client={client}><ConfigProvider locale={zhCN}><AntApp><MemoryRouter><LogisticsLedgerPage /></MemoryRouter></AntApp></ConfigProvider></QueryClientProvider>); }
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('sessionUser', JSON.stringify({ id: 'user', permissions: ['*'] }));
  ledger = [{ id: 'detail-1', version: 2, logisticsNumber: '0001', styleNumber: 'STYLE-A', portFee: '0.1', totalFee: '0.3' }];
  preview = { total: 1, shipments: 1, errors: [], rows: [{ row: 3, values: { logisticsNumber: '0002', styleNumber: 'STYLE-B' } }], token: 'signed-token' }; writes = []; holdSave = false;
  vi.mocked(api).mockImplementation(async (url, init) => {
    if (url.startsWith('/table-filters/rows')) return { rows: ledger, total: ledger.length } as never;
    if (url.includes('/summary?')) return {containers:1,fees:{totalFee:'0.3'}} as never;
    if (url.endsWith('/references')) return { customers: [{ code: 'C001' }], members: [{ id: 'user', username: 'test', displayName: '测试人' }] } as never;
    if (url === '/table-filters/resources') return [{ code: resource, filterableFields: logisticsBusinessFields.map(f => f.key) }] as never;
    if (url.endsWith('/import-preview')) return preview as never;
    if (init?.method && ['POST', 'PATCH'].includes(init.method)) {
      writes.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
      if (holdSave) await new Promise<void>(resolve => { releaseSave = resolve; });
      return { id: 'new', version: 1, shipments: 1, details: 1 } as never;
    }
    return [] as never;
  });
});
afterEach(async () => { await act(async () => { cleanup(); message.destroy(); for (const c of clients) { await c.cancelQueries(); c.clear(); } clients.length = 0; }); vi.clearAllMocks(); });
describe('物流台账页面', () => {
  it('使用标准表格展示23业务列，费用合计无编辑输入', async () => {
    page(); await screen.findByText('STYLE-A');
    for (const f of logisticsBusinessFields) expect(screen.getAllByText(f.label).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^新\s*增$/ })).toBeVisible();
    expect(screen.getByText('0.3')).toBeVisible(); expect(document.querySelector('input[value="0.3"]')).toBeNull();
  });
  it('新增必填提示明确，不带只读费用合计；重复点击只提交一次', async () => {
    page(); await screen.findByText('STYLE-A'); fireEvent.click(screen.getByRole('button', { name: /^新\s*增$/ }));
    const dialog = screen.getByRole('dialog', { name: '新增物流记录' });
    fireEvent.click(within(dialog).getByRole('button', { name: /确\s*定/ }));
    await within(dialog).findByText('请填写物流单号'); expect(writes).toHaveLength(0);
    fireEvent.change(within(dialog).getByLabelText('物流单号'), { target: { value: '0009' } });
    fireEvent.change(within(dialog).getByLabelText('款号'), { target: { value: 'STYLE-X' } });
    holdSave = true; const button = within(dialog).getByRole('button', { name: /确\s*定/ }); fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(writes).toHaveLength(1)); expect(writes[0]!.body.values).toMatchObject({ logisticsNumber: '0009', styleNumber: 'STYLE-X' }); expect(writes[0]!.body.values).not.toHaveProperty('totalFee');
    await act(async () => releaseSave()); await waitFor(() => expect(screen.queryByRole('dialog', { name: '新增物流记录' })).toBeNull());
  });
  it('导入预览可以确认，无fields等其他模块属性不会白屏', async () => {
    const view = page(); await screen.findByText('STYLE-A');
    const input = view.container.querySelector('input[type=file]')!;
    fireEvent.change(input, { target: { files: [new File(['synthetic'], 'fixture.xls')] } });
    const dialog = await screen.findByRole('dialog', { name: '物流台账导入预览' }); await waitFor(() => expect(within(dialog).getByText('STYLE-B')).toBeVisible());
    fireEvent.click(within(dialog).getByRole('button', { name: '确认导入' }));
    await waitFor(() => expect(writes.some(w => w.url.endsWith('/import-confirm') && w.body.token === 'signed-token')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '物流台账导入预览' })).toBeNull());
  });
  it('冲突预览显示行号与原始值，禁用确认，取消保留页面', async () => {
    preview = { ...preview, token: null, errors: [{ row: 4, field: '备注', reason: '整柜字段冲突', values: [{ row: 3, value: '原备注' }, { row: 4, value: '另一备注' }] }] };
    const view = page(); await screen.findByText('STYLE-A'); fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [new File(['synthetic'], 'fixture.xlsx')] } });
    const dialog = await screen.findByRole('dialog', { name: '物流台账导入预览' }); expect(within(dialog).getByRole('button', { name: '确认导入' })).toBeDisabled(); await waitFor(() => expect(within(dialog).getByText(/第3行：原备注；第4行：另一备注/)).toBeVisible());
    fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(screen.getByText('STYLE-A')).toBeVisible(); expect(writes).toHaveLength(0);
  });
  it('无操作/费用字段权限时隐藏相应操作及费用列', async () => {
    localStorage.setItem('sessionUser', JSON.stringify({ permissions: [`${resource}:*:read`, `${resource}:logisticsNumber:read`, `${resource}:styleNumber:read`, `${resource}:totalFee:read`] })); page(); await screen.findByText('STYLE-A');
    expect(screen.queryByRole('button', { name: /^新\s*增$/ })).toBeNull(); expect(screen.queryByText('费用合计')).toBeNull(); expect(screen.queryByText('港杂费')).toBeNull(); expect(screen.queryByRole('button', { name: '导入 Excel' })).toBeNull();
  });
  it('网页新增的API校验失败在表单内明确展示，保留用户输入', async () => {
    const base = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (url, init) => { if (url === '/marketing/logistics-ledger' && init?.method === 'POST') throw new Error('客户编码不存在'); return base(url, init); });
    page(); await screen.findByText('STYLE-A'); fireEvent.click(screen.getByRole('button', {name:/^新\s*增$/}));
    const dialog = await screen.findByRole('dialog', {name:'新增物流记录'}); fireEvent.change(within(dialog).getByLabelText('物流单号'), {target:{value:'ERROR-1'}}); fireEvent.click(within(dialog).getByRole('button', {name:/确\s*定/}));
    await within(dialog).findByText('客户编码不存在'); expect(within(dialog).getByLabelText('物流单号')).toHaveValue('ERROR-1');
  });
  it('API失败会提示而不会关闭表单或产生白屏', async () => {
    const base = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (url, init) => { if (url.endsWith('/import-confirm')) throw new Error('当前权限组不能填写港杂费'); return base(url, init); });
    const view = page(); await screen.findByText('STYLE-A'); fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [new File(['test'], 'fixture.xlsx')] } });
    const dialog = await screen.findByRole('dialog', { name: '物流台账导入预览' }); fireEvent.click(within(dialog).getByRole('button', { name: '确认导入' }));
    await within(dialog).findByText('当前权限组不能填写港杂费'); expect(screen.getByText('STYLE-A')).toBeVisible();
  });
});
