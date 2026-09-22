import { MigrationInterface, QueryRunner } from "typeorm";

export class EquipmentStatusPlannedRuntimeMinutes1722920066000 implements MigrationInterface {
  name = "EquipmentStatusPlannedRuntimeMinutes1722920066000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE equipment_status_reports ADD COLUMN planned_runtime_minutes integer NULL`);
    await queryRunner.query(`ALTER TABLE equipment_status_reports ADD CONSTRAINT ck_equipment_status_planned_runtime CHECK (planned_runtime_minutes IS NULL OR planned_runtime_minutes > 0)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE equipment_status_reports DROP CONSTRAINT ck_equipment_status_planned_runtime`);
    await queryRunner.query(`ALTER TABLE equipment_status_reports DROP COLUMN planned_runtime_minutes`);
  }
}
