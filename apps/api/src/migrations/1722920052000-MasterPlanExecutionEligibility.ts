import { MigrationInterface, QueryRunner } from "typeorm";

export class MasterPlanExecutionEligibility1722920052000 implements MigrationInterface {
  name = "MasterPlanExecutionEligibility1722920052000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mps_weekly_process_plans ADD COLUMN execution_enabled boolean NOT NULL DEFAULT true;
      ALTER TABLE mps_outsourcing_reports ADD COLUMN execution_enabled boolean NOT NULL DEFAULT true;

      UPDATE mps_weekly_process_plans process SET execution_enabled=(weekly.manufacturing_method IN ('自制','自制+外协'))
      FROM mps_weekly_plans weekly WHERE weekly.tenant_id=process.tenant_id AND weekly.id=process.weekly_plan_id;
      UPDATE mps_outsourcing_reports report SET execution_enabled=(weekly.manufacturing_method IN ('中心外购','外协','自制+外协'))
      FROM mps_weekly_plans weekly WHERE weekly.tenant_id=report.tenant_id AND weekly.id=report.weekly_plan_id;

      CREATE INDEX idx_mps_weekly_process_execution_enabled ON mps_weekly_process_plans(tenant_id,execution_enabled,due_date);
      CREATE INDEX idx_mps_outsourcing_execution_enabled ON mps_outsourcing_reports(tenant_id,execution_enabled,outsourcing_due_date);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_mps_outsourcing_execution_enabled;
      DROP INDEX IF EXISTS idx_mps_weekly_process_execution_enabled;
      ALTER TABLE mps_outsourcing_reports DROP COLUMN IF EXISTS execution_enabled;
      ALTER TABLE mps_weekly_process_plans DROP COLUMN IF EXISTS execution_enabled;
    `);
  }
}
