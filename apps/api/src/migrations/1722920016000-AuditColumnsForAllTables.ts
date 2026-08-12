import { MigrationInterface, QueryRunner } from "typeorm";

const tables = [
  "users", "roles", "user_roles", "permissions", "role_data_scopes", "role_organization_scopes",
  "organization_units", "contacts", "plan_periods", "orders", "order_items", "outsourcing_details",
  "process_definitions", "item_process_progress", "dictionary_types", "dictionary_values", "suppliers",
  "sales_orders", "finished_goods_inbound", "audit_logs", "api_keys", "refresh_tokens", "import_jobs",
  "import_job_errors", "idempotency_keys"
];

const tablesWithCreatedAt = new Set([
  "plan_periods", "orders", "order_items", "sales_orders", "finished_goods_inbound",
  "audit_logs", "refresh_tokens", "import_jobs", "idempotency_keys"
]);
const tablesWithUpdatedAt = new Set(["orders", "order_items", "sales_orders", "finished_goods_inbound"]);

export class AuditColumnsForAllTables1722920016000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of tables) {
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "created_at" timestamptz NOT NULL DEFAULT now()`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now()`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "updated_by" varchar NOT NULL DEFAULT 'system'`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [...tables].reverse()) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "updated_by"`);
      if (!tablesWithUpdatedAt.has(table)) await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "updated_at"`);
      if (!tablesWithCreatedAt.has(table)) await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "created_at"`);
    }
  }
}
