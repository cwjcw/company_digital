import type { MigrationInterface, QueryRunner } from "typeorm";

/** Standalone compatibility for the authorized historical ERP command on the retained
 * three-column monthly key. The pending allocation-source migration remains separate. */
export class MpsHistoricalUnknownAmount1722920111500 implements MigrationInterface {
  name = "MpsHistoricalUnknownAmount1722920111500";
  async up(r: QueryRunner): Promise<void> {
    await r.query("ALTER TABLE mps_group_plans ALTER COLUMN order_amount DROP NOT NULL");
  }
  async down(r: QueryRunner): Promise<void> {
    await r.query("LOCK TABLE mps_group_plans IN ACCESS EXCLUSIVE MODE");
    const [guard] = await r.query("SELECT EXISTS(SELECT 1 FROM mps_group_plans WHERE order_amount IS NULL) unsafe");
    if (guard.unsafe) throw new Error("存在未知金额的历史计划，不能制造金额或有损回退");
    await r.query("ALTER TABLE mps_group_plans ALTER COLUMN order_amount SET NOT NULL");
  }
}
