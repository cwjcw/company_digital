ALTER TABLE marketing.business_customer_mappings
  ADD COLUMN IF NOT EXISTS department_id uuid,
  ADD COLUMN IF NOT EXISTS section_id uuid;

ALTER TABLE marketing.order_schedules
  ADD COLUMN IF NOT EXISTS department_id uuid,
  ADD COLUMN IF NOT EXISTS section_id uuid;

CREATE INDEX IF NOT EXISTS business_customer_mappings_tenant_department_id_idx
  ON marketing.business_customer_mappings(tenant_id, department_id, section_id);

CREATE INDEX IF NOT EXISTS order_schedules_tenant_department_id_idx
  ON marketing.order_schedules(tenant_id, department_id, section_id);

COMMENT ON COLUMN marketing.business_customer_mappings.department_id IS 'Stable organization_units UUID; cross-database compatibility reference';
COMMENT ON COLUMN marketing.business_customer_mappings.section_id IS 'Stable organization_units UUID; cross-database compatibility reference';
COMMENT ON COLUMN marketing.order_schedules.department_id IS 'Stable organization_units UUID copied from business_customer_mappings';
COMMENT ON COLUMN marketing.order_schedules.section_id IS 'Stable organization_units UUID copied from business_customer_mappings';
