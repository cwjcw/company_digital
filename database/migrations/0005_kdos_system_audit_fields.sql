BEGIN;

-- KDOS 表单规范要求每张现有数据表统一具备四个只读系统字段，
-- 同时使用正整数 version 作为乐观锁版本。迁移使用目录发现，避免遗漏后续
-- 已经先于本迁移落库的 IAM、计划、营销、集成、审批或审计表。
DO $migration$
DECLARE
  target record;
  constraint_name text;
BEGIN
  FOR target IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = ANY (ARRAY['iam', 'planning', 'marketing', 'integration', 'workflow', 'audit'])
    ORDER BY schemaname, tablename
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS created_by uuid', target.schemaname, target.tablename);
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()', target.schemaname, target.tablename);
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()', target.schemaname, target.tablename);
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS audited_at timestamptz', target.schemaname, target.tablename);
    EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1', target.schemaname, target.tablename);
    EXECUTE format(
      'UPDATE %I.%I SET audited_at = COALESCE(audited_at, updated_at, created_at) WHERE audited_at IS NULL',
      target.schemaname,
      target.tablename
    );

    constraint_name := format('ck_%s_%s_version_positive', target.schemaname, target.tablename);
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = format('%I.%I', target.schemaname, target.tablename)::regclass
        AND conname = constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (version > 0)',
        target.schemaname,
        target.tablename,
        constraint_name
      );
    END IF;
  END LOOP;
END
$migration$;

COMMIT;
