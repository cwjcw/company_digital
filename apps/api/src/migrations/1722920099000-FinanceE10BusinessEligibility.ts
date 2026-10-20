import type { MigrationInterface,QueryRunner } from 'typeorm';
/** Re-evaluate effective amounts only. Source lines, facts, snapshots and posted event evidence remain intact. */
export class FinanceE10BusinessEligibility1722920099000 implements MigrationInterface {
 name='FinanceE10BusinessEligibility1722920099000';
 async up(r:QueryRunner){await r.query(`CREATE VIEW finance_e10_order_eligibility WITH(security_invoker=true) AS
 SELECT tenant_id,source_database,source_order_id,
 bool_or(coalesce(btrim(payload->>'docType')='材料销售单',false)) material,
 bool_and(coalesce(btrim(payload->>'approved'),'')='Y') approved,
 NOT bool_or(coalesce(btrim(payload->>'docType')='材料销售单',false))
  AND bool_and(coalesce(btrim(payload->>'approved'),'')='Y') eligible,
 CASE WHEN min(payload->>'businessRemark') IS NOT DISTINCT FROM max(payload->>'businessRemark') THEN min(payload->>'businessRemark') END business_remark
 FROM finance_e10_lines GROUP BY tenant_id,source_database,source_order_id;
CREATE OR REPLACE VIEW finance_e10_monthly WITH(security_invoker=true) AS
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
  record.duplicate_sequence,record.duplicate_order_no,retained.delivery_date_conflict,qualification.business_remark
 FROM finance_e10_orders_all record JOIN retained
  ON retained.tenant_id=record.tenant_id AND retained.source_database=record.source_database
   AND retained.source_order_id=record.source_order_id
 JOIN finance_e10_order_eligibility qualification ON qualification.tenant_id=record.tenant_id
  AND qualification.source_database=record.source_database AND qualification.source_order_id=record.source_order_id
 WHERE qualification.eligible AND NOT record.conflict AND NOT record.duplicate_sequence AND NOT record.duplicate_order_no
  AND record.missing_lines=0 AND retained.issue_lines=0
  AND NOT EXISTS (
   SELECT 1 FROM finance_e10_lines source
   WHERE source.tenant_id=record.tenant_id AND source.source_database=record.source_database
    AND source.source_order_id=record.source_order_id AND source.payload->>'headerCloseCode'='1'
  );
CREATE OR REPLACE VIEW finance_e10_changes WITH(security_invoker=true) AS SELECT e.id,e.tenant_id,e.source_database,e.event_key,e.source_order_id,e.source_line_id,e.source_document_id,e.order_no,e.order_date,e.customer_code,e.item_code,e.change_no,e.effective_at,e.source_time,e.year_month,e.change_kind,e.time_basis,CASE WHEN coalesce(q.eligible,false) THEN e.amount_before END amount_before,CASE WHEN coalesce(q.eligible,false) THEN e.amount_after END amount_after,CASE WHEN coalesce(q.eligible,false) THEN e.change_amount END change_amount,e.raw_change,e.included AND coalesce(q.eligible,false) AS included,e.evidence,e.payload,e.content_hash,e.active,e.created_by,e.created_at,e.updated_by,e.updated_at,e.version,m.department_category,m.sales_channel
 FROM finance_e10_change_events e LEFT JOIN finance_e10_order_eligibility q
 ON q.tenant_id=e.tenant_id AND q.source_database=e.source_database AND q.source_order_id=e.source_order_id
 LEFT JOIN finance_customer_mappings m ON m.tenant_id=e.tenant_id AND m.customer_code=e.customer_code WHERE e.active;
CREATE OR REPLACE VIEW finance_e10_movement_source WITH(security_invoker=true) AS
 WITH changes AS(SELECT tenant_id,source_database,source_order_id,sum(change_amount) total FROM finance_e10_changes WHERE included AND active GROUP BY 1,2,3),
 bases AS(SELECT o.id,o.tenant_id,o.source_database,o.source_order_id,o.created_by,o.year_month,o.customer_code,o.order_no,o.order_date,
 (CASE WHEN current.id IS NULL THEN 0 ELSE current.order_total END)-coalesce(c.total,0) base_amount
 FROM finance_e10_orders_all o JOIN finance_e10_order_eligibility qualification
 ON qualification.tenant_id=o.tenant_id AND qualification.source_database=o.source_database AND qualification.source_order_id=o.source_order_id AND qualification.eligible
 LEFT JOIN finance_e10_monthly current ON current.tenant_id=o.tenant_id AND current.source_database=o.source_database AND current.source_order_id=o.source_order_id
 LEFT JOIN changes c ON c.tenant_id=o.tenant_id AND c.source_database=o.source_database AND c.source_order_id=o.source_order_id
 WHERE NOT o.conflict AND NOT o.duplicate_sequence AND NOT o.duplicate_order_no AND o.missing_lines=0 AND (current.id IS NOT NULL OR o.issue_lines=0)),
 legs AS(SELECT id,tenant_id,source_database,source_order_id,created_by,year_month,customer_code,order_no,order_date,order_date occurrence_date,base_amount,0::numeric increase_amount,0::numeric decrease_amount,0::numeric change_amount FROM bases
 UNION ALL SELECT e.id,e.tenant_id,e.source_database,e.source_order_id,e.created_by,e.year_month,e.customer_code,e.order_no,e.order_date,(e.effective_at AT TIME ZONE 'Asia/Shanghai')::date,
 0::numeric,greatest(e.change_amount,0),least(e.change_amount,0),e.change_amount
 FROM finance_e10_changes e JOIN bases b ON b.tenant_id=e.tenant_id AND b.source_database=e.source_database AND b.source_order_id=e.source_order_id WHERE e.included AND e.active)
 SELECT l.*,l.base_amount+l.change_amount order_total,m.department_category,m.sales_channel
 FROM legs l LEFT JOIN finance_customer_mappings m ON m.tenant_id=l.tenant_id AND m.customer_code=l.customer_code;`);}
 async down(){throw new Error('Retain the corrected finance eligibility and historical source evidence on application rollback.');}
}
