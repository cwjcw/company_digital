import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatorUpdaterAuditFields1722920027000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $migration$
      DECLARE target record;
      BEGIN
        FOR target IN
          SELECT table_name
          FROM information_schema.columns
          WHERE table_schema='public' AND column_name='audited_at'
          ORDER BY table_name
        LOOP
          EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_by varchar DEFAULT ''system''', target.table_name);
          EXECUTE format('UPDATE public.%I SET updated_by=created_by::text WHERE created_by IS NOT NULL AND (updated_by IS NULL OR btrim(updated_by)='''')', target.table_name);
          EXECUTE format('ALTER TABLE public.%I DROP COLUMN audited_at', target.table_name);
        END LOOP;
      END
    $migration$`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $migration$
      DECLARE target record;
      BEGIN
        FOR target IN
          SELECT table_name
          FROM information_schema.columns
          WHERE table_schema='public' AND column_name='created_at'
          ORDER BY table_name
        LOOP
          EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS audited_at timestamptz', target.table_name);
        END LOOP;
      END
    $migration$`);
  }
}
