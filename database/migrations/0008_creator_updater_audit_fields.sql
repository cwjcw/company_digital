BEGIN;

-- Business tables expose exactly four immutable audit fields. The operation
-- history remains in audit.audit_logs; it no longer leaks into record schemas.
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
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS created_by uuid', target.schemaname, target.tablename);
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()', target.schemaname, target.tablename);
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS updated_by uuid', target.schemaname, target.tablename);
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()', target.schemaname, target.tablename);
    EXECUTE format('UPDATE %I.%I SET updated_by=created_by WHERE updated_by IS NULL AND created_by IS NOT NULL', target.schemaname, target.tablename);
    EXECUTE format('ALTER TABLE %I.%I DROP COLUMN IF EXISTS audited_at', target.schemaname, target.tablename);
  END LOOP;
END
$migration$;

COMMIT;
