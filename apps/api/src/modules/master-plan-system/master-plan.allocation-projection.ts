import { assertMpsLifecycleSyncReady } from "./master-plan.lifecycle.service";
import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import { allocationDemandCtesSql, allocationOrderTotalsSql, allocationOrderTotalsSqlWithAliases } from "./master-plan.allocation-source";
import { reconcileExistingMonthlyInbound } from "./master-plan.monthly-inbound";
import { yieldAllocationProjectionToWaitingWriters } from "./master-plan.allocation-projection-lock";
import { linkExistingDemandRecord } from "./master-plan.demand-links";

/** Source validation is shared with inbound group reconciliation. No ERP admission join. */
export const allocationProjectionCandidatesSql = `WITH ${allocationDemandCtesSql} SELECT * FROM candidates`;
export const allocationProjectionParams = (tenantId: string) => [tenantId];
export type AllocationProjectionScope = {id:string;expectedVersion:number;orderNumber:string;itemCode:string;divisionId:string};

export async function reconcileAllocationPlans(manager: EntityManager, tenantId: string, actorId: string, actorName: string,
  groupPlanAliases: Array<{ sourceOrderNumber: string; targetOrderNumber: string }> = [], scope?:AllocationProjectionScope) {
  await manager.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
  await assertMpsLifecycleSyncReady(manager,tenantId,['mps-monthly-plans', 'mps-base-plans', 'mps-weekly-plans']);
  await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${tenantId}:mps-allocation-projection`]);
  // Same lock as incoming-fact reconciliation: quantities and group totals cannot interleave.
  await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${tenantId}:mps-existing-monthly-inbound`]);
  await yieldAllocationProjectionToWaitingWriters(manager, tenantId);
  await manager.query("SELECT id FROM mps_order_allocations WHERE tenant_id=$1 AND archived_at IS NULL ORDER BY id FOR SHARE", [tenantId]);
  await yieldAllocationProjectionToWaitingWriters(manager, tenantId);
  await manager.query(`SELECT p.id FROM mps_monthly_plans p WHERE p.tenant_id=$1 AND EXISTS(
    SELECT 1 FROM mps_order_allocations a WHERE a.tenant_id=p.tenant_id AND a.order_number=p.order_number
      AND a.item_code=p.item_code AND a.archived_at IS NULL) ORDER BY p.id FOR UPDATE`, [tenantId]);
  await yieldAllocationProjectionToWaitingWriters(manager, tenantId);
  const candidates: Array<Record<string, any>> = scope
    ? await manager.query(`WITH ${allocationDemandCtesSql} SELECT * FROM candidates WHERE allocation_id=$2::uuid
        AND order_number=$3 AND item_code=$4 AND division_id=$5::uuid`,[tenantId,scope.id,scope.orderNumber,scope.itemCode,scope.divisionId])
    : await manager.query(allocationProjectionCandidatesSql, allocationProjectionParams(tenantId));
  if(scope && (candidates.length!==1 || Number(candidates[0]!.allocation_count)!==1
    || String(candidates[0]!.allocation_id)!==scope.id || candidates[0]!.skip_reason))
    throw new Error("定向分配投影的业务键、来源数量或历史保护条件不满足，停止恢复");
  if(scope){
    const [current]=await manager.query(`SELECT id,version,order_number,item_code,division_id FROM mps_order_allocations
      WHERE tenant_id=$1 AND id=$2::uuid AND archived_at IS NULL AND order_status='已审核' FOR SHARE`,[tenantId,scope.id]);
    if(!current||Number(current.version)!==scope.expectedVersion||current.order_number!==scope.orderNumber||current.item_code!==scope.itemCode||String(current.division_id)!==scope.divisionId)
      throw new Error("定向分配记录版本或业务身份已变化，停止投影");
  }
  await yieldAllocationProjectionToWaitingWriters(manager, tenantId);
  const eligible = candidates.filter(row => row.skip_reason == null);
  const requestId = `allocation-projection:${randomUUID()}`;
  const audit = async (resource: string, before: Record<string, any> | null, after: Record<string, any>) => {
    await manager.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
      VALUES($1,$2::uuid,$3,$4,$5::uuid,$6,$7::jsonb,$8::jsonb,$9,'api',$2::uuid,$2::uuid)`,
    [tenantId, actorId, actorName, resource, after.id, before ? "allocation.plan_updated" : "allocation.plan_created",
      before ? JSON.stringify(before) : null, JSON.stringify(after), requestId]);
  };
  const resultRows = (result: any[]): Array<Record<string, any>> => Array.isArray(result[0]) ? result[0] : result;
  let monthlyCreated = 0, monthlyUpdated = 0, groupCreated = 0, groupUpdated = 0;
  const downstreamMonthlyIds=new Set<string>();
  for (const [index, row] of eligible.entries()) {
    if (index % 16 === 0) await yieldAllocationProjectionToWaitingWriters(manager, tenantId);
    if (!row.existing_id) {
      const inserted = await manager.query(`INSERT INTO mps_monthly_plans(tenant_id,allocation_id,order_number,item_code,division_id,
        customer_code,order_date,customer_due_date,preproduction_review_date,latest_customer_due_date,item_name,
        required_quantity,pending_quantity,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$12,$13::uuid,$13::uuid)
        ON CONFLICT(tenant_id,order_number,item_code,division_id) DO NOTHING RETURNING *`,
      [tenantId,row.allocation_id,row.order_number,row.item_code,row.division_id,row.customer_code,row.order_date,
        null,null,null,
        row.item_name,row.quantity,actorId]);
      if (inserted.length) { monthlyCreated++; downstreamMonthlyIds.add(String(inserted[0].id)); await audit("mps-monthly-plans",null,inserted[0]); }
    } else {
      const [before] = await manager.query("SELECT * FROM mps_monthly_plans WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE", [tenantId,row.existing_id]);
      // Keep identity, manual business fields, dates and incoming facts. Only confirmed demand changes.
      const updated = await manager.query(`UPDATE mps_monthly_plans SET allocation_id=CASE WHEN $6::boolean THEN $7::uuid ELSE allocation_id END,
        required_quantity=$3,
        pending_quantity=greatest($3::numeric-cumulative_inbound_quantity,0),
        completion_rate=CASE WHEN $3::numeric<=0 THEN 0 ELSE round(least(greatest(cumulative_inbound_quantity,0)/$3::numeric,1),4) END,
        updated_at=now(),updated_by=$4::uuid,version=version+1
        WHERE tenant_id=$1 AND id=$2::uuid AND version=$5 AND
          (required_quantity IS DISTINCT FROM $3::numeric OR ($6::boolean AND allocation_id IS DISTINCT FROM $7::uuid)) RETURNING *`,
      [tenantId,row.existing_id,row.quantity,actorId,before.version,Boolean(scope&&row.recover_archived_source),row.allocation_id]);
      if (resultRows(updated).length) {
        monthlyUpdated++; const after=resultRows(updated)[0]!; downstreamMonthlyIds.add(String(after.id));
        await audit("mps-monthly-plans",before,after);
        if(scope && row.recover_archived_source){
          await manager.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
            VALUES($1,$2::uuid,$3,'mps-monthly-plans',$4,'allocation.source_recovered',$5::jsonb,$6::jsonb,$7,'api',$2::uuid,$2::uuid)`,
            [tenantId,actorId,actorName,after.id,JSON.stringify({...before,allocation_id:row.existing_allocation_id}),JSON.stringify(after),requestId]);
          const [source]=await manager.query("SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE",[tenantId,row.allocation_id]);
          await linkExistingDemandRecord(manager,'mps-order-allocations',source,String(after.id),actorId,actorName,requestId);
        }
      }
    }
  }
  await yieldAllocationProjectionToWaitingWriters(manager, tenantId);
  const inbound = scope ? {monthlyRows:0,groupRows:0,unverifiedSourceItems:0} : await reconcileExistingMonthlyInbound(manager,tenantId,actorName,actorId,true);
  await yieldAllocationProjectionToWaitingWriters(manager, tenantId);
  const orderNumbers = [...new Set(eligible.map(row => row.order_number))];
  if (orderNumbers.length) {
    const groups: Array<Record<string, any>> = await manager.query(
      groupPlanAliases.length ? allocationOrderTotalsSqlWithAliases() : allocationOrderTotalsSql,
      groupPlanAliases.length ? [tenantId,JSON.stringify(groupPlanAliases)] : [tenantId]);
    for (const [index, row] of groups.filter(row=>orderNumbers.includes(String(row.order_number))).entries()) {
      if (index % 16 === 0) await yieldAllocationProjectionToWaitingWriters(manager, tenantId);
      const [before] = await manager.query("SELECT * FROM mps_group_plans WHERE tenant_id=$1 AND order_number=$2 FOR UPDATE", [tenantId,row.order_number]);
      if (!before) {
        const inserted = await manager.query(`INSERT INTO mps_group_plans(tenant_id,order_number,source_accounts,order_type,customer_code,
          order_date,customer_due_date,preproduction_review_date,order_amount,required_quantity,primary_division_id,
          completed_quantity,pending_quantity,completion_rate,created_by,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$12,$13,$14,$15::uuid,$15::uuid)
          ON CONFLICT(tenant_id,order_number) DO NOTHING RETURNING *`,
        [tenantId,row.order_number,null,null,row.customer_code,row.order_date,null,
          null,null,row.required_quantity,row.primary_division_id,row.completed_quantity,
          row.pending_quantity,row.completion_rate,actorId]);
        if (inserted.length) { groupCreated++; await audit("mps-group-plans",null,inserted[0]); }
      } else {
        const changed = await manager.query(`UPDATE mps_group_plans SET required_quantity=$3,completed_quantity=$4,
          pending_quantity=$5,completion_rate=$6,updated_at=now(),updated_by=$7::uuid,version=version+1
          WHERE tenant_id=$1 AND id=$2::uuid AND version=$8 AND
            (required_quantity,completed_quantity,pending_quantity,completion_rate) IS DISTINCT FROM ($3::numeric,$4::numeric,$5::numeric,$6::numeric) RETURNING *`,
        [tenantId,before.id,row.required_quantity,row.completed_quantity,row.pending_quantity,row.completion_rate,actorId,before.version]);
        if (resultRows(changed).length) { groupUpdated++; await audit("mps-group-plans",before,resultRows(changed)[0]!); }
      }
    }
  }
  // Per-key exceptions remain visible until the source ambiguity is resolved, without changing it.
  for (const row of candidates) {
    const key = `allocation-projection:${JSON.stringify([row.order_number,row.item_code,row.division_id])}`;
    if (row.skip_reason) {
      await manager.query(`INSERT INTO mps_data_exceptions(tenant_id,exception_key,resource,record_id,business_key,exception_type,severity,message,active,created_by,updated_by)
        VALUES($1,$2,'mps-order-allocations',$3::uuid,$4,'ALLOCATION_PROJECTION_BLOCKED','WARNING',$5,true,$6::uuid,$6::uuid)
        ON CONFLICT(tenant_id,exception_key) DO UPDATE SET message=excluded.message,active=true,resolved_at=NULL,
          updated_at=now(),updated_by=$6::uuid,version=mps_data_exceptions.version+1
        WHERE mps_data_exceptions.message IS DISTINCT FROM excluded.message OR NOT mps_data_exceptions.active`,
      [tenantId,key,row.allocation_id,`${row.order_number}/${row.item_code}`,row.skip_reason,actorId]);
    }
  }
  // Resolve obsolete ERP-gate diagnostics and keys whose source was archived or
  // became valid. This changes diagnostics only, never retained business plans.
  const blockedKeys = candidates.filter(row => row.skip_reason).map(row =>
    `allocation-projection:${JSON.stringify([row.order_number,row.item_code,row.division_id])}`);
  const candidateKeys=candidates.map(row=>`allocation-projection:${JSON.stringify([row.order_number,row.item_code,row.division_id])}`);
  await manager.query(`UPDATE mps_data_exceptions SET active=false,resolved_at=now(),updated_at=now(),updated_by=$2::uuid,version=version+1
    WHERE tenant_id=$1 AND active=true AND exception_type='ALLOCATION_PROJECTION_BLOCKED'
      AND exception_key LIKE 'allocation-projection:%' AND ($4::text[] IS NULL OR exception_key=ANY($4::text[])) AND NOT(exception_key=ANY($3::text[]))`, [tenantId,actorId,blockedKeys,scope?candidateKeys:null]);
  if(!scope) await manager.query(`UPDATE mps_data_exceptions SET active=false,resolved_at=now(),updated_at=now(),updated_by=$2::uuid,version=version+1
    WHERE tenant_id=$1 AND exception_key='sync:plan-projections' AND active=true`, [tenantId,actorId]);
  const [sourceMetrics] = await manager.query(`SELECT count(*) FILTER(WHERE order_status IS DISTINCT FROM '已审核')::integer unapproved_allocations
    FROM mps_order_allocations WHERE tenant_id=$1 AND archived_at IS NULL`, [tenantId]);
  if (monthlyCreated + monthlyUpdated > 0) {
    const linked=scope&&downstreamMonthlyIds.size?await manager.query(`SELECT id,version FROM mps_monthly_plans WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`,[tenantId,[...downstreamMonthlyIds]]):[];
    const scopeJson=scope&&linked.length?{monthlyPlans:linked.map((row:any)=>({id:String(row.id),expectedVersion:Number(row.version)}))}:null;
    await manager.query(`INSERT INTO mps_reconciliation_outbox(tenant_id,resource,record_id,sync_key,scope_json,idempotency_key,actor_id,actor_name,created_by,updated_by)
      VALUES($1,'mps-monthly-plans',$2::uuid,'shipping-to-base',$3::jsonb,$4,$5::uuid,$6,$5::uuid,$5::uuid)
      ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`, [tenantId,scopeJson?.monthlyPlans[0]?.id??null,scopeJson?JSON.stringify(scopeJson):null,
      `${requestId}:shipping-to-base`,actorId,actorName]);
  }
  const metrics: Record<string, number> = { allocations: 0,
    unapproved_allocations:Number(sourceMetrics.unapproved_allocations),
    missing_order_dates:candidates.reduce((n,row)=>n+Number(row.missing_order_dates),0),
    missing_item_names:candidates.reduce((n,row)=>n+Number(row.missing_item_names),0),monthly_created:monthlyCreated,monthly_updated:monthlyUpdated,
    monthly_plans:monthlyCreated+monthlyUpdated,group_created:groupCreated,group_updated:groupUpdated,
    group_plans:groupCreated+groupUpdated,skipped:candidates.length-eligible.length,eligible:eligible.length,
    monthly_inbound_recalculated:inbound.monthlyRows,group_inbound_recalculated:inbound.groupRows,
    monthly_inbound_source_unverified:inbound.unverifiedSourceItems };
  return { count:monthlyCreated+monthlyUpdated+groupCreated+groupUpdated+inbound.monthlyRows+inbound.groupRows,
    status:scope&&metrics.skipped>0?"BLOCKED" as const:undefined,metrics };
}

/** New source command only: establish this demand locally. Group/inbound/downstream
 * projections retain the existing transactional outbox boundary and failure semantics. */
export async function ensureNewAllocationDemand(manager: EntityManager, row: Record<string,any>, actorId: string, actorName: string, requestId: string) {
  if(row.order_status!=='已审核' || row.archived_at) return;
  const tenant=row.tenant_id;
  await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${tenant}:mps-allocation-projection`]);
  const scopedCandidates=allocationProjectionCandidatesSql.replace('WHERE a.tenant_id=$1 AND a.archived_at','WHERE a.tenant_id=$1 AND a.order_number=$2 AND a.archived_at');
  const [candidate]=await manager.query(`${scopedCandidates} WHERE order_number=$2 AND item_code=$3 AND division_id IS NOT DISTINCT FROM $4::uuid`,[tenant,row.order_number,row.item_code,row.division_id]);
  if(!candidate || candidate.skip_reason) return;
  let before:Record<string,any>|null=null,after:Record<string,any>|undefined;
  if(candidate.existing_id) {
    [before]=await manager.query('SELECT * FROM mps_monthly_plans WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE',[tenant,candidate.existing_id]);
    if(!before || (before.lifecycle_status && before.lifecycle_status!=='ACTIVE')) return;
    if(String(before.required_quantity)===String(candidate.quantity)) return;
    const updated=await manager.query(`UPDATE mps_monthly_plans SET required_quantity=$3::numeric,
      pending_quantity=greatest($3::numeric-cumulative_inbound_quantity,0),
      completion_rate=CASE WHEN $3::numeric<=0 THEN 0 ELSE round(least(greatest(cumulative_inbound_quantity,0)/$3::numeric,1),4) END,
      updated_at=now(),updated_by=$4::uuid,version=version+1
      WHERE tenant_id=$1 AND id=$2::uuid AND version=$5 AND required_quantity IS DISTINCT FROM $3::numeric RETURNING *`,[tenant,before.id,candidate.quantity,actorId,before.version]);
    after=Array.isArray(updated[0])?updated[0][0]:updated[0];
  } else {
    [after]=await manager.query(`INSERT INTO mps_monthly_plans(tenant_id,allocation_id,order_number,item_code,division_id,customer_code,order_date,item_name,required_quantity,pending_quantity,created_by,updated_by)
      VALUES($1,$2::uuid,$3,$4,$5::uuid,$6,$7,$8,$9,$9,$10::uuid,$10::uuid) RETURNING *`,[tenant,candidate.allocation_id,candidate.order_number,candidate.item_code,candidate.division_id,candidate.customer_code,candidate.order_date,candidate.item_name,candidate.quantity,actorId]);
  }
  if(after) await manager.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
    VALUES($1,$2::uuid,$3,'mps-monthly-plans',$4,$5,$6::jsonb,$7::jsonb,$8,'api',$2::uuid,$2::uuid)`,[tenant,actorId,actorName,after.id,before?'allocation.plan_updated':'allocation.plan_created',before?JSON.stringify(before):null,JSON.stringify(after),requestId]);
}
