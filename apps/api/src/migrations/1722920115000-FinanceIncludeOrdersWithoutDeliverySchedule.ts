import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Missing delivery schedules remain visible as quality issues, but do not suppress an otherwise eligible order's finance amount. */
export class FinanceIncludeOrdersWithoutDeliverySchedule1722920115000 implements MigrationInterface {
  name = 'FinanceIncludeOrdersWithoutDeliverySchedule1722920115000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(this.monthlyView(true));
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(this.monthlyView(false));
  }

  private monthlyView(includeMissingScheduleOnlyIssues: boolean): string {
    const issueGate = includeMissingScheduleOnlyIssues
      ? `AND NOT EXISTS (
    SELECT 1 FROM finance_e10_lines issue
    WHERE issue.tenant_id=record.tenant_id AND issue.source_database=record.source_database
      AND issue.source_order_id=record.source_order_id AND NOT issue.source_missing
      AND CASE WHEN jsonb_typeof(issue.payload->'_issues')='array'
        THEN jsonb_array_length(issue.payload->'_issues')>0 ELSE false END
      AND NOT (
        issue.payload->>'scheduleCount'='0'
        AND CASE WHEN jsonb_typeof(issue.payload->'_issues')='array'
          THEN (
            issue.payload->'_issues'='["交货计划缺失"]'::jsonb
            OR (jsonb_array_length(issue.payload->'_issues')=2
              AND issue.payload->'_issues' @> '["交货计划缺失","结束码冲突"]'::jsonb)
          )
          ELSE false END
      )
   )`
      : 'AND retained.issue_lines=0';

    return `CREATE OR REPLACE VIEW finance_e10_monthly WITH(security_invoker=true) AS
  WITH retained AS (
   SELECT item.tenant_id,item.source_database,item.source_order_id,min(item.delivery_date) delivery_date,
    sum(item.local_gross)::numeric(28,2) order_total,jsonb_agg(DISTINCT item.salesperson) salespeople,count(*)::integer line_count,
    count(*) FILTER(WHERE item.local_gross<0)::integer negative_lines,count(*) FILTER(WHERE item.local_gross=0)::integer zero_lines,
    count(*) FILTER(WHERE item.source_issue)::integer issue_lines,count(DISTINCT item.delivery_date)>1 delivery_date_conflict
   FROM finance_e10_raw item JOIN finance_e10_lines source ON source.id=item.id AND source.tenant_id=item.tenant_id
   WHERE NOT item.source_missing AND item.close_code IS DISTINCT FROM '1' AND (source.payload->>'hasSpecifiedCloseSchedule') IS DISTINCT FROM 'true'
   GROUP BY item.tenant_id,item.source_database,item.source_order_id
  )
  SELECT record.id,record.tenant_id,record.source_database,record.source_order_id,record.created_by,record.year_month,record.customer_code,
   record.order_no,record.order_date,retained.delivery_date,record.customer_order_no,retained.order_total,record.department_category,
   record.sales_channel,retained.salespeople,retained.line_count,record.conflict,retained.negative_lines,retained.zero_lines,
   record.missing_lines,retained.issue_lines,record.duplicate_sequence,record.duplicate_order_no,retained.delivery_date_conflict,qualification.business_remark
  FROM finance_e10_orders_all record JOIN retained ON retained.tenant_id=record.tenant_id AND retained.source_database=record.source_database AND retained.source_order_id=record.source_order_id
  JOIN finance_e10_order_eligibility qualification ON qualification.tenant_id=record.tenant_id AND qualification.source_database=record.source_database AND qualification.source_order_id=record.source_order_id
  WHERE qualification.eligible AND NOT record.conflict AND NOT record.duplicate_sequence AND NOT record.duplicate_order_no ${issueGate}
   AND NOT EXISTS(SELECT 1 FROM finance_e10_lines source WHERE source.tenant_id=record.tenant_id AND source.source_database=record.source_database
    AND source.source_order_id=record.source_order_id AND NOT source.source_missing AND source.payload->>'headerCloseCode'='1')`;
  }
}
