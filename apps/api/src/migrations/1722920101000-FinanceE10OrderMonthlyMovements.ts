import type { MigrationInterface, QueryRunner } from 'typeorm';

/** A read-only order/month projection of the posted occurrence legs; never reposts source events. */
export class FinanceE10OrderMonthlyMovements1722920101000 implements MigrationInterface {
  name = 'FinanceE10OrderMonthlyMovements1722920101000';
  async up(r: QueryRunner) {
    await r.query(`CREATE VIEW finance_e10_order_monthly_movements WITH(security_invoker=true) AS
 WITH metadata AS (
  SELECT tenant_id,source_database,source_order_id,
   CASE WHEN min(payload->>'businessRemark') IS NOT DISTINCT FROM max(payload->>'businessRemark') THEN min(payload->>'businessRemark') END business_remark,
   min(NULLIF(payload->>'deliveryDate','')::date) FILTER(WHERE (payload->>'closeCode') IS DISTINCT FROM '1' AND (payload->>'hasSpecifiedCloseSchedule') IS DISTINCT FROM 'true') delivery_date,
   count(DISTINCT NULLIF(payload->>'deliveryDate','')::date) FILTER(WHERE (payload->>'closeCode') IS DISTINCT FROM '1' AND (payload->>'hasSpecifiedCloseSchedule') IS DISTINCT FROM 'true')>1 delivery_date_conflict
  FROM finance_e10_lines GROUP BY tenant_id,source_database,source_order_id
 ), monthly AS (
  SELECT leg.tenant_id,leg.source_database,leg.source_order_id,leg.year_month,
   sum(leg.base_amount)::numeric(28,2) base_amount,
   sum(leg.increase_amount)::numeric(28,2) increase_amount,
   sum(leg.decrease_amount)::numeric(28,2) decrease_amount,
   sum(leg.change_amount)::numeric(28,2) change_amount,
   sum(leg.order_total)::numeric(28,2) order_total,
   array_agg(leg.id) leg_ids
  FROM finance_e10_movement_source leg
  GROUP BY leg.tenant_id,leg.source_database,leg.source_order_id,leg.year_month
 )
 SELECT md5(jsonb_build_array(m.tenant_id,m.source_database,m.source_order_id,m.year_month)::text)::uuid id,
  m.tenant_id,m.source_database,m.source_order_id,o.created_by,m.year_month,o.customer_code,o.order_no,o.order_date,
  q.delivery_date,o.customer_order_no,m.order_total,o.department_category,o.sales_channel,o.salespeople,
  o.line_count,o.conflict,o.negative_lines,o.zero_lines,o.missing_lines,o.issue_lines,o.duplicate_sequence,
  o.duplicate_order_no,q.delivery_date_conflict,q.business_remark,
  CASE WHEN o.id=ANY(m.leg_ids) THEN CASE WHEN cardinality(m.leg_ids)>1 THEN 'BOTH' ELSE 'NEW' END ELSE 'CHANGE' END business_type,
  m.base_amount,m.increase_amount,m.decrease_amount,m.change_amount
 FROM monthly m JOIN finance_e10_orders_all o
  ON o.tenant_id=m.tenant_id AND o.source_database=m.source_database AND o.source_order_id=m.source_order_id
 JOIN metadata q
  ON q.tenant_id=m.tenant_id AND q.source_database=m.source_database AND q.source_order_id=m.source_order_id`);
  }
  async down() { throw new Error('Retain the order/month read model; roll back application without deleting financial history.'); }
}
