import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App as AntApp, Button, DatePicker, Form, Input, Modal, Select, Space, Tooltip, Upload } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { logisticsBusinessFields, logisticsDetailKeys, logisticsFeeKeys, logisticsResource as resource, type LogisticsImportPreview } from '@kdos/contracts';
import { api } from '../../api';
import { downloadApiFile, InlineText } from '../../shared/legacy-ui';
import { KdosDataTable, hasResourcePermission, hasFieldPermission, kdosDefaultPageSize, useKdosTableEditMode } from '../../shared/KdosDataTable';
import type { AdvancedFilterGroup } from '../../shared/advanced-filter';

type LedgerRow = Record<string, unknown> & { id: string; version: number };
type References = { customers: Array<{ code: string }>; members: Array<{ id: string; username: string; displayName: string; enabled?: boolean }> };
type LedgerQuery = { page: number; pageSize: number; search: string; filterGroup?: AdvancedFilterGroup; sortField?: string; sortOrder?: 'asc' | 'desc' };
const endpoint = '/marketing/logistics-ledger';
const canWrite = (key: string) => key !== 'totalFee' && hasFieldPermission(resource, key, 'update');
const canRead = (key: string) => hasFieldPermission(resource, key, 'read') && (key !== 'totalFee' || logisticsFeeKeys.every(k => hasFieldPermission(resource, k, 'read')));
function Editor({ field, value, references, save }: { field: string; value: unknown; references: References; save: (value: string | null) => Promise<void> }) {
  const { editing } = useKdosTableEditMode();
  const [saving, setSaving] = useState(false); const lock = useRef(false);
  const commit = async (next: string | null) => { if (lock.current) return; lock.current = true; setSaving(true); try { await save(next); } finally { setSaving(false); lock.current = false; } };
  if (field === 'ownerUserId') {
    const user = references.members.find(u => u.id === value);
    if (!editing || !canWrite(field)) return <span>{user ? `${user.displayName} (${user.username})` : value ? '用户已停用或移除' : '—'}</span>;
    return <Select aria-label="物流负责人" allowClear showSearch optionFilterProp="label" value={value as string ?? undefined} loading={saving} style={{ minWidth: 180 }} options={references.members.map(u => ({ value: u.id, label: `${u.displayName} (${u.username})`, disabled: u.enabled === false }))} onChange={v => void commit(v ?? null).catch(() => undefined)} />;
  }
  if (!editing || !canWrite(field)) return <span>{value == null || value === '' ? '—' : String(value).slice(0, field === 'shipmentDate' ? 10 : undefined)}</span>;
  if (field === 'customerCode') return <Select aria-label="客户" allowClear showSearch value={value as string ?? undefined} loading={saving} style={{ minWidth: 130 }} options={references.customers.map(c => ({ value: c.code, label: c.code }))} onChange={v => void commit(v ?? null).catch(() => undefined)} />;
  if (field === 'shipmentDate') return <DatePicker aria-label="出运日期" format="YYYY-MM-DD" value={value ? dayjs(String(value)) : null} disabled={saving} onChange={d => void commit(d?.format('YYYY-MM-DD') ?? null).catch(() => undefined)} />;
  return <InlineText value={value} onSave={v => commit(v === '' ? null : String(v)).catch(() => undefined)} />;
}
export function LogisticsLedgerPage() {
  const { message } = AntApp.useApp();
  const [dialogError, setDialogError] = useState('');
  const queryClient = useQueryClient();
  const [query, setQuery] = useState<LedgerQuery>({ page: 1, pageSize: kdosDefaultPageSize, search: '' });
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<LogisticsImportPreview>();
  const [importing, setImporting] = useState(false); const importLock = useRef(false);
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit' | 'detail'; row?: LedgerRow; commandKey: string }>();
  const [saving, setSaving] = useState(false); const saveLock = useRef(false); const [form] = Form.useForm();
  const params = new URLSearchParams({ resource, page: String(query.page), pageSize: String(query.pageSize), search: query.search });
  if (query.filterGroup) params.set('filterGroup', JSON.stringify(query.filterGroup));
  if (query.sortField) params.set('sortField', query.sortField);
  if (query.sortOrder) params.set('sortOrder', query.sortOrder);
  const rows = useQuery({ queryKey: [resource, query], queryFn: () => api<{ rows: LedgerRow[]; total: number }>(`/table-filters/rows?${params}`) });
  const summary = useQuery({ queryKey: [resource, 'summary', query.search, query.filterGroup], queryFn: () => api<{ containers: number; fees: Record<string, string | null> }>(`${endpoint}/summary?${params}`) });
  const directory = useQuery({ queryKey: [resource, 'references'], queryFn: () => api<References>(`${endpoint}/references`) });
  const references = directory.data ?? { customers: [], members: [] };
  const refresh = () => void queryClient.invalidateQueries({ queryKey: [resource] });
  const patch = async (row: LedgerRow, key: string, value: string | null) => {
    try { await api(`${endpoint}/${row.id}`, { method: 'PATCH', body: JSON.stringify({ expectedVersion: row.version, values: { [key]: value } }) }); refresh(); }
    catch (e) { message.error((e as Error).message); refresh(); throw e; }
  };
  const columns: ColumnsType<LedgerRow> = [...logisticsBusinessFields.filter(f => canRead(f.key)).map(f => ({
    key: f.key, dataIndex: f.key, title: f.label, width: f.key === 'remark' ? 250 : 170,
    render: (value: unknown, row: LedgerRow) => <Editor field={f.key} value={value} references={references} save={v => patch(row, f.key, v)} />
  })), { key: 'orderNumbers', dataIndex: 'orderNumbers', title: '关联订单汇总', width: 250 }];
  const open = (mode: 'create' | 'edit' | 'detail', row?: LedgerRow) => {
    form.resetFields(); setDialogError('');
    if (mode === 'edit' && row) form.setFieldsValue({ ...row, shipmentDate: row.shipmentDate ? dayjs(String(row.shipmentDate)) : null });
    setDialog({ mode, row, commandKey: crypto.randomUUID() });
  };
  const save = async () => {
    if (saveLock.current || !dialog) return; saveLock.current = true;
    try {
      const raw = await form.validateFields(); setSaving(true);
      const values = Object.fromEntries(Object.entries(raw).filter(([k]) => canWrite(k)).map(([key, value]) => [key, key === 'shipmentDate' ? (value as dayjs.Dayjs | null)?.format('YYYY-MM-DD') ?? null : value ?? null]));
      if (dialog.mode === 'edit') {
        const changed = Object.fromEntries(Object.entries(values).filter(([key, value]) => String(value ?? '') !== String(dialog.row![key] ?? '').slice(0, key === 'shipmentDate' ? 10 : undefined)));
        if (Object.keys(changed).length) await api(`${endpoint}/${dialog.row!.id}`, { method: 'PATCH', body: JSON.stringify({ expectedVersion: dialog.row!.version, values: changed }) });
      } else if (dialog.mode === 'detail') await api(`${endpoint}/${dialog.row!.id}/details`, { method: 'POST', body: JSON.stringify({ expectedVersion: dialog.row!.version, values }) });
      else await api(endpoint, { method: 'POST', body: JSON.stringify({ values, commandKey: dialog.commandKey }) });
      setDialog(undefined); refresh(); message.success('已保存');
    } catch (e) { if (!(e && typeof e === 'object' && 'errorFields' in e)) { setDialogError((e as Error).message); message.error((e as Error).message); } }
    finally { saveLock.current = false; setSaving(false); }
  };
  const upload = async (file: File) => {
    if (importLock.current) return; importLock.current = true; setImporting(true); setError(''); setPreview(undefined);
    try { const body = new FormData(); body.append('file', file); setPreview(await api<LogisticsImportPreview>(`${endpoint}/import-preview`, { method: 'POST', body })); }
    catch (e) { setError((e as Error).message); } finally { setImporting(false); importLock.current = false; }
  };
  const confirm = async () => {
    if (importLock.current || !preview?.token) return; importLock.current = true; setImporting(true); setError('');
    try { const result = await api<{ shipments: number; details: number; repeated: boolean }>(`${endpoint}/import-confirm`, { method: 'POST', body: JSON.stringify({ token: preview.token }) }); message.success(`${result.repeated ? '已导入，无需重复写入' : '导入成功'}：${result.shipments}柜，${result.details}条明细`); setPreview(undefined); refresh(); }
    catch (e) { setError((e as Error).message); } finally { setImporting(false); importLock.current = false; }
  };
  const formFields = logisticsBusinessFields.filter(f => f.editable && canWrite(f.key) && (dialog?.mode !== 'detail' || logisticsDetailKeys.includes(f.key as typeof logisticsDetailKeys[number])));
  return <div>
    {(error || rows.error || directory.error || summary.error) && <Alert type="error" showIcon closable onClose={() => setError('')} message={error || (rows.error as Error)?.message || (directory.error as Error)?.message || (summary.error as Error)?.message} />}
    <KdosDataTable<LedgerRow> resource={resource} rowKey="id" editable columns={columns} dataSource={rows.data?.rows ?? []} loading={rows.isLoading} serverData={{ total: rows.data?.total ?? 0, onQueryChange: setQuery }} scroll={{ x: 'max-content' }} searchPlaceholder="搜索物流单号、柜号、款号或订单"
      toolbar={<Space wrap>
        {hasResourcePermission(resource, 'create') && <Button type="primary" onClick={() => open('create')}>新增</Button>}
        {hasResourcePermission(resource, 'import') && <><Button onClick={() => void downloadApiFile(`${endpoint}/import-template`, 'marketing_logistics_template.xlsx').catch(e => setError(e.message))}>下载模板</Button><Upload accept=".xls,.xlsx" showUploadList={false} beforeUpload={file => { void upload(file); return false; }}><Button loading={importing}>导入 Excel</Button></Upload></>}
        <Tooltip title="费用属于整柜；关联订单不分摊费用。导出和打印同柜费用只列一次。"><span style={{ color: '#666' }}>费用按整柜记录</span></Tooltip>
      </Space>}
      selectionActions={selection => <Space>
        {hasResourcePermission(resource, 'update') && <Button disabled={selection.selectedRows.length !== 1} onClick={() => open('edit', selection.selectedRows[0])}>编辑所选</Button>}
        {hasResourcePermission(resource, 'create') && <Button disabled={selection.selectedRows.length !== 1} onClick={() => open('detail', selection.selectedRows[0])}>同柜增加款号</Button>}
      </Space>}
      deleteAction={hasResourcePermission(resource, 'delete') ? { permitted: true, confirmTitle: n => `确认删除${n}条装柜明细？删除最后一条时同时删除该物流单。`, onDelete: async selected => {
        await api(`${endpoint}/delete`, { method: 'POST', body: JSON.stringify({ rows: selected.map(r => ({ id: r.id, expectedVersion: r.version })) }) }); refresh(); return { deletedKeys: selected.map(r => r.id), message: '已删除' };
      } } : undefined} />
    {summary.data && <div style={{ padding: '8px 16px', color: '#666' }}>匹配 {summary.data.containers} 柜{Object.entries(summary.data.fees ?? {}).filter(([key]) => canRead(key)).map(([key, value]) => <span key={key} style={{ marginLeft: 16 }}>{logisticsBusinessFields.find(f => f.key === key)?.label}{key === 'totalFee' ? '' : '合计'}：{value ?? '—'}</span>)}</div>}
    <Modal title={dialog?.mode === 'edit' ? '编辑物流记录' : dialog?.mode === 'detail' ? `增加款号 · ${dialog.row?.logisticsNumber ?? ''}` : '新增物流记录'} open={Boolean(dialog)} width={800} onCancel={() => !saving && setDialog(undefined)} onOk={() => void save()} confirmLoading={saving} destroyOnHidden>
      {dialogError && <Alert type="error" showIcon message={dialogError} />}
      <Form form={form} layout="vertical" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 20 }}>
        {formFields.map(f => <Form.Item key={f.key} name={f.key} label={f.label} rules={f.required ? [{ required: true, whitespace: true, message: `请填写${f.label}` }] : []}>
          {f.key === 'ownerUserId' ? <Select allowClear showSearch optionFilterProp="label" options={references.members.map(u => ({ value: u.id, label: `${u.displayName} (${u.username})`, disabled: u.enabled === false }))} />
            : f.key === 'customerCode' ? <Select allowClear showSearch options={references.customers.map(c => ({ value: c.code, label: c.code }))} />
              : f.type === 'date' ? <DatePicker format="YYYY-MM-DD" style={{ width: '100%' }} /> : <Input inputMode={f.type === 'number' ? 'decimal' : 'text'} />}
        </Form.Item>)}
      </Form>
    </Modal>
    <Modal title="物流台账导入预览" open={Boolean(preview)} width={1100} onCancel={() => !importing && setPreview(undefined)} onOk={() => void confirm()} confirmLoading={importing} okText="确认导入" cancelText="取消" okButtonProps={{ disabled: !preview?.token || Boolean(preview?.errors.length) }}>
      {error && <Alert type="error" message={error} showIcon />}
      <p>{preview?.shipments ?? 0} 柜，{preview?.total ?? 0} 条明细；任何错误都不会部分写入。预览显示前50行。</p>
      {Boolean(preview?.errors.length) && <KdosDataTable resource="logistics-import-errors" systemFields={false} simple rowKey={r => `${r.row}:${r.field}:${r.reason}`} dataSource={preview?.errors ?? []} columns={[{ title: 'Excel行号', dataIndex: 'row', width: 90 }, { title: '字段', dataIndex: 'field', width: 100 }, { title: '原因', dataIndex: 'reason' }, { title: '原始冲突值', dataIndex: 'values', render: (values?: Array<{ row: number; value: string }>) => values?.map(v => `第${v.row}行：${v.value}`).join('；') }]} />}
      <KdosDataTable resource="logistics-import-preview" systemFields={false} simple rowKey="row" dataSource={preview?.rows ?? []} columns={[{ title: 'Excel行号', dataIndex: 'row', width: 90 }, ...logisticsBusinessFields.filter(f => f.key !== 'totalFee').map(f => ({ title: f.label, key: f.key, width: 150, render: (_: unknown, r: { values: Record<string, unknown> }) => f.key === 'ownerUserId' ? references.members.find(u => u.id === r.values[f.key])?.displayName ?? String(r.values[f.key] ?? '') : String(r.values[f.key] ?? '') }))]} scroll={{ x: 'max-content' }} />
    </Modal>
  </div>;
}
