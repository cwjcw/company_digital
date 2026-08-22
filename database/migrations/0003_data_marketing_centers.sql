BEGIN;

CREATE SCHEMA IF NOT EXISTS marketing;

CREATE TABLE marketing.business_customer_mappings (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants(id),
  department varchar(200) NOT NULL,
  section varchar(200) NOT NULL,
  salesperson varchar(200) NOT NULL,
  customer_codes text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT business_customer_mappings_tenant_salesperson_uq
    UNIQUE (tenant_id, department, section, salesperson),
  CONSTRAINT business_customer_mappings_customer_codes_ck
    CHECK (length(btrim(customer_codes)) > 0)
);

CREATE INDEX business_customer_mappings_tenant_department_idx
  ON marketing.business_customer_mappings(tenant_id, department, section);

CREATE TABLE marketing.two_week_schedules (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants(id),
  customer_code varchar(120) NOT NULL,
  order_number varchar(120) NOT NULL,
  item_number varchar(160) NOT NULL,
  item_name varchar(320) NOT NULL,
  customer_due_date date NOT NULL,
  priority integer NOT NULL DEFAULT 50 CHECK (priority BETWEEN 1 AND 9999),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT two_week_schedules_tenant_order_item_uq
    UNIQUE (tenant_id, order_number, item_number)
);

CREATE INDEX two_week_schedules_tenant_due_priority_idx
  ON marketing.two_week_schedules(tenant_id, customer_due_date, priority);

ALTER TABLE marketing.business_customer_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketing.business_customer_mappings
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE marketing.two_week_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketing.two_week_schedules
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO iam.permissions(tenant_id, code, description)
SELECT tenant.id, permission.code, permission.description
FROM iam.tenants tenant
CROSS JOIN (VALUES
  ('business-customer-mapping.read','读取业务人员与客户对应表'),
  ('business-customer-mapping.create','新增业务人员与客户对应关系'),
  ('business-customer-mapping.update','修改业务人员与客户对应关系'),
  ('business-customer-mapping.delete','删除业务人员与客户对应关系'),
  ('business-customer-mapping.import','导入业务人员与客户对应关系'),
  ('business-customer-mapping.export','导出业务人员与客户对应关系'),
  ('two-week-schedule.read','读取未来2周排期'),
  ('two-week-schedule.create','新增未来2周排期'),
  ('two-week-schedule.update','修改未来2周排期优先级'),
  ('two-week-schedule.delete','删除未来2周排期'),
  ('two-week-schedule.import','导入未来2周排期'),
  ('two-week-schedule.export','导出未来2周排期')
) AS permission(code, description)
ON CONFLICT (tenant_id, code) DO UPDATE SET description=EXCLUDED.description;

COMMIT;
