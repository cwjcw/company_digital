import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { reviewDueDateBusinessKey, reviewDueDateSnapshot, assertReviewDueDivision, type ReviewDueDateSnapshot } from './review-due-date.domain';
import { reviewDueDateEditableKeys, reviewDueDateRequiredCreateKeys, reviewDueDateResource as RESOURCE } from '@kdos/contracts';
import { reviewDueColumns, reviewDueScope } from './review-due-date.query.service';
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, hasReviewDueCreateFieldPermission } from './master-plan.types';
import type { MasterPlanActor } from './master-plan.types';
import { OrganizationDirectoryService } from '../organization-directory/organization-directory.service';

type Input = Omit<ReviewDueDateSnapshot,'changeCount'|'previousInboundDate'> & Partial<Pick<ReviewDueDateSnapshot,'changeCount'|'previousInboundDate'>> & {
  sourceKind:'SYNC'|'IMPORT';sourceBatchId:string;expectedVersion?:number;allowInitialCreate?:boolean;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const code=(error:unknown)=>(error as {driverError?:{code?:string};code?:string})?.driverError?.code??(error as {code?:string})?.code;

/** Manual writes use record ID. Future source observations use immutable initial source identity. */
@Injectable()
export class ReviewDueDateApplicationService {
  constructor(private readonly db:DataSource,private readonly directory:OrganizationDirectoryService) {}

  private rowSnapshot(row:Record<string,any>):ReviewDueDateSnapshot {
    return reviewDueDateSnapshot(Object.fromEntries(reviewDueDateEditableKeys.map(key=>[key,key==='inboundDate'?row.date_text:key==='previousInboundDate'?row.previous_date_text:row[reviewDueColumns[key]]])) as ReviewDueDateSnapshot);
  }

  private async snapshot(input:Record<string,unknown>):Promise<ReviewDueDateSnapshot> {
    const options=await this.directory.listEnabled();
    const division=assertReviewDueDivision(this.directory.resolve(input.divisionId,options,'事业部'),options);
    return reviewDueDateSnapshot({...input,divisionId:division.id,inspectionTimeName:input.inspectionTimeName??null,changeCount:input.changeCount??null,previousInboundDate:input.previousInboundDate??null} as ReviewDueDateSnapshot);
  }

  async manualCreate(body:Record<string,unknown>,actor:MasterPlanActor) {
    if(!actor.userId||!actor.tenantId||!hasMasterPlanPermission(actor,RESOURCE,'create'))throw new ForbiddenException('当前权限组没有评审交期表新增权限');
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='commandId'&&!reviewDueDateEditableKeys.includes(key)))throw new BadRequestException('新增只允许填写九个业务字段，系统审计及来源字段由服务端生成');
    const submitted=Object.keys(body).filter(key=>key!=='commandId');
    for(const key of new Set([...reviewDueDateRequiredCreateKeys,...submitted]))if(!hasReviewDueCreateFieldPermission(actor,key))throw new ForbiddenException('没有字段填写权限：'+key);
    if(typeof body.commandId!=='string'||!uuid.test(body.commandId))throw new BadRequestException('commandId 必须为唯一请求UUID');
    let snapshot:ReviewDueDateSnapshot;
    try{snapshot=await this.snapshot(body);}catch(error){throw new BadRequestException((error as Error).message);}
    const hash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    const receiptKey=JSON.stringify(['review-due-manual-create',actor.tenantId,actor.userId,body.commandId]);
    try{return await this.db.transaction(async m=>{
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['review-due-write',actor.tenantId])]);
      const [member]=await m.query('SELECT id FROM users WHERE tenant_id=$1 AND id=$2::uuid AND enabled',[actor.tenantId,actor.userId]);
      if(!member)throw new ForbiddenException('操作人不是当前租户有效登录用户');
      const p:unknown[]=[actor.tenantId,snapshot.divisionId,snapshot.orderNumber,snapshot.batchNumber,snapshot.drawingNumber,snapshot.inspectionTimeName,snapshot.inboundDate,snapshot.quantity,snapshot.changeCount,snapshot.previousInboundDate,actor.userId];
      const scope=reviewDueScope(actor,p,'create');
      const [candidate]=await m.query(`SELECT record.id FROM (SELECT uuidv7() id,$1::varchar tenant_id,$2::uuid division_id,$3::text order_number,$4::text batch_number,$5::text drawing_number,
        $6::text inspection_time_name,$7::date inbound_date,$8::numeric quantity,$9::int change_count,$10::date previous_inbound_date,
        $11::uuid created_by,$11::uuid updated_by,now() created_at,now() updated_at,1 version) record WHERE ${scope}`,p);
      if(!candidate)throw new ForbiddenException('当前数据范围不允许新增该事业部的评审交期记录');
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[receiptKey]);
      const [receipt]=await m.query('SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1',[receiptKey]);
      if(receipt){if(receipt.request_hash!==hash)throw new ConflictException('同一新增请求不能提交不同内容');return {...receipt.response_json,repeated:true};}
      const [row]=await m.query(`INSERT INTO mps_review_due_dates(id,tenant_id,division_id,order_number,batch_number,drawing_number,inspection_time_name,inbound_date,quantity,change_count,previous_inbound_date,created_by,updated_by)
        VALUES($1::uuid,$2,$3::uuid,$4,$5,$6,$7,$8::date,$9::numeric,$10::int,$11::date,$12::uuid,$12::uuid) RETURNING *`,[candidate.id,actor.tenantId,snapshot.divisionId,snapshot.orderNumber,snapshot.batchNumber,snapshot.drawingNumber,snapshot.inspectionTimeName,snapshot.inboundDate,snapshot.quantity,snapshot.changeCount,snapshot.previousInboundDate,actor.userId]);
      await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5,'review_due_date.manually_created',NULL,$6::jsonb,$7,'web',$2::uuid,$2::uuid)`,[actor.tenantId,actor.userId,actor.username,RESOURCE,row.id,JSON.stringify({...row,sourceKind:'MANUAL',commandId:body.commandId}),actor.requestId]);
      const result={id:row.id,version:row.version,repeated:false};
      await m.query('INSERT INTO idempotency_keys(id,key,request_hash,response_json,created_by,updated_by) VALUES(uuidv7(),$1,$2,$3::jsonb,$4::uuid,$4::uuid)',[receiptKey,hash,JSON.stringify(result),actor.userId]);
      return result;
    });}catch(error){if(code(error)==='23505')throw new ConflictException('同一事业部的订单号、批次号、品项编码或保留来源身份已存在，请返回列表修改');throw error;}
  }

  async manualEdit(id:string,body:Record<string,unknown>,actor:MasterPlanActor) {
    if(!actor.userId||!hasMasterPlanPermission(actor,RESOURCE,'read')||!hasMasterPlanPermission(actor,RESOURCE,'update'))throw new ForbiddenException('当前权限组没有评审交期表修改权限');
    if(!uuid.test(id))throw new BadRequestException('评审交期记录ID无效');
    if(!body||typeof body!=='object'||Array.isArray(body))throw new BadRequestException('人工编辑请求无效');
    const keys=Object.keys(body).filter(key=>!['expectedVersion','commandId'].includes(key));
    if(!keys.length||keys.some(key=>!reviewDueDateEditableKeys.includes(key)))throw new BadRequestException('只允许修改九个业务字段，系统审计、来源身份和版本不可写入');
    for(const key of keys)if(!hasMasterPlanFieldPermission(actor,RESOURCE,key,'read')||!hasMasterPlanFieldPermission(actor,RESOURCE,key,'update'))throw new ForbiddenException('没有字段修改权限：'+key);
    if(typeof body.expectedVersion!=='number'||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1)throw new BadRequestException('expectedVersion 必须是正整数');
    if(typeof body.commandId!=='string'||!uuid.test(body.commandId))throw new BadRequestException('commandId 必须为唯一请求UUID');
    const hash=createHash('sha256').update(JSON.stringify([body.expectedVersion,...keys.sort().map(key=>[key,body[key]])])).digest('hex');
    const receiptKey=JSON.stringify(['review-due-manual',actor.tenantId,actor.userId,id,body.commandId]);
    try{return await this.db.transaction(async m=>{
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['review-due-write',actor.tenantId])]);
      const [member]=await m.query('SELECT id FROM users WHERE tenant_id=$1 AND id=$2::uuid AND enabled',[actor.tenantId,actor.userId]);
      if(!member)throw new ForbiddenException('操作人不是当前租户有效登录用户');
      const [current]=await m.query('SELECT *,inbound_date::text date_text,previous_inbound_date::text previous_date_text FROM mps_review_due_dates WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE',[actor.tenantId,id]);
      if(!current)throw new NotFoundException('评审交期记录不存在或不在当前租户');
      const assertScope=async()=>{const p:unknown[]=[actor.tenantId,id],scope=`(${reviewDueScope(actor,p,'read')}) AND (${reviewDueScope(actor,p,'update')})`;if(!(await m.query(`SELECT record.id FROM mps_review_due_dates record WHERE record.tenant_id=$1 AND record.id=$2::uuid AND ${scope}`,p)).length)throw new ForbiddenException('当前数据范围不允许修改该记录或修改后的内容');};
      await assertScope();
      const [receipt]=await m.query('SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1',[receiptKey]);
      if(receipt){if(receipt.request_hash!==hash)throw new ConflictException('同一人工编辑请求不能提交不同内容');return {...receipt.response_json,repeated:true};}
      if(current.version!==body.expectedVersion)throw new ConflictException('评审交期版本已变化，请刷新后重试');
      const before=this.rowSnapshot(current);let next:ReviewDueDateSnapshot;
      try{next=await this.snapshot({...before,...Object.fromEntries(keys.map(key=>[key,body[key]]))});}catch(error){throw new BadRequestException((error as Error).message);}
      const changed=reviewDueDateEditableKeys.filter(key=>String(before[key as keyof ReviewDueDateSnapshot]??'')!==String(next[key as keyof ReviewDueDateSnapshot]??''));
      const duplicates=await m.query(`SELECT id FROM mps_review_due_dates WHERE tenant_id=$1 AND id<>$2::uuid AND
        ((division_id=$3::uuid AND order_number=$4 AND batch_number=$5 AND drawing_number=$6) OR
         (source_division_id=$3::uuid AND source_order_number=$4 AND source_batch_number=$5 AND source_drawing_number=$6)) LIMIT 1`,[actor.tenantId,id,next.divisionId,next.orderNumber,next.batchNumber,next.drawingNumber]);
      if(duplicates.length)throw new ConflictException('同一事业部的业务键或保留来源身份已存在，不能合并记录');
      if(!changed.length){const result={id,version:current.version,dateChanged:false,changedFields:[],repeated:false};await m.query('INSERT INTO idempotency_keys(id,key,request_hash,response_json,created_by,updated_by) VALUES(uuidv7(),$1,$2,$3::jsonb,$4::uuid,$4::uuid)',[receiptKey,hash,JSON.stringify(result),actor.userId]);return result;}
      const [{at}]=await m.query('SELECT clock_timestamp()::text at');
      const updated=await m.query(`UPDATE mps_review_due_dates SET division_id=$3::uuid,order_number=$4,batch_number=$5,drawing_number=$6,inspection_time_name=$7,
        inbound_date=$8::date,quantity=$9::numeric,change_count=$10::int,previous_inbound_date=$11::date,updated_at=$12::timestamptz,updated_by=$13::uuid,version=version+1
        WHERE tenant_id=$1 AND id=$2::uuid AND version=$14 RETURNING *`,[actor.tenantId,id,next.divisionId,next.orderNumber,next.batchNumber,next.drawingNumber,next.inspectionTimeName,next.inboundDate,next.quantity,next.changeCount,next.previousInboundDate,at,actor.userId,body.expectedVersion]);
      const row=Array.isArray(updated[0])?updated[0][0]:updated[0];if(!row)throw new ConflictException('评审交期版本已变化，请刷新后重试');
      await assertScope();
      await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5,'review_due_date.manually_updated',$6::jsonb,$7::jsonb,$8,'web',$2::uuid,$2::uuid)`,[actor.tenantId,actor.userId,actor.username,RESOURCE,id,JSON.stringify(current),JSON.stringify({...row,commandId:body.commandId,sourceKind:'MANUAL',changedFields:changed}),actor.requestId]);
      const result={id,version:row.version,dateChanged:changed.includes('inboundDate'),changedFields:changed,repeated:false};
      await m.query('INSERT INTO idempotency_keys(id,key,request_hash,response_json,created_by,updated_by) VALUES(uuidv7(),$1,$2,$3::jsonb,$4::uuid,$4::uuid)',[receiptKey,hash,JSON.stringify(result),actor.userId]);return result;
    });}catch(error){if(code(error)==='23505')throw new ConflictException('同一事业部的订单号、批次号和品项编码已存在，不能合并记录');throw error;}
  }

  async observe(input:Input,actor:MasterPlanActor,manager?:EntityManager) {
    if(!actor.userId||!actor.tenantId||!(actor.isSystemAdmin||actor.moduleAdminCodes?.includes('planning')))throw new ForbiddenException('仅受控主计划应用命令可更新评审交期');
    if(!['SYNC','IMPORT'].includes(input.sourceKind)||typeof input.sourceBatchId!=='string'||!input.sourceBatchId.trim()||input.sourceBatchId.length>128)throw new BadRequestException('来源及来源批次无效');
    let snapshot:ReviewDueDateSnapshot;try{snapshot=await this.snapshot({...input,changeCount:null,previousInboundDate:null});}catch(error){throw new BadRequestException((error as Error).message);}
    const work=async(m:EntityManager)=>{
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['review-due-write',actor.tenantId])]);
      if(!(await m.query('SELECT id FROM users WHERE tenant_id=$1 AND id=$2::uuid',[actor.tenantId,actor.userId])).length)throw new ForbiddenException('操作人不属于当前租户');
      const businessKey=reviewDueDateBusinessKey(snapshot),keyHash=createHash('sha256').update(businessKey).digest('hex');
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['review-due',actor.tenantId,businessKey])]);
      const receiptKey=JSON.stringify(['review-due',actor.tenantId,keyHash,input.sourceKind,input.sourceBatchId]),hash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
      const [receipt]=await m.query('SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1',[receiptKey]);if(receipt){if(receipt.request_hash!==hash)throw new ConflictException('同一来源批次不能提交不同评审交期快照');return {...receipt.response_json,repeated:true};}
      const [current]=await m.query(`SELECT *,inbound_date::text date_text,previous_inbound_date::text previous_date_text FROM mps_review_due_dates
        WHERE tenant_id=$1 AND source_division_id=$2::uuid AND source_order_number=$3 AND source_batch_number=$4 AND source_drawing_number=$5 FOR UPDATE`,[actor.tenantId,snapshot.divisionId,snapshot.orderNumber,snapshot.batchNumber,snapshot.drawingNumber]);
      if(current&&(await m.query("SELECT 1 FROM audit_logs WHERE tenant_id=$1 AND record_id=$2 AND resource=$3 AND (action='review_due_date.manually_created' OR (action='review_due_date.import_created' AND after_json->>'mode'='STANDARD')) LIMIT 1",[actor.tenantId,current.id,RESOURCE])).length)throw new ConflictException('手工新增记录尚未确认外部来源身份，请人工核实后再接入同步');
      if(!current&&input.allowInitialCreate!==true)throw new ConflictException('来源身份无法可靠匹配，请人工核实；不会自动合并或新建记录');
      if(input.expectedVersion!==undefined&&(!current||current.version!==input.expectedVersion))throw new ConflictException('评审交期版本已变化，请刷新后重试');
      const [{at}]=await m.query('SELECT clock_timestamp()::text at');let row=current;let changed=true;
      if(!current)[row]=await m.query(`INSERT INTO mps_review_due_dates(tenant_id,division_id,order_number,batch_number,drawing_number,inspection_time_name,inbound_date,quantity,change_count,previous_inbound_date,last_synced_at,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5,$6,$7::date,$8::numeric,NULL,NULL,CASE WHEN $9='SYNC' THEN $11::timestamptz END,$10::uuid,$10::uuid) RETURNING *`,[actor.tenantId,snapshot.divisionId,snapshot.orderNumber,snapshot.batchNumber,snapshot.drawingNumber,snapshot.inspectionTimeName,snapshot.inboundDate,snapshot.quantity,input.sourceKind,actor.userId,at]);
      else{
        changed=String(current.inspection_time_name??'')!==String(snapshot.inspectionTimeName??'')||current.date_text!==snapshot.inboundDate||String(current.quantity)!==snapshot.quantity;
        if(changed){const updated=await m.query(`UPDATE mps_review_due_dates SET inspection_time_name=$3,inbound_date=$4::date,quantity=$5::numeric,last_synced_at=CASE WHEN $6='SYNC' THEN $8::timestamptz ELSE last_synced_at END,
          updated_at=$8::timestamptz,updated_by=$7::uuid,version=version+1 WHERE tenant_id=$1 AND id=$2::uuid RETURNING *`,[actor.tenantId,current.id,snapshot.inspectionTimeName,snapshot.inboundDate,snapshot.quantity,input.sourceKind,actor.userId,at]);row=Array.isArray(updated[0])?updated[0][0]:updated[0];}
      }
      if(!current||changed)await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$2::uuid,$2::uuid)`,[actor.tenantId,actor.userId,actor.username,RESOURCE,row.id,!current?'review_due_date.created':'review_due_date.observed',current?JSON.stringify(current):null,JSON.stringify({...row,sourceKind:input.sourceKind,sourceBatchId:input.sourceBatchId}),actor.requestId,actor.source==='system'?'api':actor.source]);
      const result={id:row.id,version:row.version,changeCount:row.change_count,dateChanged:!!current&&current.date_text!==snapshot.inboundDate,created:!current,changed,repeated:false};
      await m.query('INSERT INTO idempotency_keys(id,key,request_hash,response_json,created_by,updated_by) VALUES(uuidv7(),$1,$2,$3::jsonb,$4::uuid,$4::uuid)',[receiptKey,hash,JSON.stringify(result),actor.userId]);return result;
    };
    return manager?work(manager):this.db.transaction(work);
  }
}
