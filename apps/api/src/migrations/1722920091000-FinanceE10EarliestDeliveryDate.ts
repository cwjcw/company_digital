import type { MigrationInterface, QueryRunner } from 'typeorm';
import { FinanceE10DeliveryDateConflicts1722920090000 } from './1722920090000-FinanceE10DeliveryDateConflicts';

/** The latest finance rule uses the earliest non-null valid item date; money and source items stay unchanged. */
export class FinanceE10EarliestDeliveryDate1722920091000 implements MigrationInterface {
  name = 'FinanceE10EarliestDeliveryDate1722920091000';
  async up(r: QueryRunner) {
    await r.query(`CREATE OR REPLACE VIEW finance_e10_orders_all WITH(security_invoker=true) AS
 SELECT min(id::text)::uuid id,tenant_id,source_database,source_order_id,min(created_by::text)::uuid created_by,
 min(year_month) year_month,min(customer_code) customer_code,min(order_no) order_no,min(order_date) order_date,
 min(delivery_date) delivery_date,
 min(customer_order_no) customer_order_no,sum(local_gross)::numeric(28,2) order_total,
 min(department_category) department_category,min(sales_channel) sales_channel,
 jsonb_agg(DISTINCT salesperson) salespeople,count(*)::integer line_count,
 (count(DISTINCT customer_code)>1 OR count(DISTINCT year_month)>1 OR count(DISTINCT order_date)>1 OR
 count(DISTINCT order_no)>1 OR count(DISTINCT NULLIF(customer_order_no,''))>1) conflict,
 count(*) FILTER(WHERE local_gross<0)::integer negative_lines,count(*) FILTER(WHERE local_gross=0)::integer zero_lines,
 count(*) FILTER(WHERE source_missing)::integer missing_lines,count(*) FILTER(WHERE source_issue)::integer issue_lines,
 (count(*)<>count(DISTINCT sequence)) duplicate_sequence,
 count(*) OVER(PARTITION BY tenant_id,source_database,min(order_no))>1 duplicate_order_no,
 count(DISTINCT delivery_date)>1 delivery_date_conflict
 FROM finance_e10_raw GROUP BY tenant_id,source_database,source_order_id;
`);
  }
  async down(r: QueryRunner) {
    // Restore the previous derived-date policy without changing any source row or financial amount.
    await new FinanceE10DeliveryDateConflicts1722920090000().up(r);
  }
}
