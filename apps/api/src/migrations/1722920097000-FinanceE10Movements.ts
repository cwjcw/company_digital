import type { MigrationInterface, QueryRunner } from 'typeorm';
/** Additive finance ledger. Existing 34/9-column views and authorization rows are untouched. */
export class FinanceE10Movements1722920097000 implements MigrationInterface {
 name='FinanceE10Movements1722920097000';
 async up(r:QueryRunner){
 await r.query(`CREATE TABLE finance_e10_movement_runs(
 id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),
 status text NOT NULL CHECK(status IN ('RUNNING','SUCCESS','FAILED')),mode text NOT NULL CHECK(mode IN ('FULL','INCREMENTAL')),
 started_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,source_summary jsonb,changed_count integer NOT NULL DEFAULT 0,error_summary text,
 UNIQUE(tenant_id,id));
 CREATE UNIQUE INDEX finance_movement_one_run ON finance_e10_movement_runs(tenant_id) WHERE status='RUNNING';
 CREATE TABLE finance_e10_movement_pages(tenant_id varchar(64) NOT NULL,run_id uuid NOT NULL,page integer NOT NULL,kind text NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(tenant_id,run_id,page),FOREIGN KEY(tenant_id,run_id) REFERENCES finance_e10_movement_runs(tenant_id,id));
 CREATE TABLE finance_e10_movement_facts(
 id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,source_database text NOT NULL,kind text NOT NULL,source_key text NOT NULL,
 payload jsonb NOT NULL,content_hash text NOT NULL,observed_at text NOT NULL,last_run_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1,
 UNIQUE(tenant_id,source_database,kind,source_key),FOREIGN KEY(tenant_id,last_run_id) REFERENCES finance_e10_movement_runs(tenant_id,id));
 CREATE INDEX finance_movement_fact_kind ON finance_e10_movement_facts(tenant_id,source_database,kind);
 CREATE TABLE finance_e10_movement_snapshots(
 id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,source_database text NOT NULL,source_line_id uuid NOT NULL,run_id uuid NOT NULL,
 payload jsonb NOT NULL,observed_at text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,run_id) REFERENCES finance_e10_movement_runs(tenant_id,id),UNIQUE(tenant_id,run_id,source_line_id));
 CREATE TABLE finance_e10_change_events(
 id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,source_database text NOT NULL,event_key text NOT NULL,source_order_id uuid NOT NULL,source_line_id uuid,
 source_document_id uuid,order_no text NOT NULL,order_date date NOT NULL,customer_code text NOT NULL,item_code text,change_no text,
 effective_at timestamptz NOT NULL,source_time text NOT NULL,year_month text NOT NULL,change_kind text NOT NULL,time_basis text NOT NULL,
 amount_before numeric,amount_after numeric,change_amount numeric,raw_change numeric,included boolean NOT NULL,
 evidence jsonb NOT NULL,payload jsonb NOT NULL,content_hash text NOT NULL,active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1,
 CHECK(NOT included OR (amount_before IS NOT NULL AND amount_after IS NOT NULL AND change_amount IS NOT NULL AND change_amount=amount_after-amount_before)),
 UNIQUE(tenant_id,source_database,event_key));
 CREATE INDEX finance_change_month ON finance_e10_change_events(tenant_id,year_month,included) WHERE active;
 CREATE INDEX finance_change_order ON finance_e10_change_events(tenant_id,source_database,source_order_id,source_line_id);
 ALTER TABLE finance_e10_movement_facts ENABLE ROW LEVEL SECURITY;`);
 for(const t of ['finance_e10_movement_runs','finance_e10_movement_pages','finance_e10_movement_facts','finance_e10_movement_snapshots','finance_e10_change_events'])await r.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;
 CREATE POLICY ${t}_tenant ON ${t} USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));`);
 await r.query(`CREATE VIEW finance_e10_changes WITH(security_invoker=true) AS SELECT e.*,m.department_category,m.sales_channel
 FROM finance_e10_change_events e LEFT JOIN finance_customer_mappings m ON m.tenant_id=e.tenant_id AND m.customer_code=e.customer_code WHERE e.active;
 CREATE VIEW finance_e10_movement_source WITH(security_invoker=true) AS
 WITH changes AS(SELECT tenant_id,source_database,source_order_id,sum(change_amount) total FROM finance_e10_change_events WHERE included AND active GROUP BY 1,2,3),
 bases AS(SELECT o.id,o.tenant_id,o.source_database,o.source_order_id,o.created_by,o.year_month,o.customer_code,o.order_no,o.order_date,
 (CASE WHEN current.id IS NULL THEN 0 ELSE current.order_total END)-coalesce(c.total,0) base_amount
 FROM finance_e10_orders_all o LEFT JOIN finance_e10_monthly current ON current.tenant_id=o.tenant_id AND current.id=o.id
 LEFT JOIN changes c ON c.tenant_id=o.tenant_id AND c.source_database=o.source_database AND c.source_order_id=o.source_order_id
 WHERE NOT o.conflict AND NOT o.duplicate_sequence AND NOT o.duplicate_order_no AND o.missing_lines=0 AND (current.id IS NOT NULL OR o.issue_lines=0)),
 legs AS(SELECT id,tenant_id,source_database,source_order_id,created_by,year_month,customer_code,order_no,order_date,order_date occurrence_date,base_amount,0::numeric increase_amount,0::numeric decrease_amount,0::numeric change_amount FROM bases
 UNION ALL SELECT e.id,e.tenant_id,e.source_database,e.source_order_id,e.created_by,e.year_month,e.customer_code,e.order_no,e.order_date,(e.effective_at AT TIME ZONE 'Asia/Shanghai')::date,
 0::numeric,greatest(e.change_amount,0),least(e.change_amount,0),e.change_amount
 FROM finance_e10_change_events e JOIN bases b ON b.tenant_id=e.tenant_id AND b.source_database=e.source_database AND b.source_order_id=e.source_order_id WHERE e.included AND e.active)
 SELECT l.*,l.base_amount+l.change_amount order_total,m.department_category,m.sales_channel
 FROM legs l LEFT JOIN finance_customer_mappings m ON m.tenant_id=l.tenant_id AND m.customer_code=l.customer_code;`);
 }
 async down(){throw new Error('Retain ledger/evidence/audits; roll back application without deleting financial history.');}
}
