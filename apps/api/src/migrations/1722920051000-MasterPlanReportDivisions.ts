import { MigrationInterface, QueryRunner } from "typeorm";

export class MasterPlanReportDivisions1722920051000 implements MigrationInterface {
  name = "MasterPlanReportDivisions1722920051000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mps_technical_reports ADD COLUMN division_id uuid REFERENCES organization_units(id) ON DELETE RESTRICT;
      ALTER TABLE mps_material_reports ADD COLUMN division_id uuid REFERENCES organization_units(id) ON DELETE RESTRICT;
      ALTER TABLE mps_outsourcing_reports ADD COLUMN division_id uuid REFERENCES organization_units(id) ON DELETE RESTRICT;
      ALTER TABLE mps_process_reports ADD COLUMN division_id uuid REFERENCES organization_units(id) ON DELETE RESTRICT;

      UPDATE mps_technical_reports report SET division_id=weekly.division_id
      FROM mps_weekly_plans weekly WHERE weekly.tenant_id=report.tenant_id AND weekly.id=report.weekly_plan_id;
      UPDATE mps_material_reports report SET division_id=weekly.division_id
      FROM mps_weekly_plans weekly WHERE weekly.tenant_id=report.tenant_id AND weekly.id=report.weekly_plan_id;
      UPDATE mps_outsourcing_reports report SET division_id=weekly.division_id
      FROM mps_weekly_plans weekly WHERE weekly.tenant_id=report.tenant_id AND weekly.id=report.weekly_plan_id;
      UPDATE mps_process_reports report SET division_id=weekly.division_id
      FROM mps_weekly_plans weekly WHERE weekly.tenant_id=report.tenant_id AND weekly.id=report.weekly_plan_id;

      CREATE INDEX idx_mps_technical_reports_division ON mps_technical_reports(tenant_id,division_id);
      CREATE INDEX idx_mps_material_reports_division ON mps_material_reports(tenant_id,division_id);
      CREATE INDEX idx_mps_outsourcing_reports_division ON mps_outsourcing_reports(tenant_id,division_id);
      CREATE INDEX idx_mps_process_reports_division ON mps_process_reports(tenant_id,division_id);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_mps_process_reports_division;
      DROP INDEX IF EXISTS idx_mps_outsourcing_reports_division;
      DROP INDEX IF EXISTS idx_mps_material_reports_division;
      DROP INDEX IF EXISTS idx_mps_technical_reports_division;
      ALTER TABLE mps_process_reports DROP COLUMN IF EXISTS division_id;
      ALTER TABLE mps_outsourcing_reports DROP COLUMN IF EXISTS division_id;
      ALTER TABLE mps_material_reports DROP COLUMN IF EXISTS division_id;
      ALTER TABLE mps_technical_reports DROP COLUMN IF EXISTS division_id;
    `);
  }
}
