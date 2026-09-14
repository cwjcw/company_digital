import { MigrationInterface, QueryRunner } from "typeorm";

export class MasterPlanManualCreationAndDailyReporting1722920050000 implements MigrationInterface {
  name = "MasterPlanManualCreationAndDailyReporting1722920050000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mps_base_plans ALTER COLUMN shipping_plan_id DROP NOT NULL;
      ALTER TABLE mps_weekly_plans ALTER COLUMN base_plan_id DROP NOT NULL;

      ALTER TABLE mps_base_plans DROP CONSTRAINT IF EXISTS ck_mps_base_admission;
      ALTER TABLE mps_base_plans DROP COLUMN IF EXISTS admission_status;
      ALTER TABLE mps_base_plans DROP COLUMN IF EXISTS admission_message;
      DELETE FROM mps_system_settings WHERE setting_key='base_plan_require_sketch';

      ALTER TABLE mps_weekly_plans DROP COLUMN IF EXISTS planned_page_count;

      ALTER TABLE mps_weekly_process_plans RENAME COLUMN reported_quantity TO daily_reported_quantity;
      ALTER TABLE mps_weekly_process_plans ADD COLUMN report_date date NOT NULL
        DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date);
      UPDATE mps_weekly_process_plans process
      SET daily_reported_quantity=COALESCE((
        SELECT sum(report.production_quantity)
        FROM mps_process_reports report
        WHERE report.tenant_id=process.tenant_id
          AND report.weekly_plan_id=process.weekly_plan_id
          AND report.process_code=process.process_code
          AND report.production_date=process.report_date
      ),0);
      ALTER TABLE mps_weekly_process_plans ADD CONSTRAINT ck_mps_weekly_process_daily_reported
        CHECK(daily_reported_quantity>=0);
      CREATE INDEX idx_mps_weekly_process_report_date
        ON mps_weekly_process_plans(tenant_id,report_date DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_mps_weekly_process_report_date;
      ALTER TABLE mps_weekly_process_plans DROP CONSTRAINT IF EXISTS ck_mps_weekly_process_daily_reported;
      ALTER TABLE mps_weekly_process_plans DROP COLUMN IF EXISTS report_date;
      ALTER TABLE mps_weekly_process_plans RENAME COLUMN daily_reported_quantity TO reported_quantity;

      ALTER TABLE mps_weekly_plans ADD COLUMN planned_page_count integer;
      ALTER TABLE mps_base_plans ADD COLUMN admission_status varchar(32) NOT NULL DEFAULT 'INCOMPLETE';
      ALTER TABLE mps_base_plans ADD COLUMN admission_message text;
      ALTER TABLE mps_base_plans ADD CONSTRAINT ck_mps_base_admission
        CHECK(admission_status IN ('INCOMPLETE','READY','SYNCED'));
    `);
  }
}
