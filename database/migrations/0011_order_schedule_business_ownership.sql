BEGIN;

ALTER TABLE marketing.order_schedules
  ADD COLUMN department varchar(200),
  ADD COLUMN section varchar(200),
  ADD COLUMN salesperson_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN marketing.order_schedules.department IS
  'Read-only snapshot synchronized from marketing.business_customer_mappings by customer_code.';
COMMENT ON COLUMN marketing.order_schedules.section IS
  'Read-only snapshot synchronized from marketing.business_customer_mappings by customer_code.';
COMMENT ON COLUMN marketing.order_schedules.salesperson_user_ids IS
  'Read-only directory user IDs synchronized from marketing.business_customer_mappings by customer_code.';

CREATE INDEX order_schedules_tenant_business_ownership_idx
  ON marketing.order_schedules(tenant_id, department, section);

COMMIT;
