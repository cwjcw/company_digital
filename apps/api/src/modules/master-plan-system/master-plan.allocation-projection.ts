import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import { allocationDemandCtesSql, allocationOrderTotalsSql } from "./master-plan.allocation-source";
import { reconcileExistingMonthlyInbound } from "./master-plan.monthly-inbound";

/** Source validation is shared with inbound group reconciliation. No ERP admission join. */
export const allocationProjectionCandidatesSql = `WITH ${allocationDemandCtesSql} SELECT * FROM candidates`;
export const allocationProjectionParams = (tenantId: string) => [tenantId];

export async function reconcileAllocationPlans(manager: EntityManager, tenantId: string, actorId: string, actorName: string) {
  await manager.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
  await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${tenantId}:mps-allocation-projection`]);
  // Same lock as incoming-fact reconciliation: quantities and group totals cannot interleave.
  await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${tenantId}:mps-existing-monthly-inbound`]);
  await manager.query("SELECT id FROM mps_order_allocations WHERE tenant_id=$1 AND archived_at IS NULL ORDER BY id FOR SHARE", [tenantId]);
  await manager.query(`SELECT p.id FROM mps_monthly_plans p WHERE p.tenant_id=$1 AND EXISTS(
    SELECT 1 FROM mps_order_allocations a WHERE a.tenant_id=p.tenant_id AND a.order_number=p.order_number
      AND a.item_code=p.item_code AND a.archived_at IS NULL) ORDER BY p.id FOR UPDATE`, [tenantId]);
  const candidates: Array<Record<string, any>> = await manager.query(allocationProjectionCandidatesSql, allocationProjectionParams(tenantId));
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
  for (const row of eligible) {
    if (!row.existing_id) {
      const inserted = await manager.query(`INSERT INTO mps_monthly_plans(tenant_id,allocation_id,order_number,item_code,division_id,
        customer_code,order_date,customer_due_date,preproduction_review_date,latest_customer_due_date,item_name,
        required_quantity,pending_quantity,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5::uuid,$6,$7,$8,$9,$10,$11,$12,$12,$13::uuid,$13::uuid)
        ON CONFLICT(tenant_id,order_number,item_code,division_id) DO NOTHING RETURNING *`,
      [tenantId,row.allocation_id,row.order_number,row.item_code,row.division_id,row.customer_code,row.order_date,
        null,null,null,
        row.item_name,row.quantity,actorId]);
      if (inserted.length) { monthlyCreated++; await audit("mps-monthly-plans",null,inserted[0]); }
    } else {
      const [before] = await manager.query("SELECT * FROM mps_monthly_plans WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE", [tenantId,row.existing_id]);
      // Keep identity, manual business fields, dates and incoming facts. Only confirmed demand changes.
      const updated = await manager.query(`UPDATE mps_monthly_plans SET required_quantity=$3,
        pending_quantity=greatest($3::numeric-cumulative_inbound_quantity,0),
        completion_rate=CASE WHEN $3::numeric<=0 THEN 0 ELSE round(least(greatest(cumulative_inbound_quantity,0)/$3::numeric,1),4) END,
        updated_at=now(),updated_by=$4::uuid,version=version+1
        WHERE tenant_id=$1 AND id=$2::uuid AND version=$5 AND required_quantity IS DISTINCT FROM $3::numeric RETURNING *`,
      [tenantId,row.existing_id,row.quantity,actorId,before.version]);
      if (resultRows(updated).length) { monthlyUpdated++; await audit("mps-monthly-plans",before,resultRows(updated)[0]!); }
    }
  }
  const inbound = await reconcileExistingMonthlyInbound(manager,tenantId,actorName,actorId,true);
  const orderNumbers = [...new Set(eligible.map(row => row.order_number))];
  if (orderNumbers.length) {
    const groups: Array<Record<string, any>> = await manager.query(allocationOrderTotalsSql, [tenantId]);
    for (const row of groups) {
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
  await manager.query(`UPDATE mps_data_exceptions SET active=false,resolved_at=now(),updated_at=now(),updated_by=$2::uuid,version=version+1
    WHERE tenant_id=$1 AND active=true AND exception_type='ALLOCATION_PROJECTION_BLOCKED'
      AND exception_key LIKE 'allocation-projection:%' AND NOT(exception_key=ANY($3::text[]))`, [tenantId,actorId,blockedKeys]);
  await manager.query(`UPDATE mps_data_exceptions SET active=false,resolved_at=now(),updated_at=now(),updated_by=$2::uuid,version=version+1
    WHERE tenant_id=$1 AND exception_key='sync:plan-projections' AND active=true`, [tenantId,actorId]);
  const [sourceMetrics] = await manager.query(`SELECT count(*) FILTER(WHERE order_status IS DISTINCT FROM '已审核')::integer unapproved_allocations
    FROM mps_order_allocations WHERE tenant_id=$1 AND archived_at IS NULL`, [tenantId]);
  if (monthlyCreated + monthlyUpdated > 0) {
    await manager.query(`INSERT INTO mps_reconciliation_outbox(tenant_id,resource,sync_key,idempotency_key,actor_id,actor_name,created_by,updated_by)
      VALUES($1,'mps-monthly-plans','shipping-to-base',$2,$3::uuid,$4,$3::uuid,$3::uuid)
      ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`, [tenantId,`${requestId}:shipping-to-base`,actorId,actorName]);
  }
  const metrics: Record<string, number> = { allocations: 0,
    unapproved_allocations:Number(sourceMetrics.unapproved_allocations),
    missing_order_dates:candidates.reduce((n,row)=>n+Number(row.missing_order_dates),0),
    missing_item_names:candidates.reduce((n,row)=>n+Number(row.missing_item_names),0),monthly_created:monthlyCreated,monthly_updated:monthlyUpdated,
    monthly_plans:monthlyCreated+monthlyUpdated,group_created:groupCreated,group_updated:groupUpdated,
    group_plans:groupCreated+groupUpdated,skipped:candidates.length-eligible.length,eligible:eligible.length,
    monthly_inbound_recalculated:inbound.monthlyRows,group_inbound_recalculated:inbound.groupRows,
    monthly_inbound_source_unverified:inbound.unverifiedSourceItems };
  return { count:monthlyCreated+monthlyUpdated+groupCreated+groupUpdated+inbound.monthlyRows+inbound.groupRows,metrics };
}
