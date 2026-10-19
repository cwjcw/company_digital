import type { MigrationInterface, QueryRunner } from 'typeorm';
import { FinanceE10SpecifiedClose1722920095000 } from './1722920095000-FinanceE10SpecifiedClose';

/** Header closure excludes an order; schedule closure excludes only its stable source item.
 * Original rows and the all-orders review view remain available for financial traceability.
 */
export class FinanceE10SpecifiedItems1722920096000 implements MigrationInterface {
  name = 'FinanceE10SpecifiedItems1722920096000';
  async up(r: QueryRunner) {
    await r.query(`CREATE OR REPLACE VIEW finance_e10_monthly WITH(security_invoker=true) AS
 WITH retained AS (
  SELECT item.tenant_id,item.source_database,item.source_order_id,
   min(item.delivery_date) delivery_date,sum(item.local_gross)::numeric(28,2) order_total,
   jsonb_agg(DISTINCT item.salesperson) salespeople,count(*)::integer line_count,
   count(*) FILTER(WHERE item.local_gross<0)::integer negative_lines,
   count(*) FILTER(WHERE item.local_gross=0)::integer zero_lines,
   count(*) FILTER(WHERE item.source_issue)::integer issue_lines,
   count(DISTINCT item.delivery_date)>1 delivery_date_conflict
  FROM finance_e10_raw item JOIN finance_e10_lines source
   ON source.id=item.id AND source.tenant_id=item.tenant_id
  WHERE item.close_code IS DISTINCT FROM '1'
   AND (source.payload->>'hasSpecifiedCloseSchedule') IS DISTINCT FROM 'true'
  GROUP BY item.tenant_id,item.source_database,item.source_order_id
 )
 SELECT record.id,record.tenant_id,record.source_database,record.source_order_id,record.created_by,
  record.year_month,record.customer_code,record.order_no,record.order_date,
  retained.delivery_date,record.customer_order_no,retained.order_total,
  record.department_category,record.sales_channel,retained.salespeople,retained.line_count,
  record.conflict,retained.negative_lines,retained.zero_lines,record.missing_lines,retained.issue_lines,
  record.duplicate_sequence,record.duplicate_order_no,retained.delivery_date_conflict
 FROM finance_e10_orders_all record JOIN retained
  ON retained.tenant_id=record.tenant_id AND retained.source_database=record.source_database
   AND retained.source_order_id=record.source_order_id
 WHERE NOT record.conflict AND NOT record.duplicate_sequence AND NOT record.duplicate_order_no
  AND record.missing_lines=0 AND retained.issue_lines=0
  AND NOT EXISTS (
   SELECT 1 FROM finance_e10_lines source
   WHERE source.tenant_id=record.tenant_id AND source.source_database=record.source_database
    AND source.source_order_id=record.source_order_id AND source.payload->>'headerCloseCode'='1'
  )`);
  }
  async down(r: QueryRunner) {
    await new FinanceE10SpecifiedClose1722920095000().up(r);
  }
}
