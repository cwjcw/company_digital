import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, DatePicker, Drawer, Form, Input, Modal, Table } from 'antd';
import { reviewDueDateFields, reviewDueDateExportFilename, reviewDueDateResource as RESOURCE, type TablePermissionFieldDefinition, type ReviewDueDateHistoryRow } from '@kdos/contracts';
import dayjs from 'dayjs';
import { api } from '../../api';
import { KdosDataTable, hasFieldPermission, hasResourcePermission, kdosDefaultPageSize, useKdosTableEditMode } from '../../shared/KdosDataTable';
import type { AdvancedFilterGroup } from '../../shared/advanced-filter';
type Query={page:number;pageSize:number;search:string;filterGroup?:AdvancedFilterGroup;sortField?:string;sortOrder?:'asc'|'desc'};
type Row=Record<string,unknown>&{id:string;version:number;canUpdate?:boolean};
const time=(v:unknown)=>v?new Date(String(v)).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}):'—';
function ReviewDueDateCell({field,row,busy,onSave}:{field:TablePermissionFieldDefinition;row:Row;busy:boolean;onSave:(row:Row,key:string,value:string)=>Promise<void>}){
  const {editing}=useKdosTableEditMode(),value=row[field.key],lock=useRef(false);
  const [draft,setDraft]=useState(value==null?'':String(value));
  useEffect(()=>setDraft(value==null?'':String(value)),[value,row.version]);
  const editable=editing&&field.editable&&row.canUpdate!==false&&hasFieldPermission(RESOURCE,field.key,'update');
  if(!editable)return <>{field.type==='datetime'?time(value):value==null?'—':String(value)}</>;
  const commit=async(next=draft)=>{
    if(lock.current||busy||next===String(value??''))return;
    lock.current=true;
    try{await onSave(row,field.key,next);}catch{setDraft(value==null?'':String(value));}finally{lock.current=false;}
  };
  if(field.type==='date')return <DatePicker aria-label={field.label} size="small" value={draft?dayjs(draft):null} allowClear={false} disabled={busy} onChange={next=>{if(next){const text=next.format('YYYY-MM-DD');setDraft(text);void commit(text);}}} style={{width:'100%'}}/>;
  // Keep exact decimal text end-to-end; InputNumber without stringMode would round large quantities.
  return <Input aria-label={field.label} size="small" value={draft} disabled={busy} inputMode={field.key==='quantity'?'decimal':undefined} onChange={e=>setDraft(e.target.value)} onBlur={()=>void commit()} onPressEnter={e=>e.currentTarget.blur()}/>;
}
function ReviewDueCreateModal({fields,onCreated,onClose}:{fields:TablePermissionFieldDefinition[];onCreated:()=>Promise<void>;onClose:()=>void}){
  const [form]=Form.useForm(),pending=useRef(false),request=useRef<{payload:string;commandId:string}|null>(null);
  const [saving,setSaving]=useState(false),[error,setError]=useState<string|null>(null);
  const save=async()=>{
    if(pending.current)return;
    pending.current=true;setError(null);
    try{
      let values;
      try{values=await form.validateFields();}catch(validation){if(!(validation as {outOfDate?:boolean}).outOfDate)throw validation;values=await form.validateFields();}
      const body=Object.fromEntries(fields.map(field=>[field.key,field.type==='date'?values[field.key]?.format('YYYY-MM-DD'):values[field.key]??'']));
      const payload=JSON.stringify(body);
      if(request.current?.payload!==payload)request.current={payload,commandId:crypto.randomUUID()};
      setSaving(true);
      await api(`/master-plan-system/review-due-dates/manual-create`,{method:'POST',body:JSON.stringify({...body,commandId:request.current!.commandId})});
      await onCreated();onClose();
    }catch(e){setError((e as Error).message||'请检查必填字段后重试');}
    finally{pending.current=false;setSaving(false);}
  };
  return <Modal title="新增评审交期" open onCancel={()=>{if(!pending.current)onClose();}} onOk={()=>void save()} okText="保存" cancelText="取消" confirmLoading={saving} maskClosable={!saving} cancelButtonProps={{disabled:saving}} closable={!saving}>
    {error&&<Alert type="error" showIcon message={error}/>}
    <Form form={form} layout="vertical" disabled={saving} preserve={false}>
      {fields.map(field=><Form.Item key={field.key} label={field.label} name={field.key} rules={field.required?[{required:true,...(field.type==='date'?{}:{whitespace:true}),message:field.label+'必填'}]:[]}>
        {field.type==='date'?<DatePicker allowClear style={{width:'100%'}}/>:<Input inputMode={field.exactNumeric?'decimal':undefined}/>}
      </Form.Item>)}
    </Form>
  </Modal>;
}
export function ReviewDueDates(){
  const [createOpen,setCreateOpen]=useState(false);
  const client=useQueryClient(),savingIds=useRef(new Set<string>());
  const [busy,setBusy]=useState<Set<string>>(new Set()),[saveError,setSaveError]=useState<string|null>(null);
  const [query,setQuery]=useState<Query>({page:1,pageSize:kdosDefaultPageSize,search:''});
  const [selected,setSelected]=useState<Row|null>(null),[historyPage,setHistoryPage]=useState(1);
  const session=localStorage.getItem('sessionUser')??'',canRead=hasResourcePermission(RESOURCE,'read'),canRequestCreate=hasResourcePermission(RESOURCE,'create');
  const params=new URLSearchParams({page:String(query.page),pageSize:String(query.pageSize),search:query.search});
  if(query.filterGroup)params.set('filterGroup',JSON.stringify(query.filterGroup));
  if(query.sortField)params.set('sortField',query.sortField);if(query.sortOrder)params.set('sortOrder',query.sortOrder);
  const meta=useQuery({queryKey:['review-due-meta',session],queryFn:()=>api<{fields:TablePermissionFieldDefinition[];createFields?:TablePermissionFieldDefinition[];actions:{update:boolean;create?:boolean}}>(`/master-plan-system/resources/${RESOURCE}/meta`),enabled:canRead||canRequestCreate});
  const rows=useQuery({queryKey:['review-due-rows',session,params.toString()],queryFn:({signal})=>api<{rows:Row[];total:number}>(`/master-plan-system/resources/${RESOURCE}?${params}`,{signal}),enabled:canRead});
  const history=useQuery({queryKey:['review-due-history',session,selected?.id,historyPage],queryFn:()=>api<{rows:ReviewDueDateHistoryRow[];total:number}>(`/master-plan-system/review-due-dates/${selected!.id}/history?page=${historyPage}&pageSize=100`),enabled:canRead&&!!selected});
  const save=async(row:Row,key:string,value:string)=>{
    if(savingIds.current.has(row.id))throw new Error('当前记录正在保存，请稍后重试');
    savingIds.current.add(row.id);setBusy(new Set(savingIds.current));setSaveError(null);
    try{
      await client.cancelQueries({queryKey:['review-due-rows',session]});
      await api(`/master-plan-system/review-due-dates/${row.id}/manual-edit`,{method:'PATCH',body:JSON.stringify({[key]:value,expectedVersion:row.version,commandId:crypto.randomUUID()})});
      await Promise.all([client.invalidateQueries({queryKey:['review-due-rows',session]}),client.invalidateQueries({queryKey:['review-due-history',session,row.id]})]);
    }catch(error){setSaveError((error as Error).message);throw error;}
    finally{savingIds.current.delete(row.id);setBusy(new Set(savingIds.current));}
  };
  if(!canRead&&!canRequestCreate)return <Alert type="warning" message="当前权限组没有评审交期表查看权限"/>;
  const visible=new Set(meta.data?.fields.map(f=>f.key)??[]);
  const canHistory=['inboundDate','previousInboundDate','changeCount','lastChangedAt'].every(k=>visible.has(k));
  return <Card title="评审交期表">
    {saveError&&<Alert type="error" message={saveError} action={<Button size="small" onClick={()=>void Promise.all([rows.refetch(),...(selected?[history.refetch()]:[])])}>刷新后重试</Button>}/>}
    {(rows.error||meta.error)&&<Alert type="error" message={(rows.error??meta.error)?.message}/>}
    <KdosDataTable<Row> resource={RESOURCE} rowKey="id" systemFields={false} editable={meta.data?.actions?.update===true}
      toolbar={canRequestCreate&&meta.data?.actions?.create?<Button type="primary" onClick={()=>setCreateOpen(true)}>新增</Button>:null}
      exportFilename={reviewDueDateExportFilename} loading={rows.isLoading||meta.isLoading} dataSource={rows.data?.rows??[]}
      columns={[...reviewDueDateFields.filter(f=>visible.has(f.key)).map(f=>({title:f.label,dataIndex:f.key,key:f.key,width:f.key==='drawingNumber'?200:160,render:(_:unknown,row:Row)=><ReviewDueDateCell field={{...f,editable:f.editable&&meta.data?.fields.find(x=>x.key===f.key)?.editable===true}} row={row} busy={busy.has(row.id)} onSave={save}/>})),
        ...(canHistory?[{title:'操作',key:'__history',width:110,render:(_:unknown,row:Row)=><Button type="link" onClick={()=>{setSelected(row);setHistoryPage(1);}}>变更历史</Button>}]:[])]}
      serverData={{total:rows.data?.total??0,onQueryChange:setQuery}} scroll={{x:'max-content'}}/>
    {createOpen&&<ReviewDueCreateModal fields={meta.data?.createFields??[]} onClose={()=>setCreateOpen(false)} onCreated={async()=>{await client.invalidateQueries({queryKey:['review-due-rows',session]});}}/>}
    <Drawer title="变更历史" width={980} open={!!selected} onClose={()=>setSelected(null)}>
      {history.error&&<Alert type="error" message={history.error.message}/>}
      <Table<ReviewDueDateHistoryRow> rowKey="id" size="small" loading={history.isLoading} dataSource={history.data?.rows??[]} locale={{emptyText:'暂无变更记录'}}
        pagination={{current:historyPage,pageSize:100,total:history.data?.total??0,onChange:setHistoryPage,showSizeChanger:false}}
        columns={[{title:'变更时间',dataIndex:'changedAt',render:time},{title:'原入库时间',dataIndex:'oldInboundDate'},
          {title:'新入库时间',dataIndex:'newInboundDate'},{title:'提前/推迟天数',dataIndex:'changeDays',render:(v:number)=>`${v<0?'提前':'推迟'}${Math.abs(v)}天`},
          {title:'变更来源',dataIndex:'sourceKind',render:(v:string)=>({SYNC:'同步',IMPORT:'导入',MANUAL:'人工'}[v]??v)},
          {title:'操作人或同步批次',key:'source',render:(_,row)=>row.sourceKind==='SYNC'?row.sourceBatchId:row.changedByName??row.sourceBatchId}]}/>
    </Drawer>
  </Card>;
}
