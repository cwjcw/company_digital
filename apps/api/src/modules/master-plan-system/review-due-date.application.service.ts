import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { reviewDueDateBusinessKey, reviewDueDateChange, reviewDueDateSnapshot, type ReviewDueDateSnapshot } from './review-due-date.domain';
import type { MasterPlanActor } from './master-plan.types';

type Input = ReviewDueDateSnapshot & { sourceKind: 'SYNC'|'IMPORT'|'MANUAL'; sourceBatchId: string; expectedVersion?: number };
/** Internal application boundary only: phase one exposes no write/import/sync HTTP command. */
@Injectable()
export class ReviewDueDateApplicationService {
  constructor(private readonly db: DataSource) {}
  async observe(input: Input, actor: MasterPlanActor, manager?: EntityManager) {
    if (!actor.userId || !actor.tenantId || !(actor.isSystemAdmin || actor.moduleAdminCodes?.includes('planning'))) throw new ForbiddenException('仅受控主计划应用命令可更新评审交期');
    if (!['SYNC','IMPORT','MANUAL'].includes(input.sourceKind) || typeof input.sourceBatchId !== 'string' || !input.sourceBatchId.trim() || input.sourceBatchId.length>128) throw new BadRequestException('来源及来源批次无效');
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
        WHERE tenant_id=$1 AND order_number=$2 AND batch_number=$3 AND drawing_number=$4 FOR UPDATE`,[actor.tenantId,snapshot.orderNumber,snapshot.batchNumber,snapshot.drawingNumber]);
      if (input.expectedVersion!==undefined && (!current || current.version!==input.expectedVersion)) throw new ConflictException('评审交期版本已变化，请刷新后重试');
      const [{observed_at:observedAt}]=await m.query('SELECT clock_timestamp()::text observed_at');
      const event=current?reviewDueDateChange(current.date_text,snapshot.inboundDate):null;
      let row;
      if (!current) [row]=await m.query(`INSERT INTO mps_review_due_dates(tenant_id,order_number,batch_number,drawing_number,inspection_time_name,inbound_date,quantity,last_synced_at,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6::date,$7::numeric,CASE WHEN $8='SYNC' THEN $10::timestamptz END,$9::uuid,$9::uuid) RETURNING *`,[actor.tenantId,snapshot.orderNumber,snapshot.batchNumber,snapshot.drawingNumber,snapshot.inspectionTimeName,snapshot.inboundDate,snapshot.quantity,input.sourceKind,actor.userId,observedAt]);
      else {
        if (event) await m.query(`INSERT INTO mps_review_due_date_changes(tenant_id,review_due_date_id,old_inbound_date,new_inbound_date,change_days,change_direction,changed_at,changed_by,source_kind,source_batch_id)
          VALUES($1,$2::uuid,$3::date,$4::date,$5,$6,$10::timestamptz,$7::uuid,$8,$9)`,[actor.tenantId,current.id,event.oldInboundDate,event.newInboundDate,event.changeDays,event.changeDirection,actor.userId,input.sourceKind,input.sourceBatchId,observedAt]);
        [row]=await m.query(`UPDATE mps_review_due_dates SET inspection_time_name=$3,inbound_date=$4::date,quantity=$5::numeric,
          change_count=change_count+$6,previous_inbound_date=CASE WHEN $6::int=1 THEN inbound_date ELSE previous_inbound_date END,
          last_changed_at=CASE WHEN $6::int=1 THEN $9::timestamptz ELSE last_changed_at END,last_synced_at=CASE WHEN $7='SYNC' THEN $9::timestamptz ELSE last_synced_at END,
          updated_at=$9::timestamptz,updated_by=$8::uuid,version=version+1 WHERE tenant_id=$1 AND id=$2::uuid RETURNING *`,[actor.tenantId,current.id,snapshot.inspectionTimeName,snapshot.inboundDate,snapshot.quantity,event?1:0,input.sourceKind,actor.userId,observedAt]);
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
