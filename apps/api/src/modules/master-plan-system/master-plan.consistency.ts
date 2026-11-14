import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import Decimal from 'decimal.js';
import { allocationDemandCtesSql,allocationOrderTotalsSql } from './master-plan.allocation-source';
import { MASTER_PLAN_RESOURCE_MAP,weeklyAdmissionSql } from './master-plan.config';

export type DemandKey={orderNumber:string;itemCode:string;divisionId:string};
export const demandKeyText=(key:DemandKey)=>JSON.stringify([key.orderNumber,key.itemCode,key.divisionId]);
const zero='00000000-0000-0000-0000-000000000000';

/** Bounded, indexed per-order reads; the same inspection verifies a committed task's actual outcome. */
export async function inspectDemandKey(m:EntityManager,tenant:string,key:DemandKey){
 const ctes=allocationDemandCtesSql.replace('WHERE a.tenant_id=$1 AND a.archived_at','WHERE a.tenant_id=$1 AND a.order_number=$2 AND a.archived_at');
 const candidates=await m.query(`WITH ${ctes} SELECT * FROM candidates WHERE item_code=$3 AND division_id=$4::uuid`,[tenant,key.orderNumber,key.itemCode,key.divisionId]);
 const candidate=candidates[0];
 const allocations=await m.query(`SELECT id,version,monthly_plan_id,allocated_quantity FROM mps_order_allocations WHERE tenant_id=$1
   AND order_number=$2 AND item_code=$3 AND division_id=$4::uuid AND archived_at IS NULL AND order_status='已审核' ORDER BY id`,[tenant,key.orderNumber,key.itemCode,key.divisionId]);
 const monthly=candidate?.existing_id?(await m.query('SELECT id,version,allocation_id,required_quantity,pending_quantity,cumulative_inbound_quantity FROM mps_monthly_plans WHERE tenant_id=$1 AND id=$2',[tenant,candidate.existing_id]))[0]:null;
 const bases=await m.query(`SELECT base.*,(${weeklyAdmissionSql(MASTER_PLAN_RESOURCE_MAP.get('mps-base-plans')!,'base')}) admitted
   FROM mps_base_plans base WHERE base.tenant_id=$1 AND ((base.order_number=$2 AND base.item_code=$3 AND base.division_id=$4::uuid)
   OR base.monthly_plan_id=$5::uuid) ORDER BY base.id`,[tenant,key.orderNumber,key.itemCode,key.divisionId,monthly?.id??null]);
 const weeks=bases.length?await m.query('SELECT id,base_plan_id,version,planned_quantity,pending_quantity,allocated_inbound_quantity FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=ANY($2::uuid[]) ORDER BY id',[tenant,bases.map((b:any)=>b.id)]):[];
 const groups=await m.query(allocationOrderTotalsSql.replace(allocationDemandCtesSql,ctes),[tenant,key.orderNumber]);
 const group=(await m.query('SELECT required_quantity,completed_quantity,pending_quantity,completion_rate FROM mps_group_plans WHERE tenant_id=$1 AND order_number=$2',[tenant,key.orderNumber]))[0];
 const expectedGroup=groups[0];
 const reasons:string[]=[];
 if(!candidate)reasons.push('没有可验证的有效分配来源');
 else if(candidate.skip_reason)reasons.push(String(candidate.skip_reason));
 if(!monthly)reasons.push('缺少月度需求');
 else{
   if(candidate?.recover_archived_source)reasons.push('归档来源待恢复');
   if(candidate&&!new Decimal(monthly.required_quantity).eq(candidate.quantity))reasons.push('月度需求数量不一致');
   if(allocations.some((a:any)=>a.monthly_plan_id!==monthly.id))reasons.push('有效分配的正式需求关联缺失或冲突');
   if(!bases.length)reasons.push('缺少基础计划');
   if(bases.some((b:any)=>b.monthly_plan_id!==monthly.id))reasons.push('基础计划正式需求关联缺失或冲突');
   if(bases.length&&!bases.reduce((sum:Decimal,b:any)=>sum.add(b.planned_quantity),new Decimal(0)).eq(monthly.required_quantity))reasons.push('基础计划需求差异');
   for(const b of bases){const w=weeks.find((w:any)=>w.base_plan_id===b.id);
     if(!w&&b.admitted)reasons.push('准入基础计划缺少周计划');
     if(w&&(!new Decimal(w.planned_quantity).eq(b.planned_quantity)||!new Decimal(w.pending_quantity).eq(Decimal.max(new Decimal(w.planned_quantity).sub(w.allocated_inbound_quantity),0))))reasons.push('周计划需求或剩余数量不一致');
   }
 }
 if(candidate&&!expectedGroup)reasons.push('集团汇总来源存在未完成范围');
 if(expectedGroup&&(!group||['required_quantity','completed_quantity','pending_quantity','completion_rate'].some(f=>!new Decimal(group[f]).eq(expectedGroup[f]))))reasons.push('集团汇总不一致');
 const fingerprint=createHash('sha256').update(JSON.stringify({allocations,monthly,bases:bases.map((b:any)=>[b.id,b.version,b.monthly_plan_id,b.planned_quantity]),weeks,group,reasons})).digest('hex');
 return {candidate,monthly,bases,weeks,allocations,reasons:[...new Set(reasons)],fingerprint};
}

/** Uses the existing minute checker. Incremental changes plus one resumable daily sweep, no extra scheduler. */
export async function scanDemandConsistencyPage(db:DataSource,tenant:string,systemId:string,limit=25){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('一致性扫描批次必须为1至100');
 return db.transaction(async m=>{
   await m.query("SELECT set_config('app.tenant_id',$1,true),set_config('lock_timeout','1000',true),set_config('statement_timeout','60000',true)",[tenant]);
   const [ready]=await m.query("SELECT to_regclass('mps_consistency_checkpoints') IS NOT NULL ready");
   if(!ready?.ready)return {ready:false,scanned:0,inconsistent:0,enqueued:0};
   const [lock]=await m.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) owned',[tenant+':mps-consistency-scan']);
   if(!lock?.owned)return {ready:true,scanned:0,inconsistent:0,enqueued:0,busy:true};
   await m.query("INSERT INTO mps_consistency_checkpoints(tenant_id,source_updated_at) VALUES($1,clock_timestamp()-interval '1 day') ON CONFLICT DO NOTHING",[tenant]);
   const [cp]=await m.query('SELECT *,source_updated_at::text source_cursor FROM mps_consistency_checkpoints WHERE tenant_id=$1 FOR UPDATE',[tenant]);
   const changed=await m.query(`SELECT id,updated_at::text updated_at,order_number,item_code,division_id FROM mps_order_allocations WHERE tenant_id=$1
     AND (updated_at,id)>($2::timestamptz,$3::uuid) ORDER BY updated_at,id LIMIT $4`,[tenant,cp.source_cursor,cp.source_id,limit]);
   const sweep=await m.query(`SELECT id,order_number,item_code,division_id FROM mps_order_allocations WHERE tenant_id=$1 AND archived_at IS NULL AND order_status='已审核'
     AND id>$2::uuid AND ($3::timestamptz IS NULL OR $3::timestamptz<clock_timestamp()-interval '24 hours') ORDER BY id LIMIT $4`,[tenant,cp.sweep_id,cp.last_sweep_at,limit]);
   const exhausted=await m.query(`SELECT o.scope_json->'allocationKey' key,o.id FROM mps_reconciliation_outbox o
     WHERE o.tenant_id=$1 AND o.resource='mps-demand-consistency' AND o.status='FAILED' AND o.attempts>=10
       AND o.superseded_by IS NULL AND isfinite(o.next_attempt_at) AND o.updated_at<clock_timestamp()-interval '6 hours'
       AND NOT EXISTS(SELECT 1 FROM mps_reconciliation_outbox newer WHERE newer.tenant_id=o.tenant_id
         AND newer.scope_json=o.scope_json AND (newer.created_at,newer.id)>(o.created_at,o.id)) ORDER BY o.updated_at,o.id LIMIT $2`,[tenant,limit]);
   const keys=new Map<string,DemandKey>();
   const retries=new Map<string,string>();
   for(const row of exhausted)if(row.key?.orderNumber&&row.key?.itemCode&&row.key?.divisionId){keys.set(demandKeyText(row.key),row.key);retries.set(demandKeyText(row.key),row.id);}
   for(const a of [...changed,...sweep])if(a.division_id&&a.order_number&&a.item_code){const key={orderNumber:a.order_number,itemCode:a.item_code,divisionId:String(a.division_id)};keys.set(demandKeyText(key),key);}
   let inconsistent=0,enqueued=0;
   for(const key of keys.values()){
     const state=await inspectDemandKey(m,tenant,key);if(!state.reasons.length)continue;inconsistent++;
     const scope={allocationKey:key};
     const [pending]=await m.query(`SELECT id FROM mps_reconciliation_outbox WHERE tenant_id=$1 AND sync_key='plan-projections'
       AND scope_json=$2::jsonb AND status IN ('PENDING','RUNNING') AND superseded_by IS NULL LIMIT 1`,[tenant,JSON.stringify(scope)]);
     if(pending)continue;
     const inserted=await m.query(`INSERT INTO mps_reconciliation_outbox(tenant_id,resource,record_id,sync_key,scope_json,idempotency_key,actor_id,actor_name,created_by,updated_by)
       VALUES($1,'mps-demand-consistency',$2::uuid,'plan-projections',$3::jsonb,$4,$5::uuid,'KDOS一致性任务',$5::uuid,$5::uuid)
       ON CONFLICT(tenant_id,idempotency_key) DO NOTHING RETURNING id`,[tenant,state.allocations[0]?.id??null,JSON.stringify(scope),'mps-consistency:v1:'+state.fingerprint+(retries.has(demandKeyText(key))?':compensate:'+retries.get(demandKeyText(key)):''),systemId]);
     if(inserted.length){enqueued++;await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,after_json,request_id,source,created_by,updated_by)
       VALUES($1,$2::uuid,'KDOS一致性任务','mps-demand-consistency',$3,'consistency.detected',$4::jsonb,$5,'api',$2::uuid,$2::uuid)`,[tenant,systemId,inserted[0].id,JSON.stringify({key,reasons:state.reasons}), 'mps-consistency:'+inserted[0].id]);}
   }
   const latest=changed.at(-1),last=sweep.at(-1);
   await m.query(`UPDATE mps_consistency_checkpoints SET source_updated_at=coalesce($2,source_updated_at),source_id=coalesce($3,source_id),
     sweep_id=CASE WHEN $4::int<$5::int AND (last_sweep_at IS NULL OR last_sweep_at<clock_timestamp()-interval '24 hours') THEN $6::uuid ELSE coalesce($7::uuid,sweep_id) END,
     last_sweep_at=CASE WHEN $4::int<$5::int AND (last_sweep_at IS NULL OR last_sweep_at<clock_timestamp()-interval '24 hours') THEN clock_timestamp() ELSE last_sweep_at END,
     metrics=jsonb_build_object('scanned',coalesce((metrics->>'scanned')::int,0)+$8::int,'inconsistent',coalesce((metrics->>'inconsistent')::int,0)+$9::int,
       'enqueued',coalesce((metrics->>'enqueued')::int,0)+$10::int),updated_at=clock_timestamp(),version=version+1 WHERE tenant_id=$1`,
     [tenant,latest?.updated_at??null,latest?.id??null,sweep.length,limit,zero,last?.id??null,keys.size,inconsistent,enqueued]);
   return {ready:true,scanned:keys.size,inconsistent,enqueued,incrementalRows:changed.length,sweepRows:sweep.length};
 });
}
