import { MigrationInterface, QueryRunner } from "typeorm";

export class EquipmentMonitoringDefaultFalse1722920042000 implements MigrationInterface {
  name = "EquipmentMonitoringDefaultFalse1722920042000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE equipment_assets ALTER COLUMN monitored SET DEFAULT false`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE equipment_assets ALTER COLUMN monitored SET DEFAULT true`);
  }
}
