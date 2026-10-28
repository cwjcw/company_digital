import { randomUUID } from "node:crypto";
import type { EntityManager } from "typeorm";
import { MASTER_PLAN_ERP_ADMISSION } from "./master-plan.erp-admission";

// Existing shared-directory identity. Do not infer department ownership from its display name.
export const MONTHLY_INBOUND_DIVISION_ID = "d23442f9-4862-4641-b4a7-c8d470bc56ea";

/** Only existing plans with a unique, tenant-owned Kejia order line and verified stock facts.
 * Archived allocation parents are deliberately irrelevant: this command updates facts, not plan identity.
 * Missing/ambiguous source records are skipped rather than interpreted as zero receipts.
 */
const monthlyInboundFactsSql = `WITH eligible_plans AS MATERIALIZED (
  SELECT p.id,p.order_number,p.item_code FROM mps_monthly_plans p
  JOIN organization_units o ON o.id=p.division_id AND o.enabled=true
  WHERE p.tenant_id=$1 AND p.division_id=$2::uuid
    AND (SELECT count(*) FROM erp_staging_raw_records r WHERE r.tenant_id=p.tenant_id
      AND r.source_database=$3 AND r.source_system='T+' AND r.record_type='ORDER_LINE'
      AND r.source_active=true AND r.is_cancelled=false AND r.order_number=p.order_number
      AND r.item_code=p.item_code AND r.customer_code IS NOT DISTINCT FROM p.customer_code)=1
), stock_facts AS MATERIALIZED (
  SELECT p.id,
    bool_and(COALESCE(r.id IS NOT NULL AND r.status_code='189'
      AND r.order_link_stable=true AND r.order_number=f.sales_order_number AND r.item_code=f.inventory_code,false)) trusted,
    sum(CASE WHEN r.source_active=true AND r.is_cancelled=false AND r.status_code='189'
      THEN COALESCE(f.received_quantity,0) ELSE 0 END) quantity
  FROM eligible_plans p JOIN finished_goods_inbound f
    ON f.sales_order_number=p.order_number AND f.inventory_code=p.item_code
    AND f.source_database=$3 AND f.source_system='T+'
  LEFT JOIN erp_staging_raw_records r ON r.tenant_id=$1 AND r.source_database=f.source_database
    AND r.source_system=f.source_system AND r.source_id=f.source_key AND r.source_table='ST_RDRecord_b'
    AND r.record_type='INBOUND_LINE'
  GROUP BY p.id
)`;

export const monthlyInboundCandidatesSql = `${monthlyInboundFactsSql}
SELECT p.id,p.order_number,p.item_code,p.version,
  p.cumulative_inbound_quantity::text before_inbound,p.pending_quantity::text before_pending,p.completion_rate::text before_rate,
  f.quantity::text after_inbound,greatest(p.required_quantity-f.quantity,0)::text after_pending,
  (CASE WHEN p.required_quantity<=0 THEN 0 ELSE round(least(greatest(f.quantity,0)/p.required_quantity,1),4) END)::text after_rate
FROM mps_monthly_plans p JOIN stock_facts f ON f.id=p.id AND f.trusted
WHERE p.tenant_id=$1 AND p.division_id=$2::uuid AND p.required_quantity>=0
  AND (p.cumulative_inbound_quantity,p.pending_quantity,p.completion_rate) IS DISTINCT FROM
    (f.quantity,greatest(p.required_quantity-f.quantity,0),
      CASE WHEN p.required_quantity<=0 THEN 0 ELSE round(least(greatest(f.quantity,0)/p.required_quantity,1),4) END)`;

export const monthlyInboundParams = (tenantId: string) => [tenantId, MONTHLY_INBOUND_DIVISION_ID, MASTER_PLAN_ERP_ADMISSION.sourceDatabase];

export async function reconcileExistingMonthlyInbound(manager: EntityManager, tenantId: string, updatedBy: string, actorId: string) {
  await manager.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
  await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${tenantId}:mps-existing-monthly-inbound`]);
  const before: Array<Record<string, any>> = await manager.query(`${monthlyInboundCandidatesSql} FOR UPDATE OF p`, monthlyInboundParams(tenantId));
  const [blocked] = await manager.query(`${monthlyInboundFactsSql} SELECT count(*)::integer count FROM stock_facts WHERE NOT trusted`, monthlyInboundParams(tenantId));
  const requestId = `monthly-inbound:${randomUUID()}`;
  const audit = async (resource: string, rows: Array<Record<string, any>>) => {
    if (!rows.length) return;
    await manager.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
      SELECT $1,$2::uuid,$3,$4,x.id,'inbound.reconciled',x.before_json,x.after_json,$6,'api',$2::uuid,$2::uuid
      FROM jsonb_to_recordset($5::jsonb) x(id uuid,before_json jsonb,after_json jsonb)`,
    [tenantId, actorId, updatedBy, resource, JSON.stringify(rows), requestId]);
  };
  if (before.length) {
    const changed = await manager.query(`UPDATE mps_monthly_plans p SET cumulative_inbound_quantity=x.after_inbound,
      pending_quantity=x.after_pending,completion_rate=x.after_rate,updated_at=now(),updated_by=$3,version=p.version+1
      FROM jsonb_to_recordset($2::jsonb) x(id uuid,version integer,after_inbound numeric,after_pending numeric,after_rate numeric)
      WHERE p.tenant_id=$1 AND p.id=x.id AND p.version=x.version RETURNING p.id`, [tenantId, JSON.stringify(before), updatedBy]);
    const changedRows = Array.isArray(changed[0]) ? changed[0] : changed;
    if (changedRows.length !== before.length) throw new Error("月计划入库回算发生并发变化，事务已回滚，稍后重试");
    await audit("mps-monthly-plans", before.map(r => ({ id: r.id,
      before_json: { cumulativeInboundQuantity: r.before_inbound, pendingQuantity: r.before_pending, completionRate: r.before_rate, version: Number(r.version) },
      after_json: { cumulativeInboundQuantity: r.after_inbound, pendingQuantity: r.after_pending, completionRate: r.after_rate, version: Number(r.version) + 1 }
    })));
  }
  // Repair retained group summaries as well, including a later run after an interrupted old deployment.
  const groups: Array<Record<string, any>> = await manager.query(`WITH totals AS (
    SELECT p.order_number,sum(p.required_quantity) required,sum(least(p.cumulative_inbound_quantity,p.required_quantity)) completed,
      sum(greatest(p.required_quantity-p.cumulative_inbound_quantity,0)) pending,
      avg(CASE WHEN p.required_quantity<=0 THEN 0 ELSE least(greatest(p.cumulative_inbound_quantity,0)/p.required_quantity,1) END) rate
    FROM mps_monthly_plans p WHERE p.tenant_id=$1 GROUP BY p.order_number
  ) SELECT g.id,g.version,g.required_quantity::text before_required,g.completed_quantity::text before_completed,
    g.pending_quantity::text before_pending,g.completion_rate::text before_rate,
    t.required::text after_required,t.completed::text after_completed,t.pending::text after_pending,round(t.rate,4)::text after_rate
    FROM mps_group_plans g JOIN totals t ON t.order_number=g.order_number
    WHERE g.tenant_id=$1 AND g.primary_division_id=$2::uuid
      AND EXISTS(SELECT 1 FROM mps_monthly_plans p WHERE p.tenant_id=g.tenant_id AND p.order_number=g.order_number AND p.division_id=$2::uuid)
      AND (g.required_quantity,g.completed_quantity,g.pending_quantity,g.completion_rate)
        IS DISTINCT FROM (t.required,t.completed,t.pending,round(t.rate,4)) FOR UPDATE OF g`, [tenantId, MONTHLY_INBOUND_DIVISION_ID]);
  if (groups.length) {
    await manager.query(`UPDATE mps_group_plans g SET required_quantity=x.after_required,completed_quantity=x.after_completed,
      pending_quantity=x.after_pending,completion_rate=x.after_rate,updated_at=now(),updated_by=$3,version=g.version+1
      FROM jsonb_to_recordset($2::jsonb) x(id uuid,after_required numeric,after_completed numeric,after_pending numeric,after_rate numeric)
      WHERE g.tenant_id=$1 AND g.id=x.id`, [tenantId, JSON.stringify(groups), updatedBy]);
    await audit("mps-group-plans", groups.map(r => ({ id: r.id,
      before_json: { requiredQuantity: r.before_required, completedQuantity: r.before_completed, pendingQuantity: r.before_pending, completionRate: r.before_rate, version: Number(r.version) },
      after_json: { requiredQuantity: r.after_required, completedQuantity: r.after_completed, pendingQuantity: r.after_pending, completionRate: r.after_rate, version: Number(r.version) + 1 }
    })));
  }
  return { monthlyRows: before.length, groupRows: groups.length, unverifiedSourceItems: Number(blocked.count) };
}
