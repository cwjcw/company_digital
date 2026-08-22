BEGIN;

ALTER TABLE marketing.two_week_schedules RENAME TO order_schedules;
ALTER TABLE marketing.order_schedules DROP COLUMN priority;
ALTER TABLE marketing.order_schedules ALTER COLUMN customer_due_date DROP NOT NULL;
ALTER TABLE marketing.order_schedules ADD COLUMN order_total_quantity numeric(18,4) NOT NULL DEFAULT 0;
ALTER TABLE marketing.order_schedules ADD COLUMN production_unit varchar(200);
ALTER TABLE marketing.order_schedules ADD COLUMN completion_ratio numeric(7,4) NOT NULL DEFAULT 0 CHECK (completion_ratio BETWEEN 0 AND 100);
ALTER TABLE marketing.order_schedules ADD COLUMN source_plan_item_id uuid;
ALTER TABLE marketing.order_schedules ADD COLUMN last_synced_at timestamptz;

CREATE INDEX order_schedules_tenant_order_idx ON marketing.order_schedules(tenant_id, order_number, item_number);
CREATE INDEX order_schedules_tenant_completion_idx ON marketing.order_schedules(tenant_id, completion_ratio);

CREATE TABLE planning.weekly_plan_periods (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES iam.tenants(id),
  sequence integer NOT NULL, name varchar(120) NOT NULL, start_date date NOT NULL, end_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  UNIQUE(tenant_id,start_date), CHECK(end_date >= start_date)
);

CREATE TABLE planning.weekly_plan_items (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES iam.tenants(id),
  weekly_plan_period_id uuid NOT NULL REFERENCES planning.weekly_plan_periods(id) ON DELETE CASCADE,
  source_order_schedule_id uuid REFERENCES marketing.order_schedules(id) ON DELETE SET NULL,
  customer_code varchar(120), order_number varchar(120) NOT NULL, item_number varchar(160) NOT NULL,
  item_name varchar(320), order_total_quantity numeric(18,4) NOT NULL DEFAULT 0, production_unit varchar(200),
  completion_ratio numeric(7,4) NOT NULL DEFAULT 0, customer_due_date date, review_due_date date,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  UNIQUE(weekly_plan_period_id,order_number,item_number), CHECK(completion_ratio BETWEEN 0 AND 100)
);
CREATE INDEX weekly_plan_items_period_idx ON planning.weekly_plan_items(tenant_id,weekly_plan_period_id);

CREATE TABLE planning.work_reports (
  id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id uuid NOT NULL REFERENCES iam.tenants(id), work_date date NOT NULL,
  source_plan_item_id uuid NOT NULL REFERENCES planning.plan_items(id) ON DELETE CASCADE,
  customer varchar(240), order_number varchar(120) NOT NULL, item_number varchar(160) NOT NULL, item_name varchar(320),
  required_quantity numeric(18,4) NOT NULL DEFAULT 0, reported_quantity numeric(18,4) NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  UNIQUE(tenant_id,work_date,source_plan_item_id)
);
CREATE INDEX work_reports_tenant_date_idx ON planning.work_reports(tenant_id,work_date);

INSERT INTO planning.weekly_plan_periods(tenant_id,sequence,name,start_date,end_date)
SELECT tenant.id, period.sequence, period.name, period.start_date::date, period.end_date::date
FROM iam.tenants tenant CROSS JOIN (VALUES
  (1,'第1周','2026-08-16','2026-08-22'),(2,'第2周','2026-08-23','2026-08-29'),
  (3,'第3周','2026-08-30','2026-09-05'),(4,'第4周','2026-09-06','2026-09-12')
) period(sequence,name,start_date,end_date)
ON CONFLICT(tenant_id,start_date) DO NOTHING;

DO $rls$
DECLARE target regclass;
BEGIN
  FOREACH target IN ARRAY ARRAY['planning.weekly_plan_periods'::regclass,'planning.weekly_plan_items'::regclass,'planning.work_reports'::regclass] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('CREATE POLICY tenant_isolation ON %s USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)', target);
  END LOOP;
END $rls$;

INSERT INTO iam.permissions(tenant_id,code,description)
SELECT tenant.id, permission.code, permission.description FROM iam.tenants tenant CROSS JOIN (VALUES
  ('order-schedule.read','读取订单排期'),('order-schedule.update','修改订单排期'),('order-schedule.import','从主计划同步订单排期'),('order-schedule.export','导出订单排期'),
  ('weekly-plan.read','读取周计划'),('weekly-plan.update','修改周计划'),('weekly-plan.import','从订单排期同步周计划'),('weekly-plan.export','导出周计划'),
  ('work-report.read','读取报工表'),('work-report.update','填写报工数量'),('work-report.import','从主计划同步报工表'),('work-report.export','导出报工表')
) permission(code,description)
ON CONFLICT(tenant_id,code) DO UPDATE SET description=EXCLUDED.description;

COMMIT;
