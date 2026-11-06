import {useEffect,useRef,useState,type ReactNode} from 'react';
import {DatePicker,Input,InputNumber,Select,Switch} from 'antd';
import dayjs from 'dayjs';
import {tablePermissionFieldsFor} from '@kdos/contracts';
import {hasFieldPermission,useKdosTableEditMode} from '../../shared/KdosDataTable';
import {OrganizationSelect,type OrganizationSelectOption} from '../../shared/OrganizationSelect';
const fields=tablePermissionFieldsFor('equipment-register');
const equal=(a:unknown,b:unknown)=>JSON.stringify(Array.isArray(a)?[...a].sort():a??null)===JSON.stringify(Array.isArray(b)?[...b].sort():b??null);
export function EquipmentRegisterCell({row,fieldKey,display,busy,onSave,organizations,members}:{row:Record<string,any>;fieldKey:string;display:ReactNode;busy:boolean;onSave:(key:string,value:unknown)=>Promise<void>;organizations:OrganizationSelectOption[];members:Array<{value:string;label:string}>}){
 const {editing}=useKdosTableEditMode(),field=fields.find(f=>f.key===fieldKey),value=row[fieldKey];
 const [draft,setDraft]=useState<any>(value),lock=useRef(false);
 useEffect(()=>setDraft(value),[value,row.version]);
 if(!editing||!field?.editable||fieldKey==='equipmentCode'||row.canUpdate!==true||!hasFieldPermission('equipment-register',fieldKey,'read')||!hasFieldPermission('equipment-register',fieldKey,'update'))return <>{display}</>;
 const commit=async(next:unknown=draft)=>{
  if(busy||lock.current||equal(value,next))return;
  lock.current=true;try{await onSave(fieldKey,next);}catch{setDraft(value);}finally{lock.current=false;}
 };
 if(fieldKey==='divisionId'||fieldKey==='usageDepartmentId')return <OrganizationSelect aria-label={field.label} size="small" allowClear={fieldKey==='usageDepartmentId'} value={draft??undefined} organizations={organizations} disabled={busy} onChange={next=>{setDraft(next??null);void commit(next??null);}}/>;
 if(field.type==='member')return <Select aria-label={field.label} size="small" mode="multiple" allowClear options={members} value={draft??[]} disabled={busy} showSearch optionFilterProp="label" maxTagCount="responsive" style={{width:'100%'}} onChange={next=>{setDraft(next);void commit(next);}}/>;
 if(field.type==='boolean')return <Switch aria-label={field.label} size="small" checked={!!draft} disabled={busy} onChange={next=>{setDraft(next);void commit(next);}}/>;
 if(field.type==='date')return <DatePicker aria-label={field.label} size="small" value={draft?dayjs(draft):null} disabled={busy} onChange={next=>{const v=next?.format('YYYY-MM-DD')??null;setDraft(v);void commit(v);}} style={{width:'100%'}}/>;
 if(field.type==='number')return <InputNumber aria-label={field.label} size="small" min={0} precision={0} value={draft??null} disabled={busy} addonAfter="分钟" onChange={setDraft} onBlur={()=>void commit()} onPressEnter={e=>e.currentTarget.blur()} style={{width:'100%'}}/>;
 return <Input aria-label={field.label} size="small" value={draft??''} disabled={busy} onChange={e=>setDraft(e.target.value)} onBlur={()=>void commit()} onPressEnter={e=>e.currentTarget.blur()}/>;
}
