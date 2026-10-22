import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { reviewDueDateEditableKeys as keys, reviewDueDateRequiredCreateKeys, reviewDueDateResource as RESOURCE, type ReviewDueImportMode } from '@kdos/contracts';
import { reviewDueDateBusinessKey, reviewDueDateChange, reviewDueDateSnapshot, type ReviewDueDateSnapshot } from './review-due-date.domain';
import { hasMasterPlanFieldPermission as field, hasMasterPlanPermission as permission, hasReviewDueCreateFieldPermission, type MasterPlanActor } from './master-plan.types';
import { reviewDueColumns, reviewDueScope } from './review-due-date.query.service';
export type ReviewDueImportRow = {row:number;id:string|null;expectedVersion:number|null;values:Record<string,unknown>;sourceIdentity?:string[];changedKeys?:string[]};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Current=Record<string,any>;
@Injectable()
export class ReviewDueDateImportApplicationService {
  async authorize(actor:MasterPlanActor,m:EntityManager) {
    if(!actor.userId||!permission(actor,RESOURCE,'import'))throw new ForbiddenException('当前权限组没有评审交期表导入权限');
    await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
    if(!(await m.query('SELECT id FROM users WHERE tenant_id=$1 AND id=$2::uuid AND enabled',[actor.tenantId,actor.userId])).length)throw new ForbiddenException('当前操作人不是本租户有效用户');
  }
  private snapshot(row:Current):ReviewDueDateSnapshot {return reviewDueDateSnapshot(Object.fromEntries(keys.map(k=>[k,k==='inboundDate'?row.date_text:row[reviewDueColumns[k]]])) as ReviewDueDateSnapshot);}
  private async scope(row:Current,actor:MasterPlanActor,m:EntityManager,action:string) {
    const p:unknown[]=[JSON.stringify(row)],clause=reviewDueScope(actor,p,action);
    return !!(await m.query(`SELECT 1 FROM jsonb_populate_record(NULL::mps_review_due_dates,$1::jsonb) record WHERE ${clause}`,p)).length;
  }
  /** Validates proposed contents without mutating business rows; resolved identities stay in the private preview ledger. */
  async prepare(rows:ReviewDueImportRow[],mode:ReviewDueImportMode,actor:MasterPlanActor,m:EntityManager,resolved=false) {
    await this.authorize(actor,m);
    if(!['STANDARD','SOURCE'].includes(mode)||!rows.length||rows.length>50000)throw new BadRequestException('请选择明确导入模式且提供1至50000行');
    const errors:Array<{row:number;reason:string;conflict?:boolean}>=[],prepared:ReviewDueImportRow[]=[],plans:Array<{input:ReviewDueImportRow;current:Current|null;next:ReviewDueDateSnapshot;changed:string[];event:ReturnType<typeof reviewDueDateChange>;submitted:Record<string,unknown>}>=[];
    const seen=new Set<string>(),ids=new Set<string>();
    for(const input of rows){try{
      if(Object.keys(input.values).some(k=>!keys.includes(k)))throw new BadRequestException('文件包含不可导入的系统字段');
      for(const k of Object.keys(input.values))if(!field(actor,RESOURCE,k,'read')&&!field(actor,RESOURCE,k,'update'))throw new ForbiddenException('没有导入字段权限：'+k);
      if((input.id==null)!==(input.expectedVersion==null))throw new BadRequestException('新增时记录ID和版本都应留空；更新时必须同时填写');
      if(input.id&&(!uuid.test(input.id)||!Number.isSafeInteger(input.expectedVersion)||(input.expectedVersion??0)<1))throw new BadRequestException('更新必须填写有效记录ID和正整数版本');
      let next=reviewDueDateSnapshot({...input.values,inspectionTimeName:input.values.inspectionTimeName??''} as ReviewDueDateSnapshot);
      const key=reviewDueDateBusinessKey(next);if(seen.has(key))throw new ConflictException('来源文件同一订单号、批次号、图号出现多次，需人工核实');seen.add(key);
      const sourceIdentity=mode==='SOURCE'?(input.sourceIdentity??[next.orderNumber,next.batchNumber,next.drawingNumber]):undefined;
      let current:Current|null=null;
      if(mode==='SOURCE'&&!resolved){
        [current]=await m.query('SELECT *,inbound_date::text inbound_date,previous_inbound_date::text previous_inbound_date,inbound_date::text date_text FROM mps_review_due_dates WHERE tenant_id=$1 AND source_order_number=$2 AND source_batch_number=$3 AND source_drawing_number=$4',[actor.tenantId,...sourceIdentity!]);
      }else if(input.id){[current]=await m.query('SELECT *,inbound_date::text inbound_date,previous_inbound_date::text previous_inbound_date,inbound_date::text date_text FROM mps_review_due_dates WHERE tenant_id=$1 AND id=$2::uuid',[actor.tenantId,input.id]);if(!current)throw new ConflictException('记录不存在或不可访问，请核实ID与租户');}
      if(current){
        if(ids.has(current.id))throw new ConflictException('同一记录在文件中出现多次，需人工核实');ids.add(current.id);
        if((mode==='STANDARD'||resolved)&&current.version!==input.expectedVersion)throw new ConflictException('记录版本已变化，请刷新后重新预览');
        if(mode==='SOURCE'){
          if(JSON.stringify([current.source_order_number,current.source_batch_number,current.source_drawing_number])!==JSON.stringify(sourceIdentity))throw new ConflictException('来源身份已变化，需人工核实');
          if((await m.query("SELECT 1 FROM audit_logs WHERE tenant_id=$1 AND resource=$2 AND record_id=$3 AND (action='review_due_date.manually_created' OR (action='review_due_date.import_created' AND after_json->>'mode'='STANDARD')) LIMIT 1",[actor.tenantId,RESOURCE,current.id])).length)throw new ConflictException('来源与人工新增或标准模板新建记录重合，待人工核实，不自动覆盖');
          // Source keys identify, never overwrite the manually editable current business identity.
          next={...next,orderNumber:current.order_number,batchNumber:current.batch_number,drawingNumber:current.drawing_number};
        }
        if(!await this.scope(current,actor,m,'import'))throw new ForbiddenException('当前数据范围不允许导入该记录');
      }else{
        if(!permission(actor,RESOURCE,'create'))throw new ForbiddenException('新增导入还需要create权限');
        for(const k of new Set([...reviewDueDateRequiredCreateKeys,...Object.keys(input.values)]))if(!hasReviewDueCreateFieldPermission(actor,k))throw new ForbiddenException('没有新增字段填写权限：'+k);
      }
      const changed=current?keys.filter(k=>String(this.snapshot(current!)[k as keyof ReviewDueDateSnapshot]??'')!==String(next[k as keyof ReviewDueDateSnapshot])):keys;
      if(current)for(const k of changed)if(!field(actor,RESOURCE,k,'update'))throw new ForbiddenException('没有导入字段修改权限：'+k);
      const candidate={change_count:0,previous_inbound_date:null,last_changed_at:null,last_synced_at:null,...(current??{}),tenant_id:actor.tenantId,created_by:current?.created_by??actor.userId,updated_by:actor.userId,...Object.fromEntries(keys.map(k=>[reviewDueColumns[k],next[k as keyof ReviewDueDateSnapshot]]))};
      if(!await this.scope(candidate,actor,m,'import')||(!current&&!await this.scope(candidate,actor,m,'create')))throw new ForbiddenException('当前数据范围不允许导入修改后的内容');
      const duplicates=await m.query(`SELECT id FROM mps_review_due_dates WHERE tenant_id=$1 AND ($5::uuid IS NULL OR id<>$5::uuid) AND
        ((order_number=$2 AND batch_number=$3 AND drawing_number=$4) OR (source_order_number=$2 AND source_batch_number=$3 AND source_drawing_number=$4)) LIMIT 1`,[actor.tenantId,next.orderNumber,next.batchNumber,next.drawingNumber,current?.id??null]);
      if(duplicates.length)throw new ConflictException('业务键或保留来源身份已存在，待人工核实，不合并或覆盖');
      const value={...input,id:current?.id??null,expectedVersion:current?.version??null,values:next,changedKeys:changed,...(sourceIdentity?{sourceIdentity}:{})};prepared.push(value);
      plans.push({input:value,current,next,changed,submitted:input.values,event:current?reviewDueDateChange(current.date_text,next.inboundDate):null});
    }catch(e){if(e instanceof ForbiddenException)throw e;errors.push({row:input.row,reason:(e as Error).message,conflict:e instanceof ConflictException});}}
    const counts={total:rows.length,created:plans.filter(x=>!x.current).length,updated:plans.filter(x=>x.current&&x.changed.length).length,earlier:plans.filter(x=>x.event?.changeDirection==='EARLIER').length,later:plans.filter(x=>x.event?.changeDirection==='LATER').length,quantityChanged:plans.filter(x=>x.current&&x.changed.includes('quantity')).length,unchanged:plans.filter(x=>x.current&&!x.changed.length).length,conflicts:errors.filter(x=>x.conflict).length,errors:errors.filter(x=>!x.conflict).length};
    const previewRows=[];let restrictedComparison=false;
    for(const x of plans){const visible=!!x.current&&permission(actor,RESOURCE,'read')&&await this.scope(x.current,actor,m,'read');if(x.current&&(!visible||!field(actor,RESOURCE,'inboundDate','read')||!field(actor,RESOURCE,'quantity','read')))restrictedComparison=true;previewRows.push({values:x.submitted,row:x.input.row,classification:!x.current?'新增':x.changed.length?'更新':'未变化',orderNumber:visible&&field(actor,RESOURCE,'orderNumber','read')?x.next.orderNumber:x.submitted.orderNumber,batchNumber:visible&&field(actor,RESOURCE,'batchNumber','read')?x.next.batchNumber:x.submitted.batchNumber,drawingNumber:visible&&field(actor,RESOURCE,'drawingNumber','read')?x.next.drawingNumber:x.submitted.drawingNumber,newInboundDate:x.next.inboundDate,newQuantity:x.next.quantity,oldInboundDate:visible&&field(actor,RESOURCE,'inboundDate','read')?x.current!.date_text:null,oldQuantity:visible&&field(actor,RESOURCE,'quantity','read')?x.current!.quantity:null,expectedChangeCount:!x.current?0:visible&&field(actor,RESOURCE,'changeCount','read')?x.current!.change_count+(x.event?1:0):null});}
    return {counts,publicCounts:restrictedComparison?{...counts,earlier:null,later:null,quantityChanged:null}:counts,restrictedComparison,errors,rows:prepared,plans,previewRows};
  }
  async replayAccess(rows:ReviewDueImportRow[],actor:MasterPlanActor,m:EntityManager) {
    await this.authorize(actor,m);
    let comparisonReadable=true;
    for(const row of rows){
      for(const k of Object.keys(row.values))if(!field(actor,RESOURCE,k,'read')&&!field(actor,RESOURCE,k,'update'))throw new ForbiddenException('导入字段授权已变化');
      if(row.id){for(const k of row.changedKeys??[])if(!field(actor,RESOURCE,k,'update'))throw new ForbiddenException('导入字段修改授权已变化');}
      else if(!permission(actor,RESOURCE,'create'))throw new ForbiddenException('新增导入授权已变化');
      const current=row.id?(await m.query('SELECT *,inbound_date::text inbound_date,previous_inbound_date::text previous_inbound_date FROM mps_review_due_dates WHERE tenant_id=$1 AND id=$2::uuid',[actor.tenantId,row.id]))[0]:
        (await m.query('SELECT *,inbound_date::text inbound_date,previous_inbound_date::text previous_inbound_date FROM mps_review_due_dates WHERE tenant_id=$1 AND source_order_number=$2 AND source_batch_number=$3 AND source_drawing_number=$4',[actor.tenantId,...(row.sourceIdentity??[row.values.orderNumber,row.values.batchNumber,row.values.drawingNumber])]))[0];
      if(!current||!await this.scope(current,actor,m,'import'))throw new ForbiddenException('当前范围无权查看该导入结果');
      if(!permission(actor,RESOURCE,'read')||!field(actor,RESOURCE,'inboundDate','read')||!field(actor,RESOURCE,'quantity','read')||!await this.scope(current,actor,m,'read'))comparisonReadable=false;
    }
    return comparisonReadable;
  }
  /** Caller owns the existing preview-lock transaction: rows/history/audits/receipt/preview result commit together. */
  async confirm(rows:ReviewDueImportRow[],mode:ReviewDueImportMode,fileHash:string,batchId:string,actor:MasterPlanActor,m:EntityManager) {
    await this.authorize(actor,m);
    await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['review-due-import',actor.tenantId])]);
    const ids=rows.flatMap(r=>r.id?[r.id]:[]);if(ids.length)await m.query('SELECT id FROM mps_review_due_dates WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[actor.tenantId,ids]);
    const key=JSON.stringify(['review-due-import',actor.tenantId,actor.userId,batchId,fileHash]),hash=createHash('sha256').update(JSON.stringify([mode,rows])).digest('hex');
    const [receipt]=await m.query('SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1',[key]);
    if(receipt){if(receipt.request_hash!==hash)throw new ConflictException('导入批次内容不一致');const visible=await this.replayAccess(rows,actor,m);return {...receipt.response_json,...(!visible?{earlier:null,later:null,quantityChanged:null}:{}),repeated:true};}
    const result=await this.prepare(rows,mode,actor,m,true);
    if(result.errors.length)throw new ConflictException(result.errors.map(e=>`第${e.row}行：${e.reason}`).join('；'));
    try{for(const {current,next,changed,event}of result.plans){
      if(current&&!changed.length)continue;
      let row:Current;
      if(!current)[row]=await m.query(`INSERT INTO mps_review_due_dates(tenant_id,order_number,batch_number,drawing_number,inspection_time_name,inbound_date,quantity,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6::date,$7::numeric,$8::uuid,$8::uuid) RETURNING *`,[actor.tenantId,next.orderNumber,next.batchNumber,next.drawingNumber,next.inspectionTimeName,next.inboundDate,next.quantity,actor.userId]);
      else{
        const [{at}]=await m.query('SELECT clock_timestamp()::text at');
        if(event)await m.query(`INSERT INTO mps_review_due_date_changes(tenant_id,review_due_date_id,old_inbound_date,new_inbound_date,change_days,change_direction,changed_at,changed_by,source_kind,source_batch_id)
          VALUES($1,$2::uuid,$3::date,$4::date,$5,$6,$7::timestamptz,$8::uuid,'IMPORT',$9)`,[actor.tenantId,current.id,event.oldInboundDate,event.newInboundDate,event.changeDays,event.changeDirection,at,actor.userId,batchId]);
        const updated=await m.query(`UPDATE mps_review_due_dates SET order_number=$3,batch_number=$4,drawing_number=$5,inspection_time_name=$6,inbound_date=$7::date,quantity=$8::numeric,
          change_count=change_count+$9,previous_inbound_date=CASE WHEN $9::int=1 THEN inbound_date ELSE previous_inbound_date END,last_changed_at=CASE WHEN $9::int=1 THEN $10::timestamptz ELSE last_changed_at END,
          updated_by=$11,updated_at=$10::timestamptz,version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND version=$12 RETURNING *`,[actor.tenantId,current.id,next.orderNumber,next.batchNumber,next.drawingNumber,next.inspectionTimeName,next.inboundDate,next.quantity,event?1:0,at,actor.userId,current.version]);row=Array.isArray(updated[0])?updated[0][0]:updated[0];if(!row)throw new ConflictException('导入版本冲突');
      }
      await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,'web',$2::uuid,$2::uuid)`,[actor.tenantId,actor.userId,actor.username,RESOURCE,row.id,current?'review_due_date.import_updated':'review_due_date.import_created',current?JSON.stringify(current):null,JSON.stringify({...row,inbound_date:next.inboundDate,previous_inbound_date:event?event.oldInboundDate:current?.previous_inbound_date??null,sourceKind:'IMPORT',batchId,fileHash,mode}),actor.requestId]);
    }}catch(e){if((e as {code?:string}).code==='23505')throw new ConflictException('导入业务键、来源或事件重复，整批拒绝，请重新预览');throw e;}
    const response={...result.publicCounts,batchId,repeated:false};
    await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,after_json,request_id,source,created_by,updated_by)
      VALUES($1,$2::uuid,$3,$4,$5,'review_due_date.import_confirmed',$6::jsonb,$7,'web',$2::uuid,$2::uuid)`,[actor.tenantId,actor.userId,actor.username,RESOURCE,batchId,JSON.stringify({...result.counts,batchId,mode,fileHash}),actor.requestId]);
    await m.query('INSERT INTO idempotency_keys(id,key,request_hash,response_json,created_by,updated_by) VALUES(uuidv7(),$1,$2,$3::jsonb,$4::uuid,$4::uuid)',[key,hash,JSON.stringify(response),actor.userId]);
    return response;
  }
}
