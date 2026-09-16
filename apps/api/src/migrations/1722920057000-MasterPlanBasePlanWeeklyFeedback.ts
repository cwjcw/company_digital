import { MigrationInterface, QueryRunner } from "typeorm";

export class MasterPlanBasePlanWeeklyFeedback1722920057000 implements MigrationInterface {
  name = "MasterPlanBasePlanWeeklyFeedback1722920057000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE mps_reconciliation_outbox ADD COLUMN IF NOT EXISTS record_id uuid NULL`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_mps_reconciliation_record ON mps_reconciliation_outbox(tenant_id,resource,record_id,created_at DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_mps_reconciliation_record`);
    await queryRunner.query(`ALTER TABLE mps_reconciliation_outbox DROP COLUMN IF EXISTS record_id`);
  }
}
