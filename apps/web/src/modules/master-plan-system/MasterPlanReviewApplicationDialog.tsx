import { useRef, useState } from 'react';
import { Alert, App, Button, Descriptions, Input, Modal, Space, Table, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { MpsReviewApplicationInfo, MpsReviewApplyPreview, MpsReviewApplyResult } from '@kdos/contracts';
import { api } from '../../api';
import { MasterPlanDemandLinkDialog } from './MasterPlanDemandLinkDialog';
export function MasterPlanReviewApplicationDialog({ id, onClose, onSaved }: {
    id: string;
    onClose: () => void;
    onSaved: () => Promise<unknown>;
}) {
    const { message } = App.useApp(), lock = useRef(false);
    const [selected, setSelected] = useState<string[]>([]), [reason, setReason] = useState(''), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [preview, setPreview] = useState<MpsReviewApplyPreview | null>(null), [receipt, setReceipt] = useState<MpsReviewApplyResult | null>(null), [bind, setBind] = useState(false), [key, setKey] = useState(() => crypto.randomUUID());
    const session = localStorage.getItem('sessionUser'), root = `/master-plan-system/review-due-dates/${id}/applications`;
    const query = useQuery({ queryKey: ['review-application', session, id], queryFn: () => api<MpsReviewApplicationInfo>(root), retry: false, refetchOnWindowFocus: false, gcTime: 0 });
    const status = useQuery({ queryKey: ['review-application-sync', session, receipt?.outboxId], enabled: !!receipt?.outboxId, queryFn: () => api<{
            status: string;
            last_error?: string;
        }>(`${root}/${receipt!.outboxId}/status`), retry: 1, refetchInterval: q => ['SUCCESS', 'FAILED', 'BLOCKED', 'DISABLED'].includes(q.state.data?.status ?? '') ? false : 3000 });
    const changed = () => { setPreview(null); setKey(crypto.randomUUID()); setError(null); setReceipt(null); };
    const prepare = async () => { if (!query.data || lock.current)
        return; lock.current = true; setBusy(true); setError(null); try {
        setPreview(await api(`${root}/preview`, { method: 'POST', body: JSON.stringify({ expectedReviewVersion: query.data.reviewVersion, targets: query.data.candidates.filter(c => selected.includes(c.id)).map(c => ({ baseId: c.id, expectedVersion: c.version })) }) }));
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        lock.current = false;
        setBusy(false);
    } };
    const confirm = async () => { if (!preview || lock.current)
        return; lock.current = true; setBusy(true); setError(null); try {
        const result = await api<MpsReviewApplyResult>(`${root}/confirm`, { method: 'POST', body: JSON.stringify({ ...preview.request, previewHash: preview.previewHash, idempotencyKey: key, reason }) });
        setReceipt(result);
        setPreview(null);
        message.success(result.outboxId ? '评审批次应用已保存，同步已排队' : '该版本已有应用证据，未重复写入');
        await query.refetch();
        try {
            await onSaved();
        }
        catch {
            message.warning('应用已保存，页面刷新失败，请手动刷新');
        }
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        lock.current = false;
        setBusy(false);
    } };
    return <Modal open title="关联基础计划 / 应用交期" width={1120} footer={null} closable={!busy} maskClosable={!busy} onCancel={() => { if (!lock.current)
        onClose(); }}><Space direction="vertical" style={{ width: '100%' }}>
  {query.isPending && <span>正在核对评审及基础批次…</span>}{(query.isError || error) && <Alert type="error" showIcon message={error ?? (query.error as Error).message}/>}
  {query.data && <>
   <Descriptions column={3} size="small" items={[
                ['订单号', query.data.orderNumber], ['品项编码', query.data.itemCode], ['事业部', query.data.divisionName ?? '待确认'], ['需求关联', query.data.demandId ?? '尚未确认'], ['评审批次号', query.data.batchNumber], ['评审版本', String(query.data.reviewVersion)], ['最新评审交期', query.data.reviewDate ?? '未填写'], ['客户交期（本次不修改）', query.data.customerDate ?? '未填写']
            ].map(([label, children]) => ({ key: label, label, children }))}/>
   <Alert type="info" message="仅将最新评审交期应用到明确勾选的基础批次；客户交期保持不变。评审批次号不作为自动匹配依据。"/>
   {query.data.blockers.map(b => <Alert type="warning" key={b} message={b}/>)}
   {!query.data.demandId && query.data.canBind && <Button disabled={busy} onClick={() => setBind(true)}>确认需求关联</Button>}
   <Table rowKey="id" size="small" pagination={false} dataSource={query.data.candidates} rowSelection={query.data.canApply ? { selectedRowKeys: selected, onChange: keys => { setSelected(keys.map(String)); changed(); }, getCheckboxProps: c => ({ disabled: busy || !c.canUpdate || c.status !== 'ACTIVE' || c.otherReview, 'aria-label': `选择批次${c.deliveryNumber}` }) } : undefined} columns={[
                { title: '基础交期编码', dataIndex: 'deliveryNumber' }, { title: '计划数量', dataIndex: 'quantity' }, { title: '客户交期', dataIndex: 'customerDate' }, { title: '当前评审交期', dataIndex: 'reviewDate' }, { title: '状态', dataIndex: 'status' }, { title: '执行/工艺保护', render: (_, r) => r.protected ? '已有事实或锁定（保留工艺快照）' : '无执行事实' },
                { title: '已应用版本', render: (_, r) => r.appliedVersion ?? '尚未应用' }, { title: '待应用', render: (_, r) => r.otherReview ? <Tag color="warning">已采用其他评审</Tag> : r.pending ? <Tag color="processing">有新评审待应用</Tag> : '—' }
            ]}/>
   {query.data.canApply && <>
    <Input.TextArea aria-label="评审应用原因" placeholder="应用原因" maxLength={1000} value={reason} disabled={busy} onChange={e => { setReason(e.target.value); setKey(crypto.randomUUID()); }}/>
    <Button disabled={busy} onClick={() => { changed(); void query.refetch(); }}>刷新评审与批次版本</Button>
    <Button loading={busy} disabled={query.isFetching || !selected.length || !reason.trim() || query.data.blockers.length > 0} onClick={() => void prepare()}>预览应用交期</Button>
    {preview && <>{preview.blockers.map(b => <Alert key={b} type="warning" message={b}/>)}{preview.changes.map(c => <div key={c.baseId}>基础批次{c.deliveryNumber}：{c.before ?? '未填写'} → {c.after}</div>)}<Button type="primary" loading={busy} disabled={!preview.allowed || !reason.trim()} onClick={() => void confirm()}>确认应用所选批次</Button></>}
   </>}
   {receipt && <Alert type={status.data?.status === 'FAILED' ? 'error' : status.data?.status === 'SUCCESS' ? 'success' : 'info'} showIcon message={`应用已保存；下游同步：${status.data?.status ?? receipt.syncStatus}`} description={status.isError ? '同步状态读取失败，请检查同步记录' : status.data?.last_error ?? (receipt.syncStatus === 'NO_CHANGE' ? '未新增应用，各批次历史同步状态见下表。' : undefined)}/>}
   <Table rowKey="id" size="small" pagination={{ pageSize: 10 }} dataSource={query.data.history} columns={[{ title: '基础批次', dataIndex: 'deliveryNumber' }, { title: '实际应用版本', dataIndex: 'reviewVersion' }, { title: '实际应用日期快照', dataIndex: 'date' }, { title: '应用时间', dataIndex: 'appliedAt' }, { title: '下游同步状态', dataIndex: 'syncStatus' }]}/>
  </>}
  {bind && <MasterPlanDemandLinkDialog resource="mps-review-due-dates" id={id} onClose={() => setBind(false)} onSaved={async () => { changed(); await query.refetch(); }}/>}
 </Space></Modal>;
}
