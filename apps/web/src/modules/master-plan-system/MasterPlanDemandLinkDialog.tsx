import { useState } from 'react';
import { Alert, App, Button, Descriptions, Input, Modal, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { MpsDemandLinkInfo } from '@kdos/contracts';
import { api } from '../../api';

export function MasterPlanDemandLinkDialog({resource,id,onClose,onSaved}:{resource:string;id:string;onClose:()=>void;onSaved:()=>Promise<unknown>}) {
  const {message}=App.useApp();
  const [demandId,setDemandId]=useState(''),[reason,setReason]=useState(''),[saving,setSaving]=useState(false);
  const [target,setTarget]=useState<{id:string;version:number;orderNumber:string;itemCode:string}|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [checking,setChecking]=useState(false);
  const [key,setKey]=useState(()=>crypto.randomUUID());
  const subject=(()=>{try{return JSON.parse(localStorage.getItem('sessionUser')??'{}').sub??'anonymous';}catch{return 'anonymous';}})();
  const info=useQuery({queryKey:['mps-demand-link',subject,resource,id],queryFn:()=>api<MpsDemandLinkInfo>(`/master-plan-system/resources/${resource}/${id}/demand-link`),retry:false,refetchOnWindowFocus:false,gcTime:0});
  const readTarget=async()=>{setError(null);setTarget(null);setChecking(true);try{setTarget(await api(`/master-plan-system/demands/${encodeURIComponent(demandId.trim())}`));setKey(crypto.randomUUID());}catch(e){setTarget(null);setError((e as Error).message);}finally{setChecking(false);}};
  const confirm=async()=>{
    if(!target||!info.data)return;setSaving(true);setError(null);
    try{
      await api(`/master-plan-system/resources/${resource}/${id}/demand-link`,{method:'POST',body:JSON.stringify({demandId:target.id,expectedVersion:info.data.recordVersion,expectedDemandVersion:target.version,idempotencyKey:key,reason})});
      message.success('需求关联已确认');
      try{await onSaved();}catch{message.warning('需求关联已保存，页面刷新失败，请手动刷新');}
      onClose();
    }catch(e){setError((e as Error).message);}finally{setSaving(false);}
  };
  return <Modal open title="需求关联" onCancel={()=>{if(!saving)onClose();}} footer={null} closable={!saving} maskClosable={!saving}>
    <Space direction="vertical" style={{width:'100%'}}>
      {info.isPending&&<span>正在读取需求关联…</span>}
      {info.isError&&<Alert type="error" showIcon message={(info.error as Error).message}/>}
      {error&&<Alert type="error" showIcon message={error}/>}
      {info.data&&<>
        <Descriptions column={1} items={[{key:'demand',label:'需求ID',children:info.data.demandId??'尚未确认'},{key:'version',label:'记录版本',children:info.data.recordVersion}]}/>
        {info.data.balance&&<Alert type="info" message={`已关联批次计划量 ${info.data.balance.allocated}；需求差额 ${info.data.balance.difference}`} description="此为已关联批次数量核对，尚未包含历史未确认批次及复杂履约抵扣，不用于自动补排。"/>}
        {!info.data.schemaReady&&<Alert type="info" message="需求关联功能尚未发布"/>}
        {info.data.canBind&&<>
          <Alert type="info" message="仅确认首次父关系" description="不会修改批次数量、报工事实或将评审交期应用到基础计划。已有父关系不能重新绑定。"/>
          <Input aria-label="目标需求ID" placeholder="填写已核实的月度需求ID" value={demandId} disabled={saving||checking} onChange={e=>{setDemandId(e.target.value);setTarget(null);setKey(crypto.randomUUID());}}/>
          <Button loading={checking} disabled={!demandId.trim()||saving||checking} onClick={()=>void readTarget()}>核对目标需求</Button>
          {target&&<span>{target.orderNumber} / {target.itemCode}（版本 {target.version}）</span>}
          <Input.TextArea aria-label="关联原因" placeholder="关联原因" value={reason} maxLength={1000} disabled={saving} onChange={e=>{setReason(e.target.value);setKey(crypto.randomUUID());}}/>
          <Button type="primary" loading={saving} disabled={!target||!reason.trim()} onClick={()=>void confirm()}>确认首次关联</Button>
        </>}
      </>}
    </Space>
  </Modal>;
}
