import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Descriptions, Input, Modal, Space, Spin } from 'antd';
import { masterPlanResourceDefinitions, mpsLifecycleOperations, mpsPlanLifecycleOptions, type MpsLifecycleOperation, type MpsLifecyclePreview } from '@kdos/contracts';
import { api } from '../../api';

const statusLabel = (value: string) => mpsPlanLifecycleOptions.find(s => s.value === value)?.label ?? value;

/** Mounted per selected record/operation; no write occurs until a current preview is confirmed. */
export function MasterPlanLifecycleDialog({ resource, id, operation, onClose, onCompleted }: {
  resource: string; id: string; operation: MpsLifecycleOperation; onClose: () => void; onCompleted: () => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const command = useRef<{ key: string; body: string } | null>(null);
  const preview = useQuery({
    queryKey: ['mps-lifecycle-preview', resource, id, operation],
    queryFn: () => api<MpsLifecyclePreview>(`/master-plan-system/resources/${resource}/${id}/lifecycle/preview`, {
      method: 'POST', body: JSON.stringify({ operation })
    }),
    gcTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: false
  });
  const data = preview.data;
  const confirm = async () => {
    if (!data?.allowed || !reason.trim() || submitting.current) return;
    submitting.current = true; setSaving(true); setError(null);
    const body = JSON.stringify({ operation, expectedVersion: data.expectedVersion, previewToken: data.previewToken, reason: reason.trim() });
    // An uncertain transport result reuses the same key and payload; a changed preview/reason gets a new key.
    if (command.current?.body !== body) command.current = { key: crypto.randomUUID(), body };
    try {
      await api(`/master-plan-system/resources/${resource}/${id}/lifecycle/confirm`, {
        method: 'POST', body: JSON.stringify({ ...JSON.parse(body), idempotencyKey: command.current.key })
      });
      await onCompleted(); onClose();
    } catch (failure) { setError((failure as Error).message); }
    finally { submitting.current = false; setSaving(false); }
  };
  return <Modal open title={mpsLifecycleOperations[operation].label} onCancel={() => { if (!submitting.current) onClose(); }}
    maskClosable={false} closable={!saving} confirmLoading={saving} cancelButtonProps={{ disabled: saving }}
    okText="确认执行" okButtonProps={{ disabled: !data?.allowed || !reason.trim() || preview.isFetching }} onOk={() => void confirm()}>
    <Space direction="vertical" style={{ width: '100%' }}>
      <Alert type="info" showIcon message="仅变更计划状态，保留原计划、报工及工艺。恢复不会补建或重放同步任务。" />
      {preview.isPending && <Spin aria-label="正在检查计划风险" />}
      {preview.error && <Alert type="error" showIcon message={(preview.error as Error).message} />}
      {data && <>
        <Descriptions column={1} size="small" items={[
          { key: 'order', label: '订单 / 品号', children: `${data.orderNumber} / ${data.itemCode}` },
          { key: 'division', label: '事业部', children: data.divisionName ?? '未确认' },
          { key: 'state', label: '状态', children: `${statusLabel(data.currentStatus)} → ${statusLabel(data.targetStatus)}` },
          { key: 'quantity', label: '计划数量', children: data.plannedQuantity },
          { key: 'reports', label: '已报工', children: `${data.facts.reportCount} 笔，数量合计 ${data.facts.reportedQuantity}` },
          { key: 'dependencies', label: '关联情况', children: `入库：${data.facts.hasInbound ? '有' : '无已确认事实'}；外协：${data.facts.outsourcingDependencies}；工单：${data.facts.workOrderDependencies}` },
          { key: 'internal', label: '技术 / 主材执行', children: `${data.facts.technicalExecution ?? 0} / ${data.facts.materialExecution ?? 0}，工艺${data.facts.processLocked ? '已锁定' : '未锁定'}` },
          { key: 'affected', label: '上下游计划', children: <>{data.affectedPlans.map(p => <div key={`${p.resource}-${p.id}`}>
            {masterPlanResourceDefinitions.find(r => r.code === p.resource)?.label}：{p.orderNumber} / {p.itemCode}{p.deliveryNumber ? ` / ${p.deliveryNumber}` : ''}（{statusLabel(p.status)}）
          </div>)}<div>仅对本次选中的计划变更状态，不自动级联取消或恢复。</div></> },
          { key: 'permission', label: '所需权限', children: `计划查看与编辑、${mpsLifecycleOperations[operation].label}独立权限及关联数据范围` }
        ]} />
        {!data.allowed && <Alert type="warning" showIcon message="当前不能执行" description={data.blockers.map(b => <div key={b}>{b}</div>)} />}
      </>}
      <label htmlFor="mps-lifecycle-reason">操作原因</label>
      <Input.TextArea id="mps-lifecycle-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} disabled={saving} />
      {error && <Alert type="error" showIcon message={error} action={<a onClick={() => void preview.refetch()}>重新预览</a>} />}
    </Space>
  </Modal>;
}
