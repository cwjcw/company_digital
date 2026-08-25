import { MigrationInterface, QueryRunner } from "typeorm";

const tables = [
  "users", "role_groups", "roles", "user_roles", "permissions", "role_data_scopes", "role_organization_scopes",
  "organization_units", "contacts", "development_requests", "development_request_events", "approval_flow_configs",
  "plan_periods", "orders", "order_items", "outsourcing_details", "process_definitions", "item_process_progress",
  "daily_process_progress", "dictionary_types", "dictionary_values", "suppliers", "sales_orders",
  "finished_goods_inbound", "audit_logs", "api_keys", "refresh_tokens", "import_jobs", "import_job_errors", "idempotency_keys"
];

export class KdosSystemAuditFields1722920026000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of tables) {
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "created_by" uuid`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "audited_at" timestamptz`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1`);
      await queryRunner.query(`UPDATE "${table}" SET "audited_at"=COALESCE("audited_at","updated_at","created_at") WHERE "audited_at" IS NULL`);
      await queryRunner.query(`DO $constraint$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '"${table}"'::regclass AND conname = 'CK_${table}_version_positive'
        ) THEN
          ALTER TABLE "${table}" ADD CONSTRAINT "CK_${table}_version_positive" CHECK ("version" > 0);
        END IF;
      END $constraint$`);
    }
    await queryRunner.query(`UPDATE "audit_logs" SET "created_by"="actor_id" WHERE "created_by" IS NULL`);
    await queryRunner.query(`ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "copy" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "batch_print" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "batch_update" boolean NOT NULL DEFAULT false`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "permissions" DROP COLUMN IF EXISTS "batch_update"`);
    await queryRunner.query(`ALTER TABLE "permissions" DROP COLUMN IF EXISTS "batch_print"`);
    await queryRunner.query(`ALTER TABLE "permissions" DROP COLUMN IF EXISTS "copy"`);
    for (const table of [...tables].reverse()) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "CK_${table}_version_positive"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "version"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "audited_at"`);
      if (table !== "import_jobs") await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "created_by"`);
    }
  }
}
