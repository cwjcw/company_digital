BEGIN;

-- The Drizzle audit model and write adapters record the last actor as updated_by.
-- Early foundation tables such as audit.audit_logs predated that column, so make
-- the physical schema consistent across every existing KDOS table.
DO $migration$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = ANY (ARRAY['iam', 'planning', 'marketing', 'integration', 'workflow', 'audit'])
    ORDER BY schemaname, tablename
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS updated_by uuid', target.schemaname, target.tablename);
  END LOOP;
END
$migration$;

COMMIT;
