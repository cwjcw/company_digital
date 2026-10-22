import type { MigrationInterface,QueryRunner } from 'typeorm';

/** Detect physical E10 removals without deleting evidence and expose persisted KDOS timestamps. */
export class FinanceE10SourcePresenceAndTimestamps1722920105000 implements MigrationInterface {
 name='FinanceE10SourcePresenceAndTimestamps1722920105000';
 async up(r:QueryRunner){
  await r.query(`CREATE TABLE finance_e10_presence_pages(
   tenant_id varchar(64) NOT NULL,run_id uuid NOT NULL,page integer NOT NULL,payload jsonb NOT NULL,
   PRIMARY KEY(tenant_id,run_id,page),FOREIGN KEY(tenant_id,run_id) REFERENCES finance_e10_runs(tenant_id,id));
  ALTER TABLE finance_e10_presence_pages ENABLE ROW LEVEL SECURITY;
  ALTER TABLE finance_e10_presence_pages FORCE ROW LEVEL SECURITY;
  CREATE POLICY finance_e10_presence_pages_tenant ON finance_e10_presence_pages
   USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));`);

  await r.query(`CREATE OR REPLACE VIEW finance_e10_raw WITH(security_invoker=true) AS SELECT l.id,l.tenant_id,l.created_by,l.source_database,l.source_order_id,l.source_line_id,l.source_missing,
   (l.payload->>'docType') AS doc_type,(l.payload->>'salesperson') AS salesperson,(l.payload->>'customerCode') AS customer_code,
   (l.payload->>'yearMonth') AS year_month,(l.payload->>'orderDate')::date AS order_date,(l.payload->>'orderNo') AS order_no,
   (l.payload->>'salesDepartment') AS sales_department,(l.payload->>'deliveryDate')::date AS delivery_date,
   (l.payload->>'currency') AS currency,(l.payload->>'exchangeRate')::numeric AS exchange_rate,(l.payload->>'sequence')::numeric AS sequence,
   (l.payload->>'itemCode') AS item_code,(l.payload->>'itemName') AS item_name,(l.payload->>'businessQty')::numeric AS business_qty,
   (l.payload->>'customerOrderNo') AS customer_order_no,(l.payload->>'businessRemark') AS business_remark,
   (l.payload->>'taxIncluded')::boolean AS tax_included,(l.payload->>'priceQty')::numeric AS price_qty,(l.payload->>'priceUnit') AS price_unit,
   (l.payload->>'deliveredBusinessQty')::numeric AS delivered_business_qty,(l.payload->>'deliveredPriceQty')::numeric AS delivered_price_qty,
   (l.payload->>'closeCode') AS close_code,(l.payload->>'settlementPriceQty')::numeric AS settlement_price_qty,
   (l.payload->>'price')::numeric AS price,(l.payload->>'amount')::numeric AS amount,(l.payload->>'taxName') AS tax_name,
   (l.payload->>'taxRate')::numeric AS tax_rate,(l.payload->>'originalNet')::numeric AS original_net,(l.payload->>'originalTax')::numeric AS original_tax,
   (l.payload->>'localNet')::numeric AS local_net,(l.payload->>'localTax')::numeric AS local_tax,(l.payload->>'settlementStatus') AS settlement_status,
   (l.payload->>'approved') AS approved,(l.payload->>'localGross')::numeric AS local_gross,
   COALESCE(jsonb_array_length(l.payload->'_issues'),0)>0 source_issue,m.department_category,m.sales_channel,l.created_at,l.updated_at
  FROM finance_e10_lines l LEFT JOIN finance_customer_mappings m ON m.tenant_id=l.tenant_id AND m.customer_code=l.payload->>'customerCode'`);

  await r.query(`CREATE OR REPLACE VIEW finance_e10_orders_all WITH(security_invoker=true) AS
  WITH grouped AS (
   SELECT (min(id::text) FILTER(WHERE NOT source_missing))::uuid id,tenant_id,source_database,source_order_id,
    (min(created_by::text) FILTER(WHERE NOT source_missing))::uuid created_by,
    min(year_month) FILTER(WHERE NOT source_missing) year_month,min(customer_code) FILTER(WHERE NOT source_missing) customer_code,
    min(order_no) FILTER(WHERE NOT source_missing) order_no,min(order_date) FILTER(WHERE NOT source_missing) order_date,
    min(delivery_date) FILTER(WHERE NOT source_missing) delivery_date,min(customer_order_no) FILTER(WHERE NOT source_missing) customer_order_no,
    sum(local_gross) FILTER(WHERE NOT source_missing)::numeric(28,2) order_total,
    min(department_category) FILTER(WHERE NOT source_missing) department_category,min(sales_channel) FILTER(WHERE NOT source_missing) sales_channel,
    jsonb_agg(DISTINCT salesperson) FILTER(WHERE NOT source_missing) salespeople,count(*) FILTER(WHERE NOT source_missing)::integer line_count,
    (count(DISTINCT customer_code) FILTER(WHERE NOT source_missing)>1 OR count(DISTINCT year_month) FILTER(WHERE NOT source_missing)>1 OR
     count(DISTINCT order_date) FILTER(WHERE NOT source_missing)>1 OR count(DISTINCT order_no) FILTER(WHERE NOT source_missing)>1 OR
     count(DISTINCT NULLIF(customer_order_no,'')) FILTER(WHERE NOT source_missing)>1) conflict,
    count(*) FILTER(WHERE NOT source_missing AND local_gross<0)::integer negative_lines,
    count(*) FILTER(WHERE NOT source_missing AND local_gross=0)::integer zero_lines,
    count(*) FILTER(WHERE source_missing)::integer missing_lines,count(*) FILTER(WHERE NOT source_missing AND source_issue)::integer issue_lines,
    (count(*) FILTER(WHERE NOT source_missing)<>count(DISTINCT sequence) FILTER(WHERE NOT source_missing)) duplicate_sequence,
    count(DISTINCT delivery_date) FILTER(WHERE NOT source_missing)>1 delivery_date_conflict
   FROM finance_e10_raw GROUP BY tenant_id,source_database,source_order_id
   HAVING count(*) FILTER(WHERE NOT source_missing)>0
  )
  SELECT id,tenant_id,source_database,source_order_id,created_by,year_month,customer_code,order_no,order_date,delivery_date,
   customer_order_no,order_total,department_category,sales_channel,salespeople,line_count,conflict,negative_lines,zero_lines,
   missing_lines,issue_lines,duplicate_sequence,count(*) OVER(PARTITION BY tenant_id,source_database,order_no)>1 duplicate_order_no,delivery_date_conflict
  FROM grouped`);

  await r.query(`CREATE OR REPLACE VIEW finance_e10_order_eligibility WITH(security_invoker=true) AS
  SELECT tenant_id,source_database,source_order_id,
   bool_or(coalesce(btrim(payload->>'docType')='材料销售单',false)) material,
   bool_and(coalesce(btrim(payload->>'approved'),'')='Y') approved,
   NOT bool_or(coalesce(btrim(payload->>'docType')='材料销售单',false)) AND bool_and(coalesce(btrim(payload->>'approved'),'')='Y') eligible,
   CASE WHEN min(payload->>'businessRemark') IS NOT DISTINCT FROM max(payload->>'businessRemark') THEN min(payload->>'businessRemark') END business_remark
  FROM finance_e10_lines WHERE NOT source_missing GROUP BY tenant_id,source_database,source_order_id`);

  await r.query(`CREATE OR REPLACE VIEW finance_e10_monthly WITH(security_invoker=true) AS
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
  WHERE qualification.eligible AND NOT record.conflict AND NOT record.duplicate_sequence AND NOT record.duplicate_order_no AND retained.issue_lines=0
   AND NOT EXISTS(SELECT 1 FROM finance_e10_lines source WHERE source.tenant_id=record.tenant_id AND source.source_database=record.source_database
    AND source.source_order_id=record.source_order_id AND NOT source.source_missing AND source.payload->>'headerCloseCode'='1')`);

  await r.query(`CREATE OR REPLACE VIEW finance_e10_changes WITH(security_invoker=true) AS
  SELECT e.id,e.tenant_id,e.source_database,e.event_key,e.source_order_id,e.source_line_id,e.source_document_id,e.order_no,e.order_date,e.customer_code,
   e.item_code,e.change_no,e.effective_at,e.source_time,e.year_month,e.change_kind,e.time_basis,
   CASE WHEN coalesce(q.eligible,false) AND line.id IS NOT NULL THEN e.amount_before END amount_before,
   CASE WHEN coalesce(q.eligible,false) AND line.id IS NOT NULL THEN e.amount_after END amount_after,
   CASE WHEN coalesce(q.eligible,false) AND line.id IS NOT NULL THEN e.change_amount END change_amount,e.raw_change,
   e.included AND coalesce(q.eligible,false) AND line.id IS NOT NULL AS included,
   e.evidence,e.payload,e.content_hash,e.active,e.created_by,e.created_at,e.updated_by,e.updated_at,e.version,m.department_category,m.sales_channel
  FROM finance_e10_change_events e LEFT JOIN finance_e10_order_eligibility q ON q.tenant_id=e.tenant_id AND q.source_database=e.source_database AND q.source_order_id=e.source_order_id
  LEFT JOIN finance_e10_lines line ON line.tenant_id=e.tenant_id AND line.source_database=e.source_database AND line.source_line_id=e.source_line_id AND NOT line.source_missing
  LEFT JOIN finance_customer_mappings m ON m.tenant_id=e.tenant_id AND m.customer_code=e.customer_code WHERE e.active`);

  await r.query(`CREATE OR REPLACE VIEW finance_e10_movement_source WITH(security_invoker=true) AS
  WITH changes AS(SELECT tenant_id,source_database,source_order_id,sum(change_amount) total FROM finance_e10_changes WHERE included AND active GROUP BY 1,2,3),
  source_times AS(SELECT tenant_id,source_database,source_order_id,min(created_at) FILTER(WHERE NOT source_missing) created_at,max(updated_at) updated_at
   FROM finance_e10_lines GROUP BY 1,2,3 HAVING count(*) FILTER(WHERE NOT source_missing)>0),
  bases AS(SELECT o.id,o.tenant_id,o.source_database,o.source_order_id,o.created_by,o.year_month,o.customer_code,o.order_no,o.order_date,
   (CASE WHEN current.id IS NULL THEN 0 ELSE current.order_total END)-coalesce(c.total,0) base_amount,t.created_at,t.updated_at
   FROM finance_e10_orders_all o JOIN finance_e10_order_eligibility qualification ON qualification.tenant_id=o.tenant_id AND qualification.source_database=o.source_database AND qualification.source_order_id=o.source_order_id AND qualification.eligible
   JOIN source_times t ON t.tenant_id=o.tenant_id AND t.source_database=o.source_database AND t.source_order_id=o.source_order_id
   LEFT JOIN finance_e10_monthly current ON current.tenant_id=o.tenant_id AND current.source_database=o.source_database AND current.source_order_id=o.source_order_id
   LEFT JOIN changes c ON c.tenant_id=o.tenant_id AND c.source_database=o.source_database AND c.source_order_id=o.source_order_id
   WHERE NOT o.conflict AND NOT o.duplicate_sequence AND NOT o.duplicate_order_no AND (current.id IS NOT NULL OR o.issue_lines=0)),
  legs AS(SELECT id,tenant_id,source_database,source_order_id,created_by,year_month,customer_code,order_no,order_date,order_date occurrence_date,
   base_amount,0::numeric increase_amount,0::numeric decrease_amount,0::numeric change_amount,created_at,updated_at FROM bases
   UNION ALL SELECT e.id,e.tenant_id,e.source_database,e.source_order_id,e.created_by,e.year_month,e.customer_code,e.order_no,e.order_date,
    (e.effective_at AT TIME ZONE 'Asia/Shanghai')::date,0::numeric,greatest(e.change_amount,0),least(e.change_amount,0),e.change_amount,
    e.created_at,greatest(e.updated_at,b.updated_at)
   FROM finance_e10_changes e JOIN bases b ON b.tenant_id=e.tenant_id AND b.source_database=e.source_database AND b.source_order_id=e.source_order_id WHERE e.included AND e.active)
  SELECT l.id,l.tenant_id,l.source_database,l.source_order_id,l.created_by,l.year_month,l.customer_code,l.order_no,l.order_date,l.occurrence_date,
   l.base_amount,l.increase_amount,l.decrease_amount,l.change_amount,l.base_amount+l.change_amount order_total,m.department_category,m.sales_channel,
   l.created_at,greatest(l.updated_at,m.updated_at) updated_at
  FROM legs l LEFT JOIN finance_customer_mappings m ON m.tenant_id=l.tenant_id AND m.customer_code=l.customer_code`);

  await r.query(`CREATE OR REPLACE VIEW finance_e10_order_monthly_movements WITH(security_invoker=true) AS
  WITH metadata AS (
   SELECT tenant_id,source_database,source_order_id,
    CASE WHEN min(payload->>'businessRemark') IS NOT DISTINCT FROM max(payload->>'businessRemark') THEN min(payload->>'businessRemark') END business_remark,
    min(NULLIF(payload->>'deliveryDate','')::date) FILTER(WHERE (payload->>'closeCode') IS DISTINCT FROM '1' AND (payload->>'hasSpecifiedCloseSchedule') IS DISTINCT FROM 'true') delivery_date,
    count(DISTINCT NULLIF(payload->>'deliveryDate','')::date) FILTER(WHERE (payload->>'closeCode') IS DISTINCT FROM '1' AND (payload->>'hasSpecifiedCloseSchedule') IS DISTINCT FROM 'true')>1 delivery_date_conflict
   FROM finance_e10_lines WHERE NOT source_missing GROUP BY tenant_id,source_database,source_order_id
  ), monthly AS (
   SELECT leg.tenant_id,leg.source_database,leg.source_order_id,leg.year_month,sum(leg.base_amount)::numeric(28,2) base_amount,
    sum(leg.increase_amount)::numeric(28,2) increase_amount,sum(leg.decrease_amount)::numeric(28,2) decrease_amount,
    sum(leg.change_amount)::numeric(28,2) change_amount,sum(leg.order_total)::numeric(28,2) order_total,array_agg(leg.id) leg_ids,
    min(leg.created_at) created_at,max(leg.updated_at) updated_at
   FROM finance_e10_movement_source leg GROUP BY leg.tenant_id,leg.source_database,leg.source_order_id,leg.year_month
  )
  SELECT md5(jsonb_build_array(m.tenant_id,m.source_database,m.source_order_id,m.year_month)::text)::uuid id,
   m.tenant_id,m.source_database,m.source_order_id,o.created_by,m.year_month,o.customer_code,o.order_no,o.order_date,q.delivery_date,
   o.customer_order_no,m.order_total,o.department_category,o.sales_channel,o.salespeople,o.line_count,o.conflict,o.negative_lines,o.zero_lines,
   o.missing_lines,o.issue_lines,o.duplicate_sequence,o.duplicate_order_no,q.delivery_date_conflict,q.business_remark,
   CASE WHEN o.id=ANY(m.leg_ids) THEN CASE WHEN cardinality(m.leg_ids)>1 THEN 'BOTH' ELSE 'NEW' END ELSE 'CHANGE' END business_type,
   m.base_amount,m.increase_amount,m.decrease_amount,m.change_amount,m.created_at,m.updated_at
  FROM monthly m JOIN finance_e10_orders_all o ON o.tenant_id=m.tenant_id AND o.source_database=m.source_database AND o.source_order_id=m.source_order_id
  JOIN metadata q ON q.tenant_id=m.tenant_id AND q.source_database=m.source_database AND q.source_order_id=m.source_order_id`);

  await r.query(`INSERT INTO permissions(role_id,resource,field_key,"read","create",copy,"update","delete",batch_print,batch_update,"import","export",updated_by)
   SELECT operation.role_id,operation.resource,field.key,true,false,false,false,false,false,false,false,false,'finance-timestamps'
   FROM permissions operation JOIN roles role ON role.id=operation.role_id CROSS JOIN (VALUES('createdAt'),('updatedAt')) field(key)
   WHERE operation.resource IN('finance-e10-lines','finance-e10-monthly') AND operation.field_key='*' AND operation."read"
    AND role.permission_group_resource=operation.resource
   ON CONFLICT(role_id,resource,field_key) DO NOTHING`);
 }
 async down(){throw new Error('Retain source-deletion evidence, timestamp permissions and corrected finance projections.');}
}
