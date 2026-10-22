import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { reviewDueDateBusinessKey, reviewDueDateChange, reviewDueDateSnapshot, type ReviewDueDateSnapshot } from './review-due-date.domain';
import { reviewDueDateEditableKeys, reviewDueDateRequiredCreateKeys, reviewDueDateResource as RESOURCE } from '@kdos/contracts';
import { reviewDueColumns, reviewDueScope } from './review-due-date.query.service';
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, hasReviewDueCreateFieldPermission } from './master-plan.types';
import type { MasterPlanActor } from './master-plan.types';

type Input = ReviewDueDateSnapshot & { sourceKind: 'SYNC'|'IMPORT'; sourceBatchId: string; expectedVersion?: number; allowInitialCreate?: boolean };
/** Manual writes use record ID. Future source observations use immutable initial source identity. */
@Injectable()
export class ReviewDueDateApplicationService {
  constructor(private readonly db: DataSource) {}
  async manualCreate(body: Record<string, unknown>, actor: MasterPlanActor) {
    if (!actor.userId || !actor.tenantId || !hasMasterPlanPermission(actor,RESOURCE,'create')) throw new ForbiddenException('当前权限组没有评审交期表新增权限');
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k=>k!=='commandId'&&!reviewDueDateEditableKeys.includes(k))) throw new BadRequestException('新增只允许填写六个业务字段，系统字段由服务端生成');
    const submitted=Object.keys(body).filter(k=>k!=='commandId');
    for (const key of new Set([...reviewDueDateRequiredCreateKeys,...submitted])) if (!hasReviewDueCreateFieldPermission(actor,key)) throw new ForbiddenException('没有字段填写权限：'+key);
    if (typeof body.commandId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.commandId)) throw new BadRequestException('commandId 必须为唯一请求UUID');
    let snapshot:ReviewDueDateSnapshot;
    try { snapshot=reviewDueDateSnapshot({...body,inspectionTimeName:body.inspectionTimeName??''} as ReviewDueDateSnapshot); }
    catch(error) { throw new BadRequestException((error as Error).message); }
    const hash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    const receiptKey=JSON.stringify(['review-due-manual-create',actor.tenantId,actor.userId,body.commandId]);
    try { return await this.db.transaction(async m=>{
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      const [member]=await m.query('SELECT id FROM users WHERE tenant_id=$1 AND id=$2::uuid AND enabled',[actor.tenantId,actor.userId]);
      if(!member) throw new ForbiddenException('操作人不是当前租户有效登录用户');
      const p:unknown[]=[actor.tenantId,snapshot.orderNumber,snapshot.batchNumber,snapshot.drawingNumber,snapshot.inspectionTimeName,snapshot.inboundDate,snapshot.quantity,actor.userId];
      const scope=reviewDueScope(actor,p,'create');
      const [candidate]=await m.query(`SELECT record.id FROM (SELECT uuidv7() id,$1::varchar tenant_id,$2::text order_number,$3::text batch_number,$4::text drawing_number,
        $5::text inspection_time_name,$6::date inbound_date,$7::numeric quantity,0::int change_count,NULL::date previous_inbound_date,NULL::timestamptz last_changed_at,
        NULL::timestamptz last_synced_at,$8::uuid created_by,$8::uuid updated_by,now() created_at,now() updated_at,1 version) record WHERE ${scope}`,p);
      if(!candidate) throw new ForbiddenException('当前数据范围不允许新增此评审交期记录');
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[receiptKey]);
      const [receipt]=await m.query('SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1',[receiptKey]);
      if(receipt){if(receipt.request_hash!==hash)throw new ConflictException('同一新增请求不能提交不同内容');return {...receipt.response_json,repeated:true};}
      const [row]=await m.query(`INSERT INTO mps_review_due_dates(id,tenant_id,order_number,batch_number,drawing_number,inspection_time_name,inbound_date,quantity,created_by,updated_by)
        VALUES($1::uuid,$2,$3,$4,$5,$6,$7::date,$8::numeric,$9::uuid,$9::uuid) RETURNING *`,[candidate.id,actor.tenantId,snapshot.orderNumber,snapshot.batchNumber,snapshot.drawingNumber,snapshot.inspectionTimeName,snapshot.inboundDate,snapshot.quantity,actor.userId]);
      await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5,'review_due_date.manually_created',NULL,$6::jsonb,$7,'web',$2::uuid,$2::uuid)`,[actor.tenantId,actor.userId,actor.username,RESOURCE,row.id,JSON.stringify({...row,sourceKind:'MANUAL',commandId:body.commandId}),actor.requestId]);
      const result={id:row.id,version:row.version,repeated:false};
      await m.query('INSERT INTO idempotency_keys(id,key,request_hash,response_json,created_by,updated_by) VALUES(uuidv7(),$1,$2,$3::jsonb,$4::uuid,$4::uuid)',[receiptKey,hash,JSON.stringify(result),actor.userId]);
      return result;
    }); } catch(error) {
      if((error as {code?:string}).code==='23505') throw new ConflictException('订单号、批次号、试制计划图号或初始来源身份已存在，请核实并修改已有记录');
      throw error;
    }
  }
  async manualEdit(id: string, body: Record<string, unknown>, actor: MasterPlanActor) {
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!actor.userId || !hasMasterPlanPermission(actor,RESOURCE,'read') || !hasMasterPlanPermission(actor,RESOURCE,'update')) throw new ForbiddenException('当前权限组没有评审交期表修改权限');
    if (!uuid.test(id)) throw new BadRequestException('评审交期记录ID无效');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('人工编辑请求无效');
    const keys=Object.keys(body).filter(k=>!['expectedVersion','commandId'].includes(k));
    if (!keys.length || keys.some(k=>!reviewDueDateEditableKeys.includes(k))) throw new BadRequestException('只允许修改六个业务字段，系统维护字段不可写入');
    for (const key of keys) if (!hasMasterPlanFieldPermission(actor,RESOURCE,key,'read') || !hasMasterPlanFieldPermission(actor,RESOURCE,key,'update')) throw new ForbiddenException('没有字段修改权限：'+key);
    if (typeof body.expectedVersion !== 'number' || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion<1) throw new BadRequestException('expectedVersion 必须是正整数');
    if (typeof body.commandId !== 'string' || !uuid.test(body.commandId)) throw new BadRequestException('commandId 必须为唯一请求UUID');
    const hash=createHash('sha256').update(JSON.stringify([body.expectedVersion,...keys.sort().map(k=>[k,body[k]])])).digest('hex');
    const receiptKey=JSON.stringify(['review-due-manual',actor.tenantId,actor.userId,id,body.commandId]);
    try { return await this.db.transaction(async m=>{
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      const [member]=await m.query('SELECT id FROM users WHERE tenant_id=$1 AND id=$2::uuid AND enabled',[actor.tenantId,actor.userId]);
      if (!member) throw new ForbiddenException('操作人不是当前租户有效登录用户');
      const [current]=await m.query('SELECT *,inbound_date::text date_text FROM mps_review_due_dates WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE',[actor.tenantId,id]);
      if (!current) throw new NotFoundException('评审交期记录不存在或不在当前租户');
      const assertScope=async()=>{
        const p:unknown[]=[actor.tenantId,id];
        const scope=`(${reviewDueScope(actor,p,'read')}) AND (${reviewDueScope(actor,p,'update')})`;
        const allowed=await m.query(`SELECT record.id FROM mps_review_due_dates record WHERE record.tenant_id=$1 AND record.id=$2::uuid AND ${scope}`,p);
        if (!allowed.length) throw new ForbiddenException('当前数据范围不允许修改该记录或修改后的内容');
      };
      await assertScope();
      const [receipt]=await m.query('SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1',[receiptKey]);
      if (receipt) { if(receipt.request_hash!==hash) throw new ConflictException('同一人工编辑请求不能提交不同内容'); return {...receipt.response_json,repeated:true}; }
      if (current.version!==body.expectedVersion) throw new ConflictException('评审交期版本已变化，请刷新后重试');
      let next:ReviewDueDateSnapshot;
      try { next=reviewDueDateSnapshot({...Object.fromEntries(reviewDueDateEditableKeys.map(k=>[k,k==='inboundDate'?current.date_text:current[reviewDueColumns[k]]])),...Object.fromEntries(keys.map(k=>[k,body[k]]))} as ReviewDueDateSnapshot); }
      catch(error) { throw new BadRequestException((error as Error).message); }
      const event=reviewDueDateChange(current.date_text,next.inboundDate);
      const [{at}]=await m.query('SELECT clock_timestamp()::text at');
      if (event) await m.query(`INSERT INTO mps_review_due_date_changes(tenant_id,review_due_date_id,old_inbound_date,new_inbound_date,change_days,change_direction,changed_at,changed_by,source_kind,source_batch_id)
        VALUES($1,$2::uuid,$3::date,$4::date,$5,$6,$7::timestamptz,$8::uuid,'MANUAL',$9)`,[actor.tenantId,id,event.oldInboundDate,event.newInboundDate,event.changeDays,event.changeDirection,at,actor.userId,'manual:'+body.commandId]);
      const updated=await m.query(`UPDATE mps_review_due_dates SET order_number=$3,batch_number=$4,drawing_number=$5,inspection_time_name=$6,quantity=$7::numeric,
        inbound_date=$8::date,change_count=change_count+$9,previous_inbound_date=CASE WHEN $9::int=1 THEN inbound_date ELSE previous_inbound_date END,
        last_changed_at=CASE WHEN $9::int=1 THEN $10::timestamptz ELSE last_changed_at END,updated_at=$10::timestamptz,updated_by=$11,version=version+1
        WHERE tenant_id=$1 AND id=$2::uuid AND version=$12 RETURNING *`,[actor.tenantId,id,next.orderNumber,next.batchNumber,next.drawingNumber,next.inspectionTimeName,next.quantity,next.inboundDate,event?1:0,at,actor.userId,body.expectedVersion]);
      const row=Array.isArray(updated[0])?updated[0][0]:updated[0];
      if (!row) throw new ConflictException('评审交期版本已变化，请刷新后重试');
      await assertScope();
      await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5,'review_due_date.manually_updated',$6::jsonb,$7::jsonb,$8,'web',$2::uuid,$2::uuid)`,[actor.tenantId,actor.userId,actor.username,RESOURCE,id,JSON.stringify(current),JSON.stringify({...row,commandId:body.commandId,sourceKind:'MANUAL',changedFields:keys}),actor.requestId]);
      const result={id,version:row.version,dateChanged:!!event,repeated:false};
      await m.query('INSERT INTO idempotency_keys(id,key,request_hash,response_json,created_by,updated_by) VALUES(uuidv7(),$1,$2,$3::jsonb,$4::uuid,$4::uuid)',[receiptKey,hash,JSON.stringify(result),actor.userId]);
      return result;
    }); } catch(error) {
      if ((error as {code?:string}).code==='23505') throw new ConflictException('订单号、批次号和试制计划图号已存在，不能合并记录');
      throw error;
    }
  }
  async observe(input: Input, actor: MasterPlanActor, manager?: EntityManager) {
    if (!actor.userId || !actor.tenantId || !(actor.isSystemAdmin || actor.moduleAdminCodes?.includes('planning'))) throw new ForbiddenException('仅受控主计划应用命令可更新评审交期');
    if (!['SYNC','IMPORT'].includes(input.sourceKind) || typeof input.sourceBatchId !== 'string' || !input.sourceBatchId.trim() || input.sourceBatchId.length>128) throw new BadRequestException('来源及来源批次无效');
    let snapshot: ReviewDueDateSnapshot;
    try { snapshot=reviewDueDateSnapshot(input); } catch(error) { throw new BadRequestException((error as Error).message); }
    const work = async (m: EntityManager) => {
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      const [member]=await m.query('SELECT id FROM users WHERE tenant_id=$1 AND id=$2::uuid',[actor.tenantId,actor.userId]);
      if (!member) throw new ForbiddenException('操作人不属于当前租户');
      const businessKey=reviewDueDateBusinessKey(snapshot),keyHash=createHash('sha256').update(businessKey).digest('hex');
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['review-due',actor.tenantId,businessKey])]);
      const receiptKey=JSON.stringify(['review-due',actor.tenantId,keyHash,input.sourceKind,input.sourceBatchId]);
      const hash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
      const [receipt]=await m.query('SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1',[receiptKey]);
      if (receipt) { if(receipt.request_hash!==hash) throw new ConflictException('同一来源批次不能提交不同评审交期快照'); return {...receipt.response_json,repeated:true}; }
      const [current]=await m.query(`SELECT *,inbound_date::text AS date_text FROM mps_review_due_dates
        WHERE tenant_id=$1 AND source_order_number=$2 AND source_batch_number=$3 AND source_drawing_number=$4 FOR UPDATE`,[actor.tenantId,snapshot.orderNumber,snapshot.batchNumber,snapshot.drawingNumber]);
      if (current && (await m.query("SELECT 1 FROM audit_logs WHERE tenant_id=$1 AND record_id=$2 AND resource='mps-review-due-dates' AND action='review_due_date.manually_created' LIMIT 1",[actor.tenantId,current.id])).length) throw new ConflictException('手工新增记录尚未确认外部来源身份，请人工核实后再接入同步');
      if (!current && input.allowInitialCreate !== true) throw new ConflictException('来源身份无法可靠匹配，请人工核实；不会自动合并或新建记录');
      if (input.expectedVersion!==undefined && (!current || current.version!==input.expectedVersion)) throw new ConflictException('评审交期版本已变化，请刷新后重试');
      const [{observed_at:observedAt}]=await m.query('SELECT clock_timestamp()::text observed_at');
      const event=current?reviewDueDateChange(current.date_text,snapshot.inboundDate):null;
      let row;
      if (!current) [row]=await m.query(`INSERT INTO mps_review_due_dates(tenant_id,order_number,batch_number,drawing_number,inspection_time_name,inbound_date,quantity,last_synced_at,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6::date,$7::numeric,CASE WHEN $8='SYNC' THEN $10::timestamptz END,$9::uuid,$9::uuid) RETURNING *`,[actor.tenantId,snapshot.orderNumber,snapshot.batchNumber,snapshot.drawingNumber,snapshot.inspectionTimeName,snapshot.inboundDate,snapshot.quantity,input.sourceKind,actor.userId,observedAt]);
      else {
        if (event) await m.query(`INSERT INTO mps_review_due_date_changes(tenant_id,review_due_date_id,old_inbound_date,new_inbound_date,change_days,change_direction,changed_at,changed_by,source_kind,source_batch_id)
          VALUES($1,$2::uuid,$3::date,$4::date,$5,$6,$10::timestamptz,$7::uuid,$8,$9)`,[actor.tenantId,current.id,event.oldInboundDate,event.newInboundDate,event.changeDays,event.changeDirection,actor.userId,input.sourceKind,input.sourceBatchId,observedAt]);
        const updated=await m.query(`UPDATE mps_review_due_dates SET inspection_time_name=$3,inbound_date=$4::date,quantity=$5::numeric,
          change_count=change_count+$6,previous_inbound_date=CASE WHEN $6::int=1 THEN inbound_date ELSE previous_inbound_date END,
          last_changed_at=CASE WHEN $6::int=1 THEN $9::timestamptz ELSE last_changed_at END,last_synced_at=CASE WHEN $7='SYNC' THEN $9::timestamptz ELSE last_synced_at END,
          updated_at=$9::timestamptz,updated_by=$8::uuid,version=version+1 WHERE tenant_id=$1 AND id=$2::uuid RETURNING *`,[actor.tenantId,current.id,snapshot.inspectionTimeName,snapshot.inboundDate,snapshot.quantity,event?1:0,input.sourceKind,actor.userId,observedAt]);
        row=Array.isArray(updated[0])?updated[0][0]:updated[0];
      }
      await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1,$2::uuid,$3,'mps-review-due-dates',$4,$5,$6::jsonb,$7::jsonb,$8,$9,$2::uuid,$2::uuid)`,[actor.tenantId,actor.userId,actor.username,row.id,!current?'review_due_date.created':event?'review_due_date.date_changed':'review_due_date.observed',current?JSON.stringify(current):null,JSON.stringify({...row,sourceKind:input.sourceKind,sourceBatchId:input.sourceBatchId}),actor.requestId,actor.source==='system'?'api':actor.source]);
      const result={id:row.id,version:row.version,changeCount:row.change_count,dateChanged:!!event,created:!current,repeated:false};
      await m.query('INSERT INTO idempotency_keys(id,key,request_hash,response_json,created_by,updated_by) VALUES(uuidv7(),$1,$2,$3::jsonb,$4::uuid,$4::uuid)',[receiptKey,hash,JSON.stringify(result),actor.userId]);
      return result;
    };
    return manager?work(manager):this.db.transaction(work);
  }
}
