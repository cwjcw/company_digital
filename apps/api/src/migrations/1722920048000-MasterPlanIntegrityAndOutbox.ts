import { MigrationInterface, QueryRunner } from "typeorm";

const systemUserId = "0199e000-0000-7000-8000-000000000001";

export class MasterPlanIntegrityAndOutbox1722920048000 implements MigrationInterface {
  name = "MasterPlanIntegrityAndOutbox1722920048000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO users(id,username,display_name,password_hash,enabled,must_change_password,created_by,updated_by)
      VALUES ('${systemUserId}','__kdos_system__','KDOS系统任务','!',false,false,'${systemUserId}','${systemUserId}')
      ON CONFLICT(username) DO NOTHING;
    `);

    const tables = [
      "mps_erp_order_lines", "mps_customer_division_mappings", "mps_order_allocations", "mps_group_plans",
      "mps_monthly_plans", "mps_shipping_plans", "mps_base_plans", "mps_weekly_plans", "mps_process_cycles",
      "mps_weekly_process_plans", "mps_technical_reports", "mps_material_reports", "mps_outsourcing_reports",
      "mps_process_reports", "mps_sync_configs", "mps_sync_logs", "mps_data_exceptions", "mps_system_settings"
    ];
    for (const table of tables) {
      await queryRunner.query(`UPDATE ${table} SET created_by=COALESCE(created_by,'${systemUserId}'::uuid)`);
      await queryRunner.query(`UPDATE ${table} SET updated_by=CASE WHEN updated_by ~* '^[0-9a-f-]{36}$' THEN updated_by ELSE COALESCE(created_by,'${systemUserId}'::uuid)::text END`);
      await queryRunner.query(`ALTER TABLE ${table} ALTER COLUMN created_by SET NOT NULL`);
      await queryRunner.query(`ALTER TABLE ${table} ALTER COLUMN updated_by DROP DEFAULT`);
      await queryRunner.query(`ALTER TABLE ${table} ALTER COLUMN updated_by TYPE uuid USING updated_by::uuid`);
      await queryRunner.query(`ALTER TABLE ${table} ALTER COLUMN updated_by SET DEFAULT '${systemUserId}'::uuid`);
      await queryRunner.query(`ALTER TABLE ${table} ADD CONSTRAINT fk_${table}_updated_by FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE RESTRICT`);
    }

    await queryRunner.query(`
      ALTER TABLE mps_monthly_plans
      ADD CONSTRAINT fk_mps_monthly_allocation_business
      FOREIGN KEY(tenant_id,order_number,item_code)
      REFERENCES mps_order_allocations(tenant_id,order_number,item_code)
      ON UPDATE CASCADE ON DELETE RESTRICT;

      CREATE TABLE mps_reconciliation_outbox (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        resource varchar(128) NOT NULL, sync_key varchar(128) NOT NULL,
        idempotency_key varchar(255) NOT NULL, actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        actor_name varchar(255) NOT NULL, status varchar(16) NOT NULL DEFAULT 'PENDING',
        attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
        last_error text, completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_reconciliation_outbox UNIQUE(tenant_id,idempotency_key),
        CONSTRAINT ck_mps_reconciliation_status CHECK(status IN ('PENDING','RUNNING','SUCCESS','FAILED')),
        CONSTRAINT ck_mps_reconciliation_attempts CHECK(attempts>=0),
        CONSTRAINT ck_mps_reconciliation_version CHECK(version>0)
      );
      CREATE INDEX idx_mps_reconciliation_due ON mps_reconciliation_outbox(status,next_attempt_at,created_at);
      ALTER TABLE mps_reconciliation_outbox ENABLE ROW LEVEL SECURITY;
      CREATE POLICY mps_reconciliation_outbox_tenant_policy ON mps_reconciliation_outbox
        USING (tenant_id=current_setting('app.tenant_id',true))
        WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS mps_reconciliation_outbox`);
    await queryRunner.query(`ALTER TABLE mps_monthly_plans DROP CONSTRAINT IF EXISTS fk_mps_monthly_allocation_business`);
    const tables = [
      "mps_erp_order_lines", "mps_customer_division_mappings", "mps_order_allocations", "mps_group_plans",
      "mps_monthly_plans", "mps_shipping_plans", "mps_base_plans", "mps_weekly_plans", "mps_process_cycles",
      "mps_weekly_process_plans", "mps_technical_reports", "mps_material_reports", "mps_outsourcing_reports",
      "mps_process_reports", "mps_sync_configs", "mps_sync_logs", "mps_data_exceptions", "mps_system_settings"
    ];
    for (const table of tables) {
      await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS fk_${table}_updated_by`);
      await queryRunner.query(`ALTER TABLE ${table} ALTER COLUMN updated_by TYPE varchar USING updated_by::text`);
      await queryRunner.query(`ALTER TABLE ${table} ALTER COLUMN updated_by SET DEFAULT 'system'`);
      await queryRunner.query(`ALTER TABLE ${table} ALTER COLUMN created_by DROP NOT NULL`);
    }
  }
}
