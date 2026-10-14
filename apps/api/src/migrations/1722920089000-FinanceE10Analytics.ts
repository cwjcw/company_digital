import type { MigrationInterface, QueryRunner } from 'typeorm';
/** Finance read model only: no ERP or Planning authoritative rows are changed. */
export class FinanceE10Analytics1722920089000 implements MigrationInterface {
 name='FinanceE10Analytics1722920089000';
 async up(r:QueryRunner){await r.query(`
 CREATE TABLE finance_e10_runs(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,
 status varchar(20) NOT NULL CHECK(status IN ('RUNNING','SUCCESS','FAILED')),mode varchar(20) NOT NULL DEFAULT 'FULL',
 actor_id uuid NOT NULL REFERENCES users(id),started_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 source_summary jsonb,cursor jsonb,page_count integer NOT NULL DEFAULT 0,line_count integer NOT NULL DEFAULT 0,
 changed_count integer NOT NULL DEFAULT 0,error_summary varchar(500),UNIQUE(tenant_id,id));
 CREATE UNIQUE INDEX finance_e10_one_run ON finance_e10_runs(tenant_id) WHERE status='RUNNING';
 CREATE TABLE finance_e10_pages(tenant_id varchar(64) NOT NULL,run_id uuid NOT NULL,page integer NOT NULL,
 payload jsonb NOT NULL,PRIMARY KEY(tenant_id,run_id,page),FOREIGN KEY(tenant_id,run_id) REFERENCES finance_e10_runs(tenant_id,id));
 CREATE TABLE finance_e10_lines(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,
 source_database varchar(128) NOT NULL,source_order_id uuid NOT NULL,source_line_id uuid NOT NULL,
 payload jsonb NOT NULL,source_modified_at varchar(40),last_run_id uuid NOT NULL,source_missing boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL REFERENCES users(id),updated_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1,
 UNIQUE(tenant_id,source_database,source_line_id),FOREIGN KEY(tenant_id,last_run_id) REFERENCES finance_e10_runs(tenant_id,id));
 CREATE INDEX finance_e10_order ON finance_e10_lines(tenant_id,source_database,source_order_id);
 CREATE INDEX finance_e10_date ON finance_e10_lines(tenant_id,(payload->>'yearMonth'));
 `);
 for(const t of ['finance_e10_runs','finance_e10_pages','finance_e10_lines'])await r.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;
 CREATE POLICY ${t}_tenant ON ${t} USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));`);
 await r.query(`CREATE VIEW finance_e10_raw WITH(security_invoker=true) AS SELECT l.id,l.tenant_id,l.created_by,l.source_database,l.source_order_id,l.source_line_id,l.source_missing,
 (l.payload->>'docType') AS doc_type,
 (l.payload->>'salesperson') AS salesperson,
 (l.payload->>'customerCode') AS customer_code,
 (l.payload->>'yearMonth') AS year_month,
 (l.payload->>'orderDate')::date AS order_date,
 (l.payload->>'orderNo') AS order_no,
 (l.payload->>'salesDepartment') AS sales_department,
 (l.payload->>'deliveryDate')::date AS delivery_date,
 (l.payload->>'currency') AS currency,
 (l.payload->>'exchangeRate')::numeric AS exchange_rate,
 (l.payload->>'sequence')::numeric AS sequence,
 (l.payload->>'itemCode') AS item_code,
 (l.payload->>'itemName') AS item_name,
 (l.payload->>'businessQty')::numeric AS business_qty,
 (l.payload->>'customerOrderNo') AS customer_order_no,
 (l.payload->>'businessRemark') AS business_remark,
 (l.payload->>'taxIncluded')::boolean AS tax_included,
 (l.payload->>'priceQty')::numeric AS price_qty,
 (l.payload->>'priceUnit') AS price_unit,
 (l.payload->>'deliveredBusinessQty')::numeric AS delivered_business_qty,
 (l.payload->>'deliveredPriceQty')::numeric AS delivered_price_qty,
 (l.payload->>'closeCode') AS close_code,
 (l.payload->>'settlementPriceQty')::numeric AS settlement_price_qty,
 (l.payload->>'price')::numeric AS price,
 (l.payload->>'amount')::numeric AS amount,
 (l.payload->>'taxName') AS tax_name,
 (l.payload->>'taxRate')::numeric AS tax_rate,
 (l.payload->>'originalNet')::numeric AS original_net,
 (l.payload->>'originalTax')::numeric AS original_tax,
 (l.payload->>'localNet')::numeric AS local_net,
 (l.payload->>'localTax')::numeric AS local_tax,
 (l.payload->>'settlementStatus') AS settlement_status,
 (l.payload->>'approved') AS approved,
 (l.payload->>'localGross')::numeric AS local_gross,
 COALESCE(jsonb_array_length(l.payload->'_issues'),0)>0 source_issue,
 m.department_category,m.sales_channel FROM finance_e10_lines l LEFT JOIN finance_customer_mappings m ON m.tenant_id=l.tenant_id AND m.customer_code=l.payload->>'customerCode';
 CREATE VIEW finance_e10_orders_all WITH(security_invoker=true) AS
 SELECT min(id::text)::uuid id,tenant_id,source_database,source_order_id,min(created_by::text)::uuid created_by,
 min(year_month) year_month,min(customer_code) customer_code,min(order_no) order_no,min(order_date) order_date,
 CASE WHEN count(DISTINCT delivery_date)<=1 THEN min(delivery_date) ELSE NULL END delivery_date,
 min(customer_order_no) customer_order_no,sum(local_gross)::numeric(28,2) order_total,
 min(department_category) department_category,min(sales_channel) sales_channel,
 jsonb_agg(DISTINCT salesperson) salespeople,count(*)::integer line_count,
 (count(DISTINCT customer_code)>1 OR count(DISTINCT year_month)>1 OR count(DISTINCT order_date)>1 OR
 count(DISTINCT order_no)>1 OR count(DISTINCT NULLIF(customer_order_no,''))>1 OR count(DISTINCT delivery_date)>1) conflict,
 count(*) FILTER(WHERE local_gross<0)::integer negative_lines,count(*) FILTER(WHERE local_gross=0)::integer zero_lines,
 count(*) FILTER(WHERE source_missing)::integer missing_lines,count(*) FILTER(WHERE source_issue)::integer issue_lines,
 (count(*)<>count(DISTINCT sequence)) duplicate_sequence,
 count(*) OVER(PARTITION BY tenant_id,source_database,min(order_no))>1 duplicate_order_no
 FROM finance_e10_raw GROUP BY tenant_id,source_database,source_order_id;
 CREATE VIEW finance_e10_monthly WITH(security_invoker=true) AS SELECT * FROM finance_e10_orders_all WHERE NOT conflict AND NOT duplicate_sequence AND NOT duplicate_order_no AND missing_lines=0 AND issue_lines=0;
 CREATE VIEW finance_e10_ranking WITH(security_invoker=true) AS SELECT md5(tenant_id||customer_code)::uuid id,tenant_id,
 min(created_by::text)::uuid created_by,customer_code,sum(order_total)::numeric(28,2) order_total FROM finance_e10_monthly GROUP BY tenant_id,customer_code;`);
 }
 async down(){throw new Error('Retain finance read model and audits; roll back application without deleting historical data.');}
}
