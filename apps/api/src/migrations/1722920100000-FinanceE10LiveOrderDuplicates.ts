import type { MigrationInterface, QueryRunner } from 'typeorm';
import { FinanceE10EarliestDeliveryDate1722920091000 } from './1722920091000-FinanceE10EarliestDeliveryDate';

/** Keep historical source evidence, but only observed orders can compete for an order number. */
export class FinanceE10LiveOrderDuplicates1722920100000 implements MigrationInterface {
  name = 'FinanceE10LiveOrderDuplicates1722920100000';

  async up(r: QueryRunner) {
    await r.query(`CREATE OR REPLACE VIEW finance_e10_orders_all WITH(security_invoker=true) AS
 WITH grouped AS (
  SELECT min(id::text)::uuid id,tenant_id,source_database,source_order_id,min(created_by::text)::uuid created_by,
   min(year_month) year_month,min(customer_code) customer_code,min(order_no) order_no,min(order_date) order_date,
   min(delivery_date) delivery_date,min(customer_order_no) customer_order_no,
   sum(local_gross)::numeric(28,2) order_total,min(department_category) department_category,min(sales_channel) sales_channel,
   jsonb_agg(DISTINCT salesperson) salespeople,count(*)::integer line_count,
   (count(DISTINCT customer_code)>1 OR count(DISTINCT year_month)>1 OR count(DISTINCT order_date)>1 OR
    count(DISTINCT order_no)>1 OR count(DISTINCT NULLIF(customer_order_no,''))>1) conflict,
   count(*) FILTER(WHERE local_gross<0)::integer negative_lines,count(*) FILTER(WHERE local_gross=0)::integer zero_lines,
   count(*) FILTER(WHERE source_missing)::integer missing_lines,count(*) FILTER(WHERE source_issue)::integer issue_lines,
   (count(*)<>count(DISTINCT sequence)) duplicate_sequence,count(DISTINCT delivery_date)>1 delivery_date_conflict
  FROM finance_e10_raw GROUP BY tenant_id,source_database,source_order_id
 )
 SELECT id,tenant_id,source_database,source_order_id,created_by,year_month,customer_code,order_no,order_date,
  delivery_date,customer_order_no,order_total,department_category,sales_channel,salespeople,line_count,
  conflict,negative_lines,zero_lines,missing_lines,issue_lines,duplicate_sequence,
  count(*) FILTER(WHERE missing_lines<line_count)
   OVER(PARTITION BY tenant_id,source_database,order_no)>1 duplicate_order_no,delivery_date_conflict
 FROM grouped`);
  }

  async down(r: QueryRunner) {
    // Restore only the previous derived rule; source rows, amounts and audit evidence stay intact.
    await new FinanceE10EarliestDeliveryDate1722920091000().up(r);
  }
}
