import { MigrationInterface, QueryRunner } from "typeorm";

export class EquipmentPlannedStartupMinutes1722920043000 implements MigrationInterface {
  name = "EquipmentPlannedStartupMinutes1722920043000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE equipment_assets ADD COLUMN planned_startup_minutes integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE equipment_assets ADD CONSTRAINT ck_equipment_assets_planned_startup_minutes CHECK (planned_startup_minutes >= 0)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE equipment_assets DROP CONSTRAINT ck_equipment_assets_planned_startup_minutes`);
    await queryRunner.query(`ALTER TABLE equipment_assets DROP COLUMN planned_startup_minutes`);
  }
}
