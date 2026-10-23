import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { reviewDueDateEditableKeys as keys, reviewDueDateRequiredCreateKeys, reviewDueDateResource as RESOURCE, type ReviewDueImportMode } from '@kdos/contracts';
import { assertReviewDueDivision, reviewDueDateBusinessKey, reviewDueDateChange, reviewDueDateSnapshot, type ReviewDueDateSnapshot } from './review-due-date.domain';
import { hasMasterPlanFieldPermission as field, hasMasterPlanPermission as permission, hasReviewDueCreateFieldPermission, type MasterPlanActor } from './master-plan.types';
import { reviewDueColumns, reviewDueScope } from './review-due-date.query.service';
import { OrganizationDirectoryService } from '../organization-directory/organization-directory.service';

export type ReviewDueImportRow = {row:number;id:string|null;expectedVersion:number|null;values:Record<string,unknown>;sourceIdentity?:string[];changedKeys?:string[]};
type Current=Record<string,any>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
@Injectable()
export class ReviewDueDateImportApplicationService {
  constructor(private readonly directory:OrganizationDirectoryService){}
  async authorize(actor:MasterPlanActor,m:EntityManager) {
    if(!actor.userId||!permission(actor,RESOURCE,'import'))throw new ForbiddenException('当前权限组没有评审交期表导入权限');
    await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
    if(!(await m.query('SELECT id FROM users WHERE tenant_id=$1 AND id=$2::uuid AND enabled',[actor.tenantId,actor.userId])).length)throw new ForbiddenException('当前操作人不是本租户有效用户');
  }
  private snapshot(row:Current):ReviewDueDateSnapshot {
    return reviewDueDateSnapshot(Object.fromEntries(keys.map(k=>[k,k==='inboundDate'?row.date_text:k==='previousInboundDate'?row.previous_date_text:row[reviewDueColumns[k]]])) as ReviewDueDateSnapshot);
  }
  private async scope(row:Current,actor:MasterPlanActor,m:EntityManager,action:string) {
    const p:unknown[]=[JSON.stringify(row)],clause=reviewDueScope(actor,p,action);
    return !!(await m.query(`SELECT 1 FROM jsonb_populate_record(NULL::mps_review_due_dates,$1::jsonb) record WHERE ${clause}`,p)).length;
  }
  async prepare(rows:ReviewDueImportRow[],mode:ReviewDueImportMode,actor:MasterPlanActor,m:EntityManager) {
    await this.authorize(actor,m);
    if(!['STANDARD','SOURCE'].includes(mode)||!rows.length||rows.length>50000)throw new BadRequestException('导入批次类型无效，或未提供1至50000行');
    const options=await this.directory.listEnabled();
    const errors:Array<{row:number;reason:string;conflict?:boolean}>=[],prepared:ReviewDueImportRow[]=[],plans:Array<{input:ReviewDueImportRow;current:Current|null;next:ReviewDueDateSnapshot;changed:string[];event:ReturnType<typeof reviewDueDateChange>}>=[];
    const seen=new Set<string>(),ids=new Set<string>();
    for(const input of rows){try{
      if(Object.keys(input.values).some(k=>!keys.includes(k)))throw new BadRequestException('文件包含不可导入的系统字段');
      for(const k of Object.keys(input.values))if(!field(actor,RESOURCE,k,'read')&&!field(actor,RESOURCE,k,'update'))throw new ForbiddenException('没有导入字段权限：'+k);
      if((input.id==null)!==(input.expectedVersion==null))throw new BadRequestException('新增时记录ID和版本都应留空；更新时必须同时填写');
      if(input.id&&(!uuid.test(input.id)||!Number.isSafeInteger(input.expectedVersion)||(input.expectedVersion??0)<1))throw new BadRequestException('更新必须填写有效记录ID和正整数版本');
      // Old preview ledgers without an explicit division cannot infer ownership after V2.
      if(mode==='SOURCE')throw new ConflictException('旧来源预览缺少新版事业部身份，请下载当前模板重新预览；不会自动匹配或覆盖');
      let current:Current|null=null;
      if(input.id){[current]=await m.query('SELECT *,inbound_date::text date_text,previous_inbound_date::text previous_date_text FROM mps_review_due_dates WHERE tenant_id=$1 AND id=$2::uuid',[actor.tenantId,input.id]);if(!current)throw new ConflictException('记录不存在或不可访问，请核实ID与租户');}
      if(current){
        if(ids.has(current.id))throw new ConflictException('同一记录在文件中出现多次，需人工核实');ids.add(current.id);
        if(current.version!==input.expectedVersion)throw new ConflictException('记录版本已变化，请刷新后重新预览');
        if(!await this.scope(current,actor,m,'import'))throw new ForbiddenException('当前数据范围不允许导入该记录');
      }else{
        if(!permission(actor,RESOURCE,'create'))throw new ForbiddenException('新增导入还需要create权限');
        for(const k of new Set([...reviewDueDateRequiredCreateKeys,...Object.keys(input.values)]))if(!hasReviewDueCreateFieldPermission(actor,k))throw new ForbiddenException('没有新增字段填写权限：'+k);
      }
      const proposed={...(current?this.snapshot(current):{}),...input.values};
      const division=assertReviewDueDivision(this.directory.resolve(proposed.divisionId,options,'事业部'),options);
      const next=reviewDueDateSnapshot({...proposed,divisionId:division.id} as ReviewDueDateSnapshot);
      const key=reviewDueDateBusinessKey(next);if(seen.has(key))throw new ConflictException('文件内同一事业部、订单号、批次号和品项编码重复');seen.add(key);
      const before=current?this.snapshot(current):null;
      const changed=current?keys.filter(k=>String(before![k as keyof ReviewDueDateSnapshot]??'')!==String(next[k as keyof ReviewDueDateSnapshot]??'')):Object.keys(input.values);
      if(current)for(const k of changed)if(!field(actor,RESOURCE,k,'update'))throw new ForbiddenException('没有导入字段修改权限：'+k);
      const candidate={...(current??{}),tenant_id:actor.tenantId,created_by:current?.created_by??actor.userId,updated_by:actor.userId,...Object.fromEntries(keys.map(k=>[reviewDueColumns[k],next[k as keyof ReviewDueDateSnapshot]]))};
      if(!await this.scope(candidate,actor,m,'import')||(!current&&!await this.scope(candidate,actor,m,'create')))throw new ForbiddenException('当前数据范围不允许导入修改后的内容');
      const duplicates=await m.query(`SELECT id FROM mps_review_due_dates WHERE tenant_id=$1 AND ($6::uuid IS NULL OR id<>$6::uuid) AND
        ((division_id=$2::uuid AND order_number=$3 AND batch_number=$4 AND drawing_number=$5) OR (source_division_id=$2::uuid AND source_order_number=$3 AND source_batch_number=$4 AND source_drawing_number=$5)) LIMIT 1`,[actor.tenantId,next.divisionId,next.orderNumber,next.batchNumber,next.drawingNumber,current?.id??null]);
      if(duplicates.length)throw new ConflictException('同一事业部的业务键或保留来源身份已存在，不合并或覆盖');
      // Preserve sparse update intent: omitted optional fields never become writes on confirm.
      const values=Object.fromEntries(Object.keys(input.values).map(k=>[k,next[k as keyof ReviewDueDateSnapshot]]));
      const value={...input,id:current?.id??null,expectedVersion:current?.version??null,values,changedKeys:changed};prepared.push(value);
      plans.push({input:value,current,next,changed,event:current?reviewDueDateChange(current.date_text,next.inboundDate):null});
    }catch(e){if(e instanceof ForbiddenException)throw e;errors.push({row:input.row,reason:(e as Error).message,conflict:e instanceof ConflictException});}}
    const counts={total:rows.length,created:plans.filter(x=>!x.current).length,updated:plans.filter(x=>x.current&&x.changed.length).length,earlier:plans.filter(x=>x.event?.changeDirection==='EARLIER').length,later:plans.filter(x=>x.event?.changeDirection==='LATER').length,quantityChanged:plans.filter(x=>x.current&&x.changed.includes('quantity')).length,unchanged:plans.filter(x=>x.current&&!x.changed.length).length,conflicts:errors.filter(x=>x.conflict).length,errors:errors.filter(x=>!x.conflict).length};
    const previewRows=[];let restrictedComparison=false;
    for(const x of plans){const visible=!!x.current&&permission(actor,RESOURCE,'read')&&await this.scope(x.current,actor,m,'read');if(x.current&&(!visible||!field(actor,RESOURCE,'inboundDate','read')||!field(actor,RESOURCE,'quantity','read')))restrictedComparison=true;
      const show=(key:keyof ReviewDueDateSnapshot)=>Object.hasOwn(x.input.values,key)||visible&&field(actor,RESOURCE,key,'read')?x.next[key]:null;
      previewRows.push({values:x.input.values,row:x.input.row,classification:!x.current?'新增':x.changed.length?'更新':'未变化',divisionName:show('divisionId')?options.find(o=>o.id===x.next.divisionId)?.pathLabel:null,orderNumber:show('orderNumber'),batchNumber:show('batchNumber'),drawingNumber:show('drawingNumber'),newInboundDate:show('inboundDate'),newQuantity:show('quantity'),oldInboundDate:visible&&field(actor,RESOURCE,'inboundDate','read')?x.current!.date_text:null,oldQuantity:visible&&field(actor,RESOURCE,'quantity','read')?x.current!.quantity:null,expectedChangeCount:show('changeCount')});}
    return {counts,publicCounts:restrictedComparison?{...counts,earlier:null,later:null,quantityChanged:null}:counts,restrictedComparison,errors,rows:prepared,plans,previewRows};
  }
  async replayAccess(rows:ReviewDueImportRow[],actor:MasterPlanActor,m:EntityManager) {
    await this.authorize(actor,m);let comparisonReadable=true;
    for(const row of rows){
      for(const k of Object.keys(row.values))if(!field(actor,RESOURCE,k,'read')&&!field(actor,RESOURCE,k,'update'))throw new ForbiddenException('导入字段授权已变化');
      if(row.id){for(const k of row.changedKeys??[])if(!field(actor,RESOURCE,k,'update'))throw new ForbiddenException('导入字段修改授权已变化');}
      else {if(!permission(actor,RESOURCE,'create'))throw new ForbiddenException('新增导入授权已变化');for(const k of new Set([...reviewDueDateRequiredCreateKeys,...Object.keys(row.values)]))if(!hasReviewDueCreateFieldPermission(actor,k))throw new ForbiddenException('新增字段填写授权已变化');}
      const current=row.id?(await m.query('SELECT * FROM mps_review_due_dates WHERE tenant_id=$1 AND id=$2::uuid',[actor.tenantId,row.id]))[0]:
        (await m.query('SELECT * FROM mps_review_due_dates WHERE tenant_id=$1 AND source_division_id=$2::uuid AND source_order_number=$3 AND source_batch_number=$4 AND source_drawing_number=$5',[actor.tenantId,row.values.divisionId,row.values.orderNumber,row.values.batchNumber,row.values.drawingNumber]))[0];
      if(!current||!await this.scope(current,actor,m,'import')||(!row.id&&!await this.scope(current,actor,m,'create')))throw new ForbiddenException('当前范围无权查看该导入结果');
      if(!permission(actor,RESOURCE,'read')||!field(actor,RESOURCE,'inboundDate','read')||!field(actor,RESOURCE,'quantity','read')||!await this.scope(current,actor,m,'read'))comparisonReadable=false;
    }return comparisonReadable;
  }
  /** Caller owns the preview-lock transaction: business rows, audit, receipt and result commit together. */
  async confirm(rows:ReviewDueImportRow[],mode:ReviewDueImportMode,fileHash:string,batchId:string,actor:MasterPlanActor,m:EntityManager) {
    await this.authorize(actor,m);
    await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['review-due-write',actor.tenantId])]);
    const ids=rows.flatMap(r=>r.id?[r.id]:[]);if(ids.length)await m.query('SELECT id FROM mps_review_due_dates WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[actor.tenantId,ids]);
    const key=JSON.stringify(['review-due-import',actor.tenantId,actor.userId,batchId,fileHash]),hash=createHash('sha256').update(JSON.stringify([mode,rows])).digest('hex');
    const [receipt]=await m.query('SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1',[key]);
    if(receipt){if(receipt.request_hash!==hash)throw new ConflictException('导入批次内容不一致');const visible=await this.replayAccess(rows,actor,m);return {...receipt.response_json,...(!visible?{earlier:null,later:null,quantityChanged:null}:{}),repeated:true};}
    const result=await this.prepare(rows,mode,actor,m);if(result.errors.length)throw new ConflictException(result.errors.map(e=>`第${e.row}行：${e.reason}`).join('；'));
    try{for(const {current,next,changed}of result.plans){
      if(current&&!changed.length)continue;let row:Current;
      if(!current)[row]=await m.query(`INSERT INTO mps_review_due_dates(tenant_id,division_id,order_number,batch_number,drawing_number,inspection_time_name,inbound_date,quantity,change_count,previous_inbound_date,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5,$6,$7::date,$8::numeric,$9::int,$10::date,$11::uuid,$11::uuid) RETURNING *`,[actor.tenantId,next.divisionId,next.orderNumber,next.batchNumber,next.drawingNumber,next.inspectionTimeName,next.inboundDate,next.quantity,next.changeCount,next.previousInboundDate,actor.userId]);
      else{const updated=await m.query(`UPDATE mps_review_due_dates SET division_id=$3::uuid,order_number=$4,batch_number=$5,drawing_number=$6,inspection_time_name=$7,inbound_date=$8::date,quantity=$9::numeric,
        change_count=$10::int,previous_inbound_date=$11::date,updated_by=$12::uuid,updated_at=clock_timestamp(),version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND version=$13 RETURNING *`,[actor.tenantId,current.id,next.divisionId,next.orderNumber,next.batchNumber,next.drawingNumber,next.inspectionTimeName,next.inboundDate,next.quantity,next.changeCount,next.previousInboundDate,actor.userId,current.version]);row=Array.isArray(updated[0])?updated[0][0]:updated[0];if(!row)throw new ConflictException('导入版本冲突');}
      await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,'web',$2::uuid,$2::uuid)`,[actor.tenantId,actor.userId,actor.username,RESOURCE,row.id,current?'review_due_date.import_updated':'review_due_date.import_created',current?JSON.stringify(current):null,JSON.stringify({...row,sourceKind:'IMPORT',batchId,fileHash,mode,changedFields:changed}),actor.requestId]);
    }}catch(e){if(((e as {driverError?:{code?:string}}).driverError?.code??(e as {code?:string}).code)==='23505')throw new ConflictException('导入业务键或来源重复，整批拒绝，请重新预览');throw e;}
    const response={...result.publicCounts,batchId,repeated:false};
    await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,after_json,request_id,source,created_by,updated_by)
      VALUES($1,$2::uuid,$3,$4,$5,'review_due_date.import_confirmed',$6::jsonb,$7,'web',$2::uuid,$2::uuid)`,[actor.tenantId,actor.userId,actor.username,RESOURCE,batchId,JSON.stringify({...result.counts,batchId,mode,fileHash}),actor.requestId]);
    await m.query('INSERT INTO idempotency_keys(id,key,request_hash,response_json,created_by,updated_by) VALUES(uuidv7(),$1,$2,$3::jsonb,$4::uuid,$4::uuid)',[key,hash,JSON.stringify(response),actor.userId]);return response;
  }
}
