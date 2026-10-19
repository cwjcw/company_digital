import type { MigrationInterface,QueryRunner } from 'typeorm';
/** Join the reused balance by its unique tenant/account/order key; preserve every amount and eligibility rule. */
export class FinanceE10MovementJoin1722920098000 implements MigrationInterface {
 name='FinanceE10MovementJoin1722920098000';
 async up(r:QueryRunner){await r.query(`CREATE OR REPLACE VIEW finance_e10_movement_source WITH(security_invoker=true) AS
 WITH changes AS(SELECT tenant_id,source_database,source_order_id,sum(change_amount) total FROM finance_e10_change_events WHERE included AND active GROUP BY 1,2,3),
 bases AS(SELECT o.id,o.tenant_id,o.source_database,o.source_order_id,o.created_by,o.year_month,o.customer_code,o.order_no,o.order_date,
 (CASE WHEN current.id IS NULL THEN 0 ELSE current.order_total END)-coalesce(c.total,0) base_amount
 FROM finance_e10_orders_all o LEFT JOIN finance_e10_monthly current ON current.tenant_id=o.tenant_id AND current.source_database=o.source_database AND current.source_order_id=o.source_order_id
 LEFT JOIN changes c ON c.tenant_id=o.tenant_id AND c.source_database=o.source_database AND c.source_order_id=o.source_order_id
 WHERE NOT o.conflict AND NOT o.duplicate_sequence AND NOT o.duplicate_order_no AND o.missing_lines=0 AND (current.id IS NOT NULL OR o.issue_lines=0)),
 legs AS(SELECT id,tenant_id,source_database,source_order_id,created_by,year_month,customer_code,order_no,order_date,order_date occurrence_date,base_amount,0::numeric increase_amount,0::numeric decrease_amount,0::numeric change_amount FROM bases
 UNION ALL SELECT e.id,e.tenant_id,e.source_database,e.source_order_id,e.created_by,e.year_month,e.customer_code,e.order_no,e.order_date,(e.effective_at AT TIME ZONE 'Asia/Shanghai')::date,
 0::numeric,greatest(e.change_amount,0),least(e.change_amount,0),e.change_amount
 FROM finance_e10_change_events e JOIN bases b ON b.tenant_id=e.tenant_id AND b.source_database=e.source_database AND b.source_order_id=e.source_order_id WHERE e.included AND e.active)
 SELECT l.*,l.base_amount+l.change_amount order_total,m.department_category,m.sales_channel
 FROM legs l LEFT JOIN finance_customer_mappings m ON m.tenant_id=l.tenant_id AND m.customer_code=l.customer_code;`);}
 async down(){/* Retain the equivalent stable-key join on application rollback. */}
}
