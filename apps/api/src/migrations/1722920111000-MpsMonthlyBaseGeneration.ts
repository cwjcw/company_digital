import type { MigrationInterface, QueryRunner } from "typeorm";

/** Pending base records may await a real customer due date. No source columns or backfill. */
export class MpsMonthlyBaseGeneration1722920111000 implements MigrationInterface {
  name = "MpsMonthlyBaseGeneration1722920111000";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query("ALTER TABLE mps_base_plans ALTER COLUMN latest_customer_due_date DROP NOT NULL");
    await runner.query(`UPDATE mps_sync_configs SET name='月度计划同步基础计划'
      WHERE sync_key='shipping-to-base' AND name='出货计划同步基础计划'`);
  }
  async down(runner: QueryRunner): Promise<void> {
    const [pending] = await runner.query("SELECT count(*)::integer count FROM mps_base_plans WHERE latest_customer_due_date IS NULL");
    if (Number(pending.count)>0) throw new Error("存在待完善客户交期的基础计划，不能回退非空约束；请保留数据并前向修复");
    await runner.query("ALTER TABLE mps_base_plans ALTER COLUMN latest_customer_due_date SET NOT NULL");
    await runner.query(`UPDATE mps_sync_configs SET name='出货计划同步基础计划'
      WHERE sync_key='shipping-to-base' AND name='月度计划同步基础计划'`);
  }
}
