import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import { MASTER_PLAN_ERP_ADMISSION } from "./master-plan.erp-admission";
import { reconcileExistingMonthlyInbound } from "./master-plan.monthly-inbound";

/** Confirmed manual/import allocations only. Aggregate physical allocation rows without
 * multiplying demand through ERP joins. Conflicting ownership/source/quantity is diagnostic,
 * never resolved by choosing an arbitrary row or changing the allocation itself. */
export const allocationProjectionCandidatesSql = `WITH allocations AS (
  SELECT a.tenant_id,a.order_number,a.item_code,
    (array_agg(a.id ORDER BY a.created_at,a.id))[1] allocation_id,
    (array_agg(a.division_id ORDER BY a.created_at,a.id))[1] division_id,
    min(a.customer_code) customer_code,min(a.order_date) order_date,
    max(a.expected_shipping_date) expected_shipping_date,max(a.item_name) item_name,
    sum(a.allocated_quantity) quantity,count(*) allocation_count,
    count(DISTINCT a.division_id) division_count,count(DISTINCT a.customer_code) customer_count,
    bool_and(a.manually_maintained AND a.division_id IS NOT NULL
      AND NULLIF(btrim(a.customer_code),'') IS NOT NULL AND a.allocated_quantity>=0) valid
  FROM mps_order_allocations a WHERE a.tenant_id=$1 AND a.archived_at IS NULL
  GROUP BY a.tenant_id,a.order_number,a.item_code
), sources AS (
  SELECT e.order_number,e.item_code,count(*) source_count,
    min(e.customer_code) customer_code,max(e.order_quantity) order_quantity,
    min(e.order_date) order_date,max(e.customer_due_date) customer_due_date,
    max(e.preproduction_review_date) preproduction_review_date,max(e.item_name) item_name
  FROM mps_erp_order_lines e WHERE e.tenant_id=$1 AND e.source_database=$2 AND e.source_active=true
  GROUP BY e.order_number,e.item_code
)
SELECT a.*,e.customer_due_date,e.preproduction_review_date,
  coalesce(a.order_date,e.order_date) plan_order_date,coalesce(a.item_name,e.item_name) plan_item_name,
  p.id existing_id,p.allocation_id existing_allocation_id,
  CASE WHEN NOT a.valid OR a.division_count<>1 OR a.customer_count<>1 THEN '分配事业部、客户或数量冲突'
    WHEN o.id IS NULL THEN '承接事业部无效'
    WHEN e.source_count IS NULL THEN '未匹配有效科加ERP明细'
    WHEN e.source_count<>1 OR e.customer_code IS DISTINCT FROM a.customer_code THEN 'ERP来源或客户不唯一'
    WHEN a.quantity>e.order_quantity THEN '重复分配合计超过ERP订单数量'
    WHEN NOT EXISTS(SELECT 1 FROM mps_customer_division_mappings m JOIN organization_units org
      ON org.id=m.primary_division_id AND org.enabled=true
      WHERE m.tenant_id=a.tenant_id AND m.customer_code=a.customer_code AND m.enabled=true)
      THEN '客户主责事业部未配置'
    WHEN p.id IS NOT NULL AND (parent.archived_at IS NOT NULL OR parent.id IS NULL
      OR p.division_id IS DISTINCT FROM a.division_id OR p.customer_code IS DISTINCT FROM a.customer_code)
      THEN '保留历史计划或人工归属'
    ELSE NULL END skip_reason
FROM allocations a LEFT JOIN sources e ON e.order_number=a.order_number AND e.item_code=a.item_code
LEFT JOIN organization_units o ON o.id=a.division_id AND o.enabled=true
LEFT JOIN mps_monthly_plans p ON p.tenant_id=a.tenant_id AND p.order_number=a.order_number AND p.item_code=a.item_code
LEFT JOIN mps_order_allocations parent ON parent.tenant_id=p.tenant_id AND parent.id=p.allocation_id`;

export const allocationProjectionParams = (tenantId: string) => [tenantId, MASTER_PLAN_ERP_ADMISSION.sourceDatabase];

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
        ON CONFLICT(tenant_id,order_number,item_code) DO NOTHING RETURNING *`,
      [tenantId,row.allocation_id,row.order_number,row.item_code,row.division_id,row.customer_code,row.plan_order_date,
        row.customer_due_date,row.preproduction_review_date,row.expected_shipping_date ?? row.customer_due_date,
        row.plan_item_name,row.quantity,actorId]);
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
  const inbound = await reconcileExistingMonthlyInbound(manager,tenantId,actorName,actorId);
  const orderNumbers = [...new Set(eligible.map(row => row.order_number))];
  if (orderNumbers.length) {
    const groups: Array<Record<string, any>> = await manager.query(`WITH source_orders AS (
      SELECT e.order_number,string_agg(DISTINCT coalesce(e.source_account_name,e.source_database),',') source_accounts,
        max(e.order_type) order_type,min(e.customer_code) customer_code,min(e.order_date) order_date,
        max(e.customer_due_date) customer_due_date,max(e.preproduction_review_date) preproduction_review_date,
        sum(coalesce(e.tax_included_amount,0)) order_amount
      FROM mps_erp_order_lines e WHERE e.tenant_id=$1 AND e.source_database=$2 AND e.source_active=true AND e.order_number=ANY($3::text[])
      GROUP BY e.order_number HAVING count(DISTINCT e.customer_code)=1 AND bool_and(nullif(btrim(e.customer_code),'') IS NOT NULL)
    ), totals AS (
      SELECT p.order_number,sum(p.required_quantity) required_quantity,
        sum(least(p.cumulative_inbound_quantity,p.required_quantity)) completed_quantity,
        sum(greatest(p.required_quantity-p.cumulative_inbound_quantity,0)) pending_quantity,
        round(avg(CASE WHEN p.required_quantity<=0 THEN 0 ELSE least(greatest(p.cumulative_inbound_quantity,0)/p.required_quantity,1) END),4) completion_rate
      FROM mps_monthly_plans p WHERE p.tenant_id=$1 AND p.order_number=ANY($3::text[]) GROUP BY p.order_number
    ) SELECT s.*,t.required_quantity,t.completed_quantity,t.pending_quantity,t.completion_rate,map.primary_division_id
    FROM source_orders s JOIN totals t USING(order_number) JOIN mps_customer_division_mappings map
      ON map.tenant_id=$1 AND map.customer_code=s.customer_code AND map.enabled=true
    JOIN organization_units o ON o.id=map.primary_division_id AND o.enabled=true`,
    [tenantId,MASTER_PLAN_ERP_ADMISSION.sourceDatabase,orderNumbers]);
    for (const row of groups) {
      const [before] = await manager.query("SELECT * FROM mps_group_plans WHERE tenant_id=$1 AND order_number=$2 FOR UPDATE", [tenantId,row.order_number]);
      if (!before) {
        const inserted = await manager.query(`INSERT INTO mps_group_plans(tenant_id,order_number,source_accounts,order_type,customer_code,
          order_date,customer_due_date,preproduction_review_date,order_amount,required_quantity,primary_division_id,
          completed_quantity,pending_quantity,completion_rate,created_by,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$12,$13,$14,$15::uuid,$15::uuid)
          ON CONFLICT(tenant_id,order_number) DO NOTHING RETURNING *`,
        [tenantId,row.order_number,row.source_accounts,row.order_type,row.customer_code,row.order_date,row.customer_due_date,
          row.preproduction_review_date,row.order_amount,row.required_quantity,row.primary_division_id,row.completed_quantity,
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
    if (row.skip_reason === "未匹配有效科加ERP明细") continue;
    const key = `allocation-projection:${JSON.stringify([row.order_number,row.item_code])}`;
    if (row.skip_reason) {
      await manager.query(`INSERT INTO mps_data_exceptions(tenant_id,exception_key,resource,record_id,business_key,exception_type,severity,message,active,created_by,updated_by)
        VALUES($1,$2,'mps-order-allocations',$3::uuid,$4,'ALLOCATION_PROJECTION_BLOCKED','WARNING',$5,true,$6::uuid,$6::uuid)
        ON CONFLICT(tenant_id,exception_key) DO UPDATE SET message=excluded.message,active=true,resolved_at=NULL,
          updated_at=now(),updated_by=$6::uuid,version=mps_data_exceptions.version+1
        WHERE mps_data_exceptions.message IS DISTINCT FROM excluded.message OR NOT mps_data_exceptions.active`,
      [tenantId,key,row.allocation_id,`${row.order_number}/${row.item_code}`,row.skip_reason,actorId]);
    } else {
      await manager.query(`UPDATE mps_data_exceptions SET active=false,resolved_at=now(),updated_at=now(),updated_by=$3::uuid,version=version+1
        WHERE tenant_id=$1 AND exception_key=$2 AND active=true`, [tenantId,key,actorId]);
    }
  }
  const metrics: Record<string, number> = { allocations: 0,monthly_created:monthlyCreated,monthly_updated:monthlyUpdated,
    monthly_plans:monthlyCreated+monthlyUpdated,group_created:groupCreated,group_updated:groupUpdated,
    group_plans:groupCreated+groupUpdated,skipped:candidates.length-eligible.length,eligible:eligible.length,
    monthly_inbound_recalculated:inbound.monthlyRows,group_inbound_recalculated:inbound.groupRows,
    monthly_inbound_source_unverified:inbound.unverifiedSourceItems };
  return { count:monthlyCreated+monthlyUpdated+groupCreated+groupUpdated+inbound.monthlyRows+inbound.groupRows,metrics };
}
