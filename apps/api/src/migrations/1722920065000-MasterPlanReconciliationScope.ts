import { MigrationInterface, QueryRunner } from "typeorm";

/** KN-MPS-PERF-REPORT-001：对账事件保留稳定影响范围，报工删除后仍可精确重新汇总对应周计划工序。 */
export class MasterPlanReconciliationScope1722920065000 implements MigrationInterface {
  name = "MasterPlanReconciliationScope1722920065000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE mps_reconciliation_outbox ADD COLUMN IF NOT EXISTS scope_json jsonb NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE mps_reconciliation_outbox DROP COLUMN IF EXISTS scope_json`);
  }
}
