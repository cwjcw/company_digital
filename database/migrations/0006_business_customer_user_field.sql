BEGIN;

-- Convert the legacy "one salesperson + multiple customer codes" shape into one
-- customer per row. Directory user IDs live in the retained legacy identity store,
-- so this database keeps stable UUID values and the application validates them.
CREATE TEMP TABLE business_customer_mappings_expanded ON COMMIT DROP AS
SELECT
  mapping.tenant_id,
  mapping.department,
  mapping.section,
  btrim(code.value) AS customer_code,
  mapping.created_at,
  mapping.created_by,
  mapping.updated_at,
  mapping.updated_by,
  mapping.audited_at,
  row_number() OVER (
    PARTITION BY mapping.tenant_id, upper(btrim(code.value))
    ORDER BY mapping.created_at, mapping.id
  ) AS customer_rank
FROM marketing.business_customer_mappings mapping
CROSS JOIN LATERAL regexp_split_to_table(mapping.customer_codes, '[|、,，;；[:space:]]+') AS code(value)
WHERE btrim(code.value) <> '';

DELETE FROM marketing.business_customer_mappings;

ALTER TABLE marketing.business_customer_mappings
  DROP CONSTRAINT IF EXISTS business_customer_mappings_tenant_salesperson_uq,
  DROP CONSTRAINT IF EXISTS business_customer_mappings_customer_codes_ck,
  DROP COLUMN salesperson,
  DROP COLUMN customer_codes,
  ADD COLUMN customer_code varchar(120),
  ADD COLUMN salesperson_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

INSERT INTO marketing.business_customer_mappings
  (tenant_id, department, section, customer_code, salesperson_user_ids,
   created_at, created_by, updated_at, updated_by, audited_at)
SELECT
  tenant_id, department, section, customer_code, '{}'::uuid[],
  created_at, created_by, updated_at, updated_by, audited_at
FROM business_customer_mappings_expanded
WHERE customer_rank = 1;

ALTER TABLE marketing.business_customer_mappings
  ALTER COLUMN customer_code SET NOT NULL,
  ADD CONSTRAINT business_customer_mappings_customer_code_ck CHECK (length(btrim(customer_code)) > 0),
  ADD CONSTRAINT business_customer_mappings_tenant_customer_uq UNIQUE (tenant_id, customer_code);

COMMENT ON COLUMN marketing.business_customer_mappings.salesperson_user_ids IS
  'Stable UUIDs of enabled directory users; display names are derived by the application.';

COMMIT;
