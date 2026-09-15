import { MigrationInterface, QueryRunner } from "typeorm";

export class RetireLegacyProductionPlanning1722920053000 implements MigrationInterface {
  name = "RetireLegacyProductionPlanning1722920053000";

  async up(queryRunner: QueryRunner): Promise<void> {
    const resources = "'on-hand-summary-dashboard','rolling-plan','monthly-plan','rolling-plan-table','division-order-review','weekly-plan','work-report'";
    await queryRunner.query(`DELETE FROM permissions WHERE resource IN (${resources})`);
    await queryRunner.query(`DELETE FROM roles WHERE permission_group_resource IN (${resources})`);
  }

  async down(): Promise<void> {
    // Retired permission records are intentionally not recreated without an explicit authorization design.
  }
}
