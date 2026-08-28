DROP INDEX IF EXISTS marketing.business_customer_mappings_tenant_department_id_idx;
DROP INDEX IF EXISTS marketing.order_schedules_tenant_department_id_idx;

ALTER TABLE marketing.business_customer_mappings
  DROP COLUMN IF EXISTS section_id;

ALTER TABLE marketing.order_schedules
  DROP COLUMN IF EXISTS section_id;

CREATE INDEX business_customer_mappings_tenant_department_id_idx
  ON marketing.business_customer_mappings(tenant_id, department_id);

CREATE INDEX order_schedules_tenant_department_id_idx
  ON marketing.order_schedules(tenant_id, department_id);

COMMENT ON COLUMN marketing.business_customer_mappings.section IS 'Ordinary business text; not an organization node';
COMMENT ON COLUMN marketing.order_schedules.section IS 'Ordinary business text copied from business_customer_mappings';
