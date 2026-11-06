import { useRef, useState } from 'react';
import { Alert, App, Button, DatePicker, Descriptions, Input, Modal, Select, Space, Table } from 'antd';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { mpsQuantityBatchFields, type TablePermissionFieldDefinition, type MpsDemandLinkInfo, MpsQuantityOperation, MpsQuantityPreview, MpsQuantityResult, MpsQuantitySnapshot } from '@kdos/contracts';
import { api } from '../../api';
export function MasterPlanDemandQuantityDialog({ resource, id, onClose, onSaved }: {
    resource: string;
    id: string;
    onClose: () => void;
    onSaved: () => Promise<unknown>;
}) {
    const { message } = App.useApp();
    const busyRef = useRef(false);
    const [operation, setOperation] = useState<MpsQuantityOperation>('INCREASE'), [sourceId, setSource] = useState<string>(), [targetId, setTarget] = useState<string>();
    const [newBatchValues,setNewBatchValues]=useState<Record<string,string>>({});
    const [quantity, setQuantity] = useState(''), [reason, setReason] = useState(''), [preview, setPreview] = useState<MpsQuantityPreview | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false), [receipt, setReceipt] = useState<MpsQuantityResult | null>(null);
    const [key, setKey] = useState(() => crypto.randomUUID());
    const session = localStorage.getItem('sessionUser');
    const query = useQuery({ queryKey: ['mps-demand-quantity', session, resource, id], gcTime: 0, retry: false, refetchOnWindowFocus: false, queryFn: async () => {
            const demandId = resource === 'mps-monthly-plans' ? id : (await api<MpsDemandLinkInfo>(`/master-plan-system/resources/${resource}/${id}/demand-link`)).demandId;
            if (!demandId)
                throw Error('本批次需求关联尚未确认，请先确认需求关联');
            return api<MpsQuantitySnapshot>(`/master-plan-system/demands/${demandId}/quantities`);
        } });
    const createMeta=useQuery({queryKey:['mps-quantity-create-fields',session],enabled:operation==='NEW'&&!sourceId&&query.data?.canCreate===true,gcTime:0,retry:false,refetchOnWindowFocus:false,queryFn:()=>api<{createFields:TablePermissionFieldDefinition[]}>('/master-plan-system/resources/mps-base-plans/meta')});
    const status = useQuery({ queryKey: ['mps-quantity-sync', session, receipt?.outboxId], enabled: !!receipt, queryFn: () => api<{
            status: string;
            last_error?: string;
        }>(`/master-plan-system/demands/${receipt!.demandId}/quantities/status/${receipt!.outboxId}`), refetchInterval: q => ['SUCCESS', 'FAILED', 'BLOCKED', 'DISABLED'].includes(q.state.data?.status ?? '') ? false : 3000, retry: 1 });
    const changed = () => { setPreview(null); setKey(crypto.randomUUID()); setError(null); };
    const request = () => ({ ...(operation==='NEW'&&!sourceId?{newBatchValues}:{}),operation, quantity, sourceId, targetId, expectedDemandVersion: query.data!.demandVersion, expectedVersions: Object.fromEntries(query.data!.batches.map(b => [b.id, b.version])) });
    const prepare = async () => { if (!query.data || busyRef.current)
        return; busyRef.current = true; setBusy(true); setError(null); try {
        setPreview(await api(`/master-plan-system/demands/${query.data.demandId}/quantities/preview`, { method: 'POST', body: JSON.stringify(request()) }));
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        busyRef.current = false;
        setBusy(false);
    } };
    const confirm = async () => { if (!preview || busyRef.current)
        return; busyRef.current = true; setBusy(true); setError(null); try {
        const result = await api<MpsQuantityResult>(`/master-plan-system/demands/${preview.snapshot.demandId}/quantities/confirm`, { method: 'POST', body: JSON.stringify({ ...preview.request, previewHash: preview.previewHash, idempotencyKey: key, reason }) });
        setReceipt(result);
        setPreview(null);
        message.success('数量调整已保存，同步已排队');
        await query.refetch();
        try {
            await onSaved();
        }
        catch {
            message.warning('数量已保存，页面刷新失败，请手动刷新');
        }
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        busyRef.current = false;
        setBusy(false);
    } };
    const snapshot = query.data, opts = snapshot?.batches.map(b => ({ value: b.id, label: `${b.deliveryNumber} · ${b.quantity} · ${b.status}${b.protected ? ' · 已执行/锁定' : ''}` }));
    return <Modal open width={880} title="需求数量与批次分配" footer={null} maskClosable={!busy} closable={!busy} onCancel={() => { if (!busy)
        onClose(); }}>
    <Space direction="vertical" style={{ width: '100%' }}>
      {query.isPending && <span>正在核对数量…</span>}
      {(query.isError || error) && <Alert type="error" showIcon message={error ?? (query.error as Error).message}/>}
      {snapshot && <>
        <Descriptions size="small" column={3} items={[
                ['身份', `${snapshot.orderNumber} / ${snapshot.itemCode}`], ['需求状态', snapshot.status], ['有效需求数量', snapshot.required ?? '待确认'], ['原需求数量', snapshot.originalRequired ?? snapshot.required], ['已确认基础计划量', snapshot.allocated], ['已履约数量', snapshot.fulfilled ?? '待确认'], ['未执行占用', snapshot.remainingReserved ?? '暂不可计算'], ['暂停占用', snapshot.heldReserved ?? '待确认'], ['取消批次已履约', snapshot.cancelledFulfilled ?? '待确认'], ['待分配', snapshot.unallocated ?? '暂不可计算'], ['超额分配', snapshot.overallocated ?? '暂不可计算'], ['关联确认', snapshot.relationStatus === 'CONFIRMED' ? '已确认' : '待确认'], ['数量可信', snapshot.trusted ? '是' : '否'],
            ].map(([label, children]) => ({ key: label, label, children }))}/>
        {snapshot.blockers.map(b => <Alert key={b} type="warning" showIcon message={b}/>)}
        <Table size="small" pagination={false} rowKey="id" dataSource={snapshot.batches} columns={[{ title: '交期编码', dataIndex: 'deliveryNumber' }, { title: '计划数量', dataIndex: 'quantity' }, { title: '状态', dataIndex: 'status' }, { title: '执行保护', render: (_, b) => b.protected ? '受保护' : '无执行事实' }, { title: '数量维护', render: (_, b) => b.manual ? '人工/未确认自动基线' : '自动基线' }]}/>
        {snapshot.canUpdate && !receipt && <>
          <Select aria-label="数量操作" value={operation} disabled={busy} style={{ width: 240 }} onChange={v => { setOperation(v); changed(); }} options={[{ value: 'INCREASE', label: '分配至已有批次' }, { value: 'NEW', label: '分配至新批次', disabled: !snapshot.canCreate }, { value: 'REDUCE', label: '减少未执行超额' }, { value: 'SPLIT', label: '拆出新批次', disabled: !snapshot.canCreate }, { value: 'MERGE', label: '部分安全合批（保留源批次）' }]}/>
          {['REDUCE', 'SPLIT', 'MERGE', 'NEW'].includes(operation) && <Select aria-label="源批次" placeholder={operation === 'NEW' ? '选择新批次的计划属性模板（可选）' : '明确选择源批次'} allowClear options={opts} value={sourceId} disabled={busy} style={{ width: '100%' }} onChange={v => { setSource(v); changed(); }}/>}
          {operation==='NEW'&&!sourceId&&<>
            {createMeta.isFetching&&<span>正在读取新增字段…</span>}
            {createMeta.isError&&<Alert type="error" message={(createMeta.error as Error).message}/>}
            {createMeta.data?.createFields.filter(f=>(mpsQuantityBatchFields as readonly string[]).includes(f.key)).map(f=><div key={f.key}><label>{f.label}</label>{f.type==='date'?<DatePicker aria-label={f.label} value={newBatchValues[f.key]?dayjs(newBatchValues[f.key]):null} disabled={busy} onChange={d=>{setNewBatchValues(v=>({...v,[f.key]:d?.format('YYYY-MM-DD')??''}));changed();}}/>:<Select aria-label={f.label} value={newBatchValues[f.key]} options={f.options} disabled={busy} style={{width:220}} onChange={v=>{setNewBatchValues(x=>({...x,[f.key]:v}));changed();}}/>}</div>)}
          </>}
          {['INCREASE', 'MERGE'].includes(operation) && <Select aria-label="目标批次" placeholder="明确选择目标批次" options={opts} value={targetId} disabled={busy} style={{ width: '100%' }} onChange={v => { setTarget(v); changed(); }}/>}
          <Input aria-label="调整数量" value={quantity} disabled={busy} placeholder="调整数量（最多4位小数）" onChange={e => { setQuantity(e.target.value); changed(); }}/>
          <Input.TextArea aria-label="数量调整原因" value={reason} disabled={busy} maxLength={1000} placeholder="变更原因" onChange={e => { setReason(e.target.value); setKey(crypto.randomUUID()); }}/>
          <Button loading={busy} disabled={!snapshot.trusted || !quantity || !reason.trim()} onClick={() => void prepare()}>预览数量调整</Button>
          {preview && <>
            {preview.blockers.map(b => <Alert key={b} type="warning" message={b}/>)}
            {preview.afterBalance && <Alert type="info" message={`调整后：基础计划量 ${preview.afterBalance.allocated}；待分配 ${preview.afterBalance.unallocated??'待确认'}；超额 ${preview.afterBalance.overallocated??'待确认'}`}/>}
                            {preview.changes.map(c => <div key={c.id}>{c.id === 'NEW' ? '新增批次' : snapshot.batches.find(b => b.id === c.id)?.deliveryNumber}：{c.before} → {c.after}</div>)}
            <Button type="primary" loading={busy} disabled={!preview.allowed || !reason.trim()} onClick={() => void confirm()}>确认数量调整</Button>
          </>}
        </>}
      </>}
      {receipt && <Alert type={status.data?.status === 'SUCCESS' ? 'success' : status.data?.status === 'FAILED' ? 'error' : 'info'} showIcon message={`数量已保存；下游同步：${status.data?.status ?? receipt.syncStatus}`} description={status.isError ? '同步状态读取失败，请重新检查同步记录' : status.data?.last_error ?? '保存与下游执行结果分别记录。'}/>}
    </Space>
  </Modal>;
}
