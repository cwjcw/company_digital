BEGIN;

ALTER TABLE marketing.order_schedules
  ADD COLUMN status varchar(16) NOT NULL DEFAULT 'NORMAL',
  ADD CONSTRAINT order_schedules_status_ck CHECK (status IN ('NORMAL','VOID'));

CREATE TABLE planning.rolling_plan_items (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants(id),
  source_order_schedule_id uuid REFERENCES marketing.order_schedules(id) ON DELETE SET NULL,
  order_number varchar(120) NOT NULL,
  item_number varchar(160) NOT NULL,
  customer_name varchar(240),
  order_quantity numeric(18,4) NOT NULL DEFAULT 0,
  production_quantity numeric(18,4) NOT NULL DEFAULT 0,
  delivery_date date,
  responsible_org_id uuid,
  sequence integer NOT NULL DEFAULT 0,
  legacy_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT rolling_plan_items_tenant_order_item_uq UNIQUE (tenant_id, order_number, item_number)
);

CREATE INDEX rolling_plan_items_tenant_sequence_idx ON planning.rolling_plan_items(tenant_id, sequence);
CREATE INDEX rolling_plan_items_tenant_delivery_idx ON planning.rolling_plan_items(tenant_id, delivery_date);
CREATE INDEX rolling_plan_items_responsible_org_idx ON planning.rolling_plan_items(tenant_id, responsible_org_id);

ALTER TABLE planning.rolling_plan_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON planning.rolling_plan_items
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE TABLE planning.division_order_reviews (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants(id),
  source_order_schedule_id uuid REFERENCES marketing.order_schedules(id) ON DELETE SET NULL,
  customer_code varchar(120) NOT NULL,
  department varchar(200),
  section varchar(200),
  department_id uuid,
  salesperson_user_ids uuid[] NOT NULL DEFAULT '{}',
  order_number varchar(120) NOT NULL,
  item_number varchar(160) NOT NULL,
  item_name varchar(320) NOT NULL,
  customer_due_date date,
  order_total_quantity numeric(18,4) NOT NULL DEFAULT 0,
  production_unit varchar(200),
  completion_ratio numeric(7,4) NOT NULL DEFAULT 0,
  status varchar(16) NOT NULL DEFAULT 'NORMAL',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT division_order_reviews_source_uq UNIQUE (tenant_id, source_order_schedule_id),
  CONSTRAINT division_order_reviews_business_uq UNIQUE (tenant_id, order_number, item_number),
  CONSTRAINT division_order_reviews_status_ck CHECK (status IN ('NORMAL','VOID')),
  CONSTRAINT division_order_reviews_completion_ck CHECK (completion_ratio BETWEEN 0 AND 100)
);

CREATE INDEX division_order_reviews_tenant_order_idx ON planning.division_order_reviews(tenant_id, order_number, item_number);
CREATE INDEX division_order_reviews_department_idx ON planning.division_order_reviews(tenant_id, department_id);
CREATE INDEX division_order_reviews_status_idx ON planning.division_order_reviews(tenant_id, status);
CREATE INDEX division_order_reviews_due_idx ON planning.division_order_reviews(tenant_id, customer_due_date);
ALTER TABLE planning.division_order_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON planning.division_order_reviews
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO planning.division_order_reviews(
  tenant_id,source_order_schedule_id,customer_code,department,section,department_id,salesperson_user_ids,
  order_number,item_number,item_name,customer_due_date,order_total_quantity,production_unit,completion_ratio,status,
  created_by,created_at,updated_by,updated_at
)
SELECT tenant_id,id,customer_code,department,section,department_id,salesperson_user_ids,
  order_number,item_number,item_name,customer_due_date,order_total_quantity,production_unit,completion_ratio,status,
  created_by,created_at,updated_by,updated_at
FROM marketing.order_schedules
ON CONFLICT(tenant_id,order_number,item_number) DO NOTHING;

INSERT INTO iam.permissions(tenant_id,code,description)
SELECT tenant.id, permission.code, permission.description
FROM iam.tenants tenant CROSS JOIN (VALUES
  ('rolling-plan-table.read','读取滚动计划表'),
  ('rolling-plan-table.import','从订单排期同步滚动计划表'),
  ('rolling-plan-table.export','导出滚动计划表'),
  ('division-order-review.read','读取事业部订单评审'),
  ('division-order-review.export','导出事业部订单评审')
) permission(code,description)
ON CONFLICT(tenant_id,code) DO UPDATE SET description=EXCLUDED.description;

COMMIT;
