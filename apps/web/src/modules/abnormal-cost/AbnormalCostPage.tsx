import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Dropdown, Form, Input, InputNumber, Modal, Select, Space, Tag, Typography, Upload } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import Decimal from 'decimal.js';
import { abnormalCostFields, abnormalCostResources, abnormalPersonnelLevels, abnormalPersonnelOptions, tablePermissionFieldsFor, type AbnormalCostResource, type TablePermissionFieldDefinition } from '@kdos/contracts';
import { api } from '../../api';
import { KdosDataTable, deleteTableRowsSequentially, hasFieldPermission, hasResourcePermission } from '../../shared/KdosDataTable';
import { blankPlatformQuery, platformRowsKey, platformRowsUrl, type PlatformTablePage, type PlatformTableQuery } from '../../shared/platform-table';
import './abnormal-cost.css';
type Row=Record<string,any>&{id:string;version:number};
type FileRef={id:string;name:string;parsed_rows?:Record<string,unknown>[]};
type Options={users:Array<{id:string;name:string;username:string;enabled:boolean;position?:string}>;departments:Array<{id:string;name:string;pathLabel:string}>;categories:Array<{id:string;category_name:string}>;severities:Array<{id:string;severity_name:string;amount_min:string;amount_max:string}>;systemAdminId:string|null};
const REQUEST='abnormal-responsibility-requests',JUDGMENT='abnormal-responsibility-judgments';
const errorText=(error:unknown)=>error instanceof Error?error.message:'操作失败';
const sessionUser=()=>{try{return JSON.parse(localStorage.getItem('sessionUser')??'{}');}catch{return {};}};
const ASSIGNEE_EDIT_FIELDS=new Set(['responsibility_allocations','responsibility_reason','judgment_evidence']);
const hasOwnJudgmentAccess=(code:string)=>code===JUDGMENT&&Boolean(sessionUser().sub??sessionUser().userId);
const canReadResource=(code:string)=>hasResourcePermission(code,'read')||hasOwnJudgmentAccess(code);
const canUpdateResource=(code:string)=>hasResourcePermission(code,'update')||hasOwnJudgmentAccess(code);
const canWrite=(code:string,key:string,creating:boolean)=>hasFieldPermission(code,key,'update')||!creating&&hasOwnJudgmentAccess(code)&&ASSIGNEE_EDIT_FIELDS.has(key)||creating&&(hasFieldPermission(code,key,'read')||!hasResourcePermission(code,'read'));
function matchAbnormalSeverity(amount:unknown,levels:Options['severities']){
  try{if(amount==null||amount==='')return null;const number=new Decimal(String(amount));const matches=levels.filter(level=>number.gte(level.amount_min)&&number.lte(level.amount_max));return matches.length===1?matches[0]:null;}catch{return null;}
}
async function download(path:string,filename:string){const blob=await api<Blob>(path);if(!(blob instanceof Blob))throw new Error('下载失败');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);}
function MemberSelect({options,onlyLeaders=false,...props}: {options:Options|undefined;onlyLeaders?:boolean;value?:string;onChange?:(value:string)=>void;disabled?:boolean}){return <Select showSearch optionFilterProp="label" options={options?.users.filter(u=>(u.enabled!==false||u.id===props.value)&&(!onlyLeaders||/(组长|课长)/.test(u.position??'')||u.id===props.value)).map(u=>({value:u.id,label:`${u.name}（${u.username}）`,disabled:u.enabled===false}))} {...props}/>;}
function DepartmentSelect({options,...props}: {options:Options|undefined;value?:string;onChange?:(value:string)=>void;disabled?:boolean}){return <Select showSearch optionFilterProp="label" options={options?.departments.map(d=>({value:d.id,label:d.pathLabel??d.name}))} {...props}/>;}
function FileInput({value,onChange,purpose,disabled=false,multipleDetail=false}:{value?:FileRef[];onChange?:(value:FileRef[])=>void;purpose:'DETAIL'|'OTHER'|'EVIDENCE';disabled?:boolean;multipleDetail?:boolean}){
  const {message}=App.useApp();const [busy,setBusy]=useState(false);
  return <Space direction="vertical" style={{width:'100%'}}>
    {purpose==='DETAIL'&&<Button onClick={()=>void download('/abnormal-cost/detail-template','abnormal_detail_template.xlsx').catch(e=>message.error(errorText(e)))}>下载明细附件模板</Button>}
    <Upload showUploadList={false} disabled={disabled||busy} accept={purpose==='DETAIL'?'.xlsx':'.xlsx,.pdf,.png,.jpg,.jpeg,.gif,.webp,.docx,.txt,.csv'} beforeUpload={file=>{
      if(file.size>20*1024*1024){message.error('附件不能超过20MB');return false;}setBusy(true);const form=new FormData();form.append('file',file);form.append('originalName',file.name);
      void api<FileRef>(`/abnormal-cost/attachments?purpose=${purpose}`,{method:'POST',body:form}).then(result=>{onChange?.(purpose==='DETAIL'&&!multipleDetail?[result]:[...(value??[]),result]);message.success('附件校验通过');}).catch(error=>message.error(errorText(error))).finally(()=>setBusy(false));return false;
    }}><Button icon={<UploadOutlined/>} loading={busy} disabled={disabled}>上传{purpose==='DETAIL'?'明细':'附件'}</Button></Upload>
    {(value??[]).map(file=><Space key={file.id}><Typography.Text>{file.name}</Typography.Text>{!disabled&&<Button type="link" onClick={()=>onChange?.(value?.filter(v=>v.id!==file.id)??[])}>移除</Button>}</Space>)}
    {purpose==='DETAIL'&&value?.[0]?.parsed_rows&&<div style={{maxHeight:180,overflow:'auto'}}><table className="abnormal-detail-preview"><thead><tr>{Object.keys(value[0].parsed_rows[0]??{}).map(key=><th key={key}>{key}</th>)}</tr></thead><tbody>{value[0].parsed_rows.slice(0,20).map((row,index)=><tr key={index}>{Object.entries(row).map(([key,v])=><td key={key}>{String(v??'')}</td>)}</tr>)}</tbody></table><Typography.Text type="secondary">已校验{value[0].parsed_rows.length}行，预览前20行</Typography.Text></div>}
  </Space>;
}
export function ResponsibilityAllocationEditor({options,form,canDelete,disabled=false}:{options?:Options;form:ReturnType<typeof Form.useForm>[0];canDelete:boolean;disabled?:boolean}){
  const {modal}=App.useApp();const rows=Form.useWatch('responsibility_allocations',form)??[];
  const total=(key:string)=>{try{return rows.reduce((s:Decimal,row:Row)=>s.plus(row?.[key]??(key==='adjusted_ratio'?row?.responsibility_ratio:0)??0),new Decimal(0)).toFixed(1);}catch{return '—';}};
  return <>
    <Alert type="info" showIcon message="当人员类型为一线员工时，填写一线员工姓名，责任人员选择对应组长或课长，并在备注中说明通知安排。人员类型为公司时，不需要填写个人姓名，责任人员由系统自动设置。"/>
    <Form.List name="responsibility_allocations">{(fields,{add,remove})=><div className="abnormal-allocation-scroll"><table className="abnormal-allocation-table"><thead><tr>{['序号','人员类型','一线员工姓名 / 公司说明','责任人员','人员层级','责任比例','申诉后责任比例','备注'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{fields.map(field=>{
      const type=rows[field.name]?.personnel_type;
      return <tr key={field.key}><td className="abnormal-row-number"><Form.Item name={[field.name,'id']} hidden><Input type="hidden"/></Form.Item><span>{field.name+1}</span>{canDelete&&!disabled&&<Button danger type="text" className="abnormal-row-delete" aria-label={`删除责任划分第${field.name+1}行`} icon={<DeleteOutlined/>} onClick={()=>modal.confirm({title:'确认删除该责任划分行？',okText:'删除',cancelText:'取消',okButtonProps:{danger:true},onOk:()=>remove(field.name)})}/>}</td>
        <td><Form.Item name={[field.name,'personnel_type']} rules={[{required:true}]}><Select disabled={disabled} options={abnormalPersonnelOptions} onChange={value=>{
          form.setFieldValue(['responsibility_allocations',field.name,'frontline_name'],null);form.setFieldValue(['responsibility_allocations',field.name,'company_description'],value==='公司'?'公司':null);form.setFieldValue(['responsibility_allocations',field.name,'responsible_user_id'],value==='公司'?options?.systemAdminId:null);
        }}/></Form.Item></td>
        <td>{type==='一线员工'?<Form.Item name={[field.name,'frontline_name']} rules={[{required:true,message:'请填写一线员工姓名'}]}><Input disabled={disabled}/></Form.Item>:type==='公司'?<Form.Item name={[field.name,'company_description']}><Input disabled={disabled}/></Form.Item>:'—'}</td>
        <td><Form.Item name={[field.name,'responsible_user_id']} rules={[{required:true,message:'请选择责任人员'}]}><MemberSelect options={options} onlyLeaders={type==='一线员工'} disabled={disabled||type==='公司'}/></Form.Item></td>
        <td><Form.Item name={[field.name,'personnel_level']} rules={[{required:true}]}><Select disabled={disabled} options={abnormalPersonnelLevels}/></Form.Item></td>
        <td><Form.Item name={[field.name,'responsibility_ratio']} rules={[{required:true}]}><InputNumber stringMode disabled={disabled} precision={1} min={0} max={100} suffix="%" onChange={value=>{if(form.getFieldValue(['responsibility_allocations',field.name,'adjusted_ratio'])==null)form.setFieldValue(['responsibility_allocations',field.name,'adjusted_ratio'],value);}}/></Form.Item></td>
        <td><Form.Item name={[field.name,'adjusted_ratio']} rules={[{required:true}]}><InputNumber stringMode disabled={disabled} precision={1} min={0} max={100} suffix="%"/></Form.Item></td>
        <td><Form.Item name={[field.name,'remark']} rules={[{required:type==='一线员工',message:'请说明组长或课长通知安排'}]}><Input.TextArea disabled={disabled} autoSize={{minRows:1,maxRows:3}}/></Form.Item></td>
      </tr>;
    })}</tbody></table><Space style={{marginTop:8}}>{!disabled&&<Button icon={<PlusOutlined/>} onClick={()=>add({personnel_type:'管理/职能岗'})}>添加</Button>}<Typography.Text>责任比例合计：{total('responsibility_ratio')}%；申诉后责任比例合计：{total('adjusted_ratio')}%</Typography.Text></Space></div>}</Form.List>
  </>;
}
function fieldLabel(field:TablePermissionFieldDefinition,value:any,options?:Options){
  if(value==null||value==='')return '—';
  if(field.key==='abnormal_request_link')return <a href={String(value)} target="_blank" rel="noreferrer">查看异常信息</a>;
  if(field.type==='member'||['createdBy','updatedBy'].includes(field.key))return options?.users.find(u=>u.id===value)?.name??'—';
  if(field.type==='department')return options?.departments.find(d=>d.id===value)?.pathLabel??'—';
  if(field.key==='category_id')return options?.categories.find(c=>c.id===value)?.category_name??'—';
  if(field.key==='severity_level_id')return options?.severities.find(s=>s.id===value)?.severity_name??'—';
  if(field.key==='judgment_status')return <Tag color={value==='COMPLETED'?'green':'orange'}>{value==='COMPLETED'?'已判定':'待判定'}</Tag>;
  if(field.type==='structured'||field.type==='attachment')return Array.isArray(value)?`${value.length}条`:'查看详情';
  if(field.type==='number'){try{return new Decimal(value).toFixed(field.key==='expense_bearing_ratio'?0:2).replace(/\B(?=(\d{3})+(?!\d))/g,',')+(field.key==='expense_bearing_ratio'?'%':'');}catch{return '—';}}
  if(field.type==='datetime')return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));
  return String(value);
}
export function AbnormalCostPage(){
  const {kind='requests',id}=useParams();const def=abnormalCostResources.find(r=>r.kind===kind);
  if(!def)return <Alert type="error" message="页面不存在"/>;
  if(def.code===JUDGMENT?!canReadResource(def.code):!hasResourcePermission(def.code,'read')&&!hasResourcePermission(def.code,'create'))return <Alert type="error" message="没有此页面的访问权限"/>;
  return <AbnormalCostTable key={def.code} resource={def.code} initialId={id}/>;
}
export function AbnormalCostTable({resource,requestId,initialId}:{resource:AbnormalCostResource;requestId?:string;initialId?:string}){
  const {message,modal}=App.useApp(),client=useQueryClient(),basic=['abnormal-categories','incident-severity-levels'].includes(resource);
  const [query,setQuery]=useState<PlatformTableQuery>(()=>blankPlatformQuery());
  const context=requestId?{requestId}:undefined;
  const listUrl=(q:PlatformTableQuery)=>platformRowsUrl(resource,q)+(context?`&context=${encodeURIComponent(JSON.stringify(context))}`:'');
  const rows=useQuery({queryKey:[...platformRowsKey(resource,query),requestId],queryFn:()=>api<PlatformTablePage<Row>>(listUrl(query)),enabled:canReadResource(resource)});
  const options=useQuery({queryKey:['abnormal-cost-options'],queryFn:()=>api<Options>('/abnormal-cost/options')});
  const [editing,setEditing]=useState<Row|null|undefined>(undefined),[formMode,setFormMode]=useState<'create'|'view'|'edit'>('create'),[saving,setSaving]=useState(false),[formReady,setFormReady]=useState(false),[form]=Form.useForm();
  const [linkedJudgments,setLinkedJudgments]=useState<Row[]>([]);
  useEffect(()=>{if(formReady)form.setFieldsValue(editing?{...editing}:resource===REQUEST?{initiator_id:sessionUser().id??sessionUser().sub,responsibility_judgments:[{}]}:{});},[editing,form,formReady,resource]);
  const [preview,setPreview]=useState<Row|null>(null),[importing,setImporting]=useState(false),[preparing,setPreparing]=useState(false),[preparedDetail,setPreparedDetail]=useState<FileRef[]>([]),[preparedOther,setPreparedOther]=useState<FileRef[]>([]);const idempotency=useRef(crypto.randomUUID()),confirmedManually=useRef(false);
  const fieldDefs=abnormalCostFields[resource];
  const refresh=async()=>{await client.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('abnormal-')||['incident-severity-levels','abnormal-cost-options'].includes(String(q.queryKey[0]))});};
  const begin=(record:Row|null)=>{form.resetFields();confirmedManually.current=false;idempotency.current=crypto.randomUUID();setFormMode(record?'edit':'create');setFormReady(!record);setLinkedJudgments(Array.isArray(record?.responsibility_judgments)?record.responsibility_judgments:record?[]:[{}]);setEditing(record);};
  const beginEdit=async(record:Row)=>{
    setEditing(undefined);setFormReady(false);form.resetFields();
    message.loading({content:'正在读取最新记录…',key:'abnormal-cost-record-load',duration:0});
    try{
      const fresh=await api<Row>(`/abnormal-cost/resources/${resource}/${record.id}`);
      confirmedManually.current=true;idempotency.current=crypto.randomUUID();setFormMode('edit');if(resource===REQUEST)setLinkedJudgments(Array.isArray(fresh.responsibility_judgments)?fresh.responsibility_judgments:[]);setEditing(fresh);
    }catch(error){message.error(`读取最新记录失败，未打开编辑表单：${errorText(error)}`);}finally{message.destroy('abnormal-cost-record-load');}
  };
  const beginView=useCallback(async(record:Row)=>{
    setEditing(undefined);setFormReady(false);form.resetFields();
    message.loading({content:'正在读取最新记录…',key:'abnormal-cost-record-load',duration:0});
    try{const fresh=await api<Row>(`/abnormal-cost/resources/${resource}/${record.id}`);setFormMode('view');if(resource===REQUEST)setLinkedJudgments(Array.isArray(fresh.responsibility_judgments)?fresh.responsibility_judgments:[]);setEditing(fresh);}
    catch(error){message.error(`读取最新记录失败，未打开查看表单：${errorText(error)}`);}finally{message.destroy('abnormal-cost-record-load');}
  },[resource,message,form]);
  useEffect(()=>{if(initialId)void beginView({id:initialId,version:0});},[initialId,beginView]); // resource remounts the table at the route boundary
  const closeEditor=()=>{if(form.isFieldsTouched()){modal.confirm({title:'放弃未保存的修改？',content:'当前修改尚未保存，确定放弃吗？',okText:'放弃修改',cancelText:'继续编辑',onOk:()=>setEditing(undefined)});return;}setEditing(undefined);};

  const save=async(complete=false)=>{
    if(saving||formMode==='view')return;setSaving(true);try{
      const values=await form.validateFields();const body:Record<string,unknown>={};
      if(resource===REQUEST&&linkedJudgments.some(child=>!child.category_id||!child.judgment_department_id||!child.judge_user_id))throw new Error('请补全每条责任判定的异常类别、判定部门和判定人');
      for(const field of fieldDefs.filter(f=>f.editable&&canWrite(resource,f.key,!editing))){if(values[field.key]!==undefined&&field.key!=='responsibility_judgments')body[field.key]=values[field.key];}
      if(resource===REQUEST){if(Array.isArray(body.detail_attachment))body.detail_attachment=body.detail_attachment[0]?.id;if('other_attachments' in body)body.other_attachments=(body.other_attachments as FileRef[]|undefined)?.map(f=>f.id)??[];if(canWrite(REQUEST,'responsibility_judgments',!editing))body.responsibility_judgments=linkedJudgments;}
      if(resource===JUDGMENT){if('judgment_evidence' in body)body.judgment_evidence=(body.judgment_evidence as FileRef[]|undefined)?.map(f=>f.id)??[];body.complete=complete;}
      if(editing)body.expectedVersion=editing.version;
      const route=basic?`/abnormal-cost/resources/${resource}${editing?`/${editing.id}`:''}`:`/abnormal-cost/${resource===REQUEST?'requests':'judgments'}${editing?`/${editing.id}`:''}`;
      await api(route,{method:editing?'PATCH':'POST',headers:{'Idempotency-Key':idempotency.current},body:JSON.stringify(body)});message.success(complete?'责任判定已完成':'保存成功');setEditing(undefined);await refresh();
    }catch(error){if(error instanceof Error)message.error(error.message);}finally{setSaving(false);}
  };
  const creating=formMode==='create';
  const canDisplay=(key:string)=>formMode==='view'?hasFieldPermission(resource,key,'read'):canWrite(resource,key,creating);
  const renderInput=(f:TablePermissionFieldDefinition)=>{
    if(f.type==='member')return <MemberSelect options={options.data}/>;
    if(f.type==='department')return <DepartmentSelect options={options.data}/>;
    if(f.key==='category_id')return <Select options={options.data?.categories.map(c=>({value:c.id,label:c.category_name}))}/>;
    if(f.options)return <Select options={f.options}/>;
    if(f.type==='number')return <InputNumber<string> stringMode min="0" max={f.key==='expense_bearing_ratio'?'100':undefined} precision={f.key==='expense_bearing_ratio'?0:2} formatter={(value,info)=>info.userTyping?info.input:value==null||value===''?'':new Decimal(String(value)).toFixed(f.key==='expense_bearing_ratio'?0:2).replace(/\B(?=(\d{3})+(?!\d))/g,',')} parser={value=>(value??'').replace(/,/g,'')} suffix={f.key==='expense_bearing_ratio'?'%':undefined} style={{width:'100%'}} onChange={f.key==='confirmed_amount'?()=>{confirmedManually.current=true;}:undefined}/>;
    return f.key.includes('description')||f.key.includes('reason')||f.key==='remark'?<Input.TextArea rows={3} maxLength={4000}/>:<Input maxLength={100}/>;
  };
  const renderRequestField=(key:string,className='')=>{
    const field=fieldDefs.find(f=>f.key===key);
    if(!field||!canDisplay(field.key))return null;
    return <Form.Item className={className} key={field.key} name={field.key} label={field.label} rules={[{required:field.required,message:`请填写${field.label}`},...(field.type==='number'&&['estimated_amount','confirmed_amount'].includes(field.key)?[{validator:async(_:unknown,value:unknown)=>{if(value==null||value==='')return;try{if(new Decimal(String(value)).gt(0))return;}catch{ /* invalid decimals use the same validation message */ }throw new Error('金额必须大于0');}}]:[])]}>{renderInput(field)}</Form.Item>;
  };
  const renderRequestSeverity=()=>hasFieldPermission(REQUEST,'severity_level_id','read')&&<Form.Item className="abnormal-request-severity" noStyle shouldUpdate>{()=>{const severity=matchAbnormalSeverity(form.getFieldValue('confirmed_amount'),options.data?.severities??[]);return <Form.Item label="事故级别"><Input readOnly value={severity?.severity_name??''}/>{!severity&&form.getFieldValue('confirmed_amount')&&<Typography.Text type="danger">请管理员完善事故级别配置</Typography.Text>}</Form.Item>;}}</Form.Item>;
  const renderRequestAttachment=(key:'detail_attachment'|'other_attachments')=>{
    const field=fieldDefs.find(f=>f.key===key);
    if(!field||!canDisplay(key))return null;
    return <Form.Item className="abnormal-request-attachment" key={key} label={field.label} required={field.required}>
      <div className="abnormal-request-upload-card">
        <Typography.Text type="secondary">{key==='detail_attachment'?'请使用标准Excel模板，上传后系统会校验内容。':'可上传多个补充资料文件。'}</Typography.Text>
        {formMode==='view'?<Space direction="vertical">{(editing?.[key]??[]).map((file:FileRef)=><Button key={file.id} type="link" onClick={()=>void download(`/abnormal-cost/resources/${resource}/${editing!.id}/attachments/${file.id}`,file.name).catch(error=>message.error(errorText(error)))}>{file.name}</Button>)}</Space>:<Form.Item name={key} rules={[{required:field.required,message:`请上传${field.label}`}]} noStyle><FileInput purpose={key==='detail_attachment'?'DETAIL':'OTHER'}/></Form.Item>}
      </div>
    </Form.Item>;
  };
  const importFile=async(file:File)=>{setImporting(true);try{const body=new FormData();body.append('file',file);setPreview(await api<Row>(`/abnormal-cost/resources/${resource}/import-preview`,{method:'POST',body}));}catch(error){message.error(errorText(error));}finally{setImporting(false);}return false;};
  const downloadTemplate=async(mode:string)=>{try{await download(`/abnormal-cost/resources/${resource}/template?${new URLSearchParams({mode,...(requestId?{requestId}:{}),...(query.search?{search:query.search}:{}),...(query.filterGroup?{filterGroup:JSON.stringify(query.filterGroup)}:{})})}`,'abnormal_import_template.xlsx');}catch(error){message.error(errorText(error));}};
  const onDouble=(record:Row)=>{void beginView(record);};
  const mayEdit=canUpdateResource(resource)&&fieldDefs.some(f=>f.editable&&canWrite(resource,f.key,false));
  return <>
    {rows.error&&<Alert type="error" showIcon message={errorText(rows.error)}/>}
    <KdosDataTable<Row> resource={resource} rowKey="id" filterFields={tablePermissionFieldsFor(resource)} printContext={context}
      columns={fieldDefs.map(f=>({key:f.key,dataIndex:f.key,title:f.label,width:f.type==='structured'?160:180,render:v=>fieldLabel(f,v,options.data)}))}
      dataSource={rows.data?.rows??[]} loading={rows.isLoading} scroll={{x:'max-content'}} serverData={{total:rows.data?.total??0,onQueryChange:setQuery}}
      toolbar={<Space>{hasResourcePermission(resource,'create')&&(basic||resource===REQUEST)&&<Button type="primary" icon={<PlusOutlined/>} onClick={()=>begin(null)}>新增</Button>}
        {hasResourcePermission(resource,'import')&&<><Dropdown menu={{items:[{key:'CREATE',label:'新增数据模板'},{key:'UPDATE',label:'更新已有数据模板',disabled:!hasResourcePermission(resource,'update')||!hasResourcePermission(resource,'batch_update')}],onClick:({key})=>void downloadTemplate(key)}}><Button>下载导入模板</Button></Dropdown><Upload accept=".xlsx" showUploadList={false} beforeUpload={importFile}><Button loading={importing}>导入</Button></Upload>{!basic&&<Button onClick={()=>setPreparing(true)}>准备导入附件</Button>}</>}
      </Space>}
      deleteAction={hasResourcePermission(resource,'delete')?{permitted:true,onDelete:async selected=>{const result=await deleteTableRowsSequentially(selected,r=>r.id,r=>api(`/abnormal-cost/resources/${resource}/${r.id}?expectedVersion=${r.version}`,{method:'DELETE'}));await refresh();return result;}}:undefined}
      rowActions={mayEdit?record=><Button size="small" icon={<EditOutlined/>} onClick={event=>{event.stopPropagation();void beginEdit(record);}}>编辑</Button>:undefined}
      onRecordDoubleClick={onDouble}/>
    <Modal className={resource===REQUEST?'abnormal-request-modal':resource===JUDGMENT?'abnormal-judgment-modal':undefined} open={editing!==undefined} title={formMode==='view'?'查看':formMode==='edit'?'编辑':'新增'} afterOpenChange={open=>{if(open&&!formReady)setFormReady(true);}} width={resource===REQUEST?1320:resource===JUDGMENT?1250:900} destroyOnHidden maskClosable={false} onCancel={closeEditor} confirmLoading={saving}
      footer={<Space><Button onClick={closeEditor}>{formMode==='view'?'关闭':'取消'}</Button>{formMode==='view'&&mayEdit&&<Button type="primary" onClick={()=>{if(editing)void beginEdit(editing);}}>编辑</Button>}{formMode!=='view'&&<><Button type="primary" loading={saving} disabled={!formReady} onClick={()=>void save(false)}>{resource===JUDGMENT?'保存判定草稿':resource===REQUEST&&creating?'提交':'保存'}</Button>{resource===JUDGMENT&&canWrite(resource,'responsibility_allocations',false)&&<Button type="primary" loading={saving} disabled={!formReady} onClick={()=>void save(true)}>完成责任判定</Button>}</>}</Space>}>
      <Form form={form} disabled={!formReady||formMode==='view'} layout="vertical" preserve={false} onValuesChange={(changed)=>{
        if(changed.estimated_amount!==undefined&&!confirmedManually.current)form.setFieldValue('confirmed_amount',changed.estimated_amount);
      }}>
        {resource===REQUEST?<div className="abnormal-request-form-layout">
          <section className="abnormal-request-section abnormal-request-basic">
            <Typography.Title level={5}>基本信息</Typography.Title>
            <div className="abnormal-request-info-grid">
              <Form.Item label="异常单号"><Input readOnly value={editing?.abnormal_no??'提交后自动生成'}/></Form.Item>
              {renderRequestField('customer_code')}
              {renderRequestField('order_no')}
              {renderRequestField('division_id')}
              {renderRequestField('initiator_id')}
              {renderRequestField('estimated_amount')}
              {renderRequestField('confirmed_amount')}
              {renderRequestSeverity()}
              {renderRequestField('abnormal_description','abnormal-request-description')}
            </div>
          </section>
          <section className="abnormal-request-section abnormal-request-attachments-section">
            <Typography.Title level={5}>附件资料</Typography.Title>
            <div className="abnormal-request-attachment-grid">
              {renderRequestAttachment('detail_attachment')}
              {renderRequestAttachment('other_attachments')}
            </div>
          </section>
          {(creating||Array.isArray(editing?.responsibility_judgments))&&hasFieldPermission(REQUEST,'responsibility_judgments','read')&&<section className="abnormal-request-section abnormal-request-judgments-section">
            <Typography.Title level={5}>责任划分</Typography.Title>
            <Form.List key={`${editing?.id??'new'}-${formMode}`} name="responsibility_judgments" initialValue={editing?.responsibility_judgments??[{}]} rules={[{validator:async(_,v)=>{if(!v?.length)throw new Error('至少配置一条责任判定记录');}}]}>{(fields,{add,remove},meta)=><>
              <div className="abnormal-request-judgment-scroll"><table className="abnormal-request-judgment-table"><thead><tr>{['序号','异常类别','判定部门','判定人','承担费用比例','操作'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>
                {fields.map((field,index)=><tr key={field.key}><td><span>{linkedJudgments[index]?.judgment_no??index+1}</span></td>
                  <td><Select value={linkedJudgments[index]?.category_id} onChange={value=>setLinkedJudgments(current=>current.map((child,i)=>i===index?{...child,category_id:value}:child))} disabled={!canWrite(JUDGMENT,'category_id',!editing)} options={options.data?.categories.map(c=>({value:c.id,label:c.category_name}))}/></td>
                  <td><DepartmentSelect value={linkedJudgments[index]?.judgment_department_id} onChange={value=>setLinkedJudgments(current=>current.map((child,i)=>i===index?{...child,judgment_department_id:value}:child))} disabled={!canWrite(JUDGMENT,'judgment_department_id',!editing)} options={options.data}/></td>
                  <td><MemberSelect value={linkedJudgments[index]?.judge_user_id} onChange={value=>setLinkedJudgments(current=>current.map((child,i)=>i===index?{...child,judge_user_id:value}:child))} disabled={!canWrite(JUDGMENT,'judge_user_id',!editing)} options={options.data}/></td>
                  <td><InputNumber value={linkedJudgments[index]?.expense_bearing_ratio} onChange={value=>setLinkedJudgments(current=>current.map((child,i)=>i===index?{...child,expense_bearing_ratio:value}:child))} disabled={!canWrite(JUDGMENT,'expense_bearing_ratio',!editing)} min={0} max={100} precision={0} suffix="%" stringMode style={{width:'100%'}}/></td>
                  <td>{formMode!=='view'&&fields.length>1&&canWrite(REQUEST,'responsibility_judgments',!editing)&&hasResourcePermission(JUDGMENT,'delete')&&<Button danger type="text" aria-label={`删除第${index+1}条责任判定`} onClick={()=>{remove(field.name);setLinkedJudgments(current=>current.filter((_,i)=>i!==index));}}>删除</Button>}</td>
                </tr>)}
              </tbody></table></div>
              <Form.ErrorList errors={meta.errors}/>
              <div className="abnormal-request-judgment-actions">{formMode!=='view'&&canWrite(REQUEST,'responsibility_judgments',!editing)&&hasResourcePermission(JUDGMENT,'create')&&<Button icon={<PlusOutlined/>} onClick={()=>{add({});setLinkedJudgments(current=>[...current,{} as Row]);}}>添加责任判定</Button>}<Typography.Text type="secondary">共 {fields.length} 条关联记录</Typography.Text></div>
            </>}</Form.List>
          </section>}
        </div>:resource===JUDGMENT?<div className="abnormal-judgment-form-layout">
          <section className="abnormal-judgment-section"><Typography.Title level={5}>判定信息</Typography.Title><div className="abnormal-judgment-info-grid">
            {fieldDefs.filter(f=>(formMode==='view'?hasFieldPermission(resource,f.key,'read'):f.editable&&canWrite(resource,f.key,creating))&&!['detail_attachment','other_attachments','judgment_evidence','responsibility_judgments','responsibility_allocations'].includes(f.key)).map(f=><Form.Item className={f.key==='responsibility_reason'?'abnormal-judgment-reason':''} key={f.key} name={f.key} label={f.label} rules={[{required:f.required,message:`请填写${f.label}`}]}>{renderInput(f)}</Form.Item>)}
          </div></section>
          {canDisplay('judgment_evidence')&&<section className="abnormal-judgment-section abnormal-judgment-evidence"><Typography.Title level={5}>责任判定证据</Typography.Title>{formMode==='view'?<Space direction="vertical">{(editing?.judgment_evidence??[]).map((file:FileRef)=><Button key={file.id} type="link" onClick={()=>void download(`/abnormal-cost/resources/${resource}/${editing!.id}/attachments/${file.id}`,file.name).catch(error=>message.error(errorText(error)))}>{file.name}</Button>)}</Space>:<Form.Item name="judgment_evidence" rules={[{required:false,message:'请上传责任判定证据'}]}><FileInput purpose="EVIDENCE"/></Form.Item>}</section>}
          {(formMode==='view'?hasFieldPermission(resource,'responsibility_allocations','read'):canWrite(resource,'responsibility_allocations',creating))&&<section className="abnormal-judgment-section abnormal-judgment-allocations"><Typography.Title level={5}>责任划分</Typography.Title><ResponsibilityAllocationEditor options={options.data} form={form} canDelete={formMode!=='view'&&hasResourcePermission(resource,'delete')} disabled={formMode==='view'}/></section>}
        </div>:<>{fieldDefs.filter(f=>(formMode==='view'?hasFieldPermission(resource,f.key,'read'):f.editable&&canWrite(resource,f.key,creating))&&!['detail_attachment','other_attachments','judgment_evidence','responsibility_judgments','responsibility_allocations'].includes(f.key)).map(f=><Form.Item key={f.key} name={f.key} label={f.label} rules={[{required:f.required,message:`请填写${f.label}`}]}>{renderInput(f)}</Form.Item>)}</>}
      </Form>
    </Modal>
    <Modal title="准备导入附件" open={preparing} onCancel={()=>setPreparing(false)} footer={<Button onClick={()=>setPreparing(false)}>完成附件准备</Button>}>
      <Alert type="info" message="先上传，Excel附件列填写唯一文件名（多个附件使用JSON字符串数组），服务器校验用途和归属；同名文件会被拒绝。主单责任划分配置及判定责任划分请按模板填写说明填写JSON数组。"/>
      {resource===REQUEST&&canWrite(resource,'detail_attachment',hasResourcePermission(resource,'create'))&&<><Typography.Title level={5}>明细附件</Typography.Title><FileInput value={preparedDetail} onChange={setPreparedDetail} purpose="DETAIL" multipleDetail/></>}
      {canWrite(resource,resource===REQUEST?'other_attachments':'judgment_evidence',hasResourcePermission(resource,'create'))&&<><Typography.Title level={5}>{resource===REQUEST?'其他附件':'责任判定证据'}</Typography.Title><FileInput value={preparedOther} onChange={setPreparedOther} purpose={resource===REQUEST?'OTHER':'EVIDENCE'}/></>}
    </Modal>
    <Modal title="导入预览" open={Boolean(preview)} width={850} onCancel={()=>setPreview(null)} okText="确认导入" confirmLoading={importing} okButtonProps={{disabled:!preview?.previewId||Boolean(preview?.errors?.length)}} onOk={()=>{if(importing||!preview?.previewId)return;setImporting(true);void api(`/abnormal-cost/resources/${resource}/import-confirm`,{method:'POST',body:JSON.stringify({previewId:preview.previewId})}).then(async()=>{message.success('导入完成');setPreview(null);await refresh();}).catch(e=>message.error(errorText(e))).finally(()=>setImporting(false));}}>
      {preview&&<><p>共{preview.total}行</p>{preview.errors?.map((e:{row:number;reason:string},i:number)=><Alert key={i} type="error" message={`第${e.row}行：${e.reason}`}/>)}<div style={{maxHeight:300,overflow:'auto'}}>{preview.rows?.map((r:Row)=><div key={r.row}>第{r.row}行 · {r.id?'更新':'新增'}：{Object.entries(r.values??{}).map(([key,value])=>`${fieldDefs.find(f=>f.key===key)?.label??key}：${String(value??'清空')}`).join('；')}</div>)}</div></>}
    </Modal>
  </>;
}
