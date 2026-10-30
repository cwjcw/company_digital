import type { MigrationInterface, QueryRunner } from "typeorm";

/** Preserve every plan ID and all calendar dates; current monthly model has no month column. */
export class MpsAllocationPlanSource1722920112000 implements MigrationInterface {
  name = "MpsAllocationPlanSource1722920112000";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE mps_monthly_plans DROP CONSTRAINT uq_mps_monthly_plan;
      ALTER TABLE mps_monthly_plans ADD CONSTRAINT uq_mps_monthly_plan
        UNIQUE NULLS NOT DISTINCT(tenant_id,order_number,item_code,division_id);
      ALTER TABLE mps_group_plans ALTER COLUMN order_amount DROP NOT NULL`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query("LOCK TABLE mps_monthly_plans,mps_group_plans IN ACCESS EXCLUSIVE MODE");
    const [guard] = await runner.query(`SELECT EXISTS(SELECT 1 FROM mps_monthly_plans
      GROUP BY tenant_id,order_number,item_code HAVING count(*)>1)
      OR EXISTS(SELECT 1 FROM mps_group_plans WHERE order_amount IS NULL) unsafe`);
    if (guard.unsafe) throw new Error("跨事业部计划或未知金额已生效，禁止有损回退；保留数据并前向修复");
    await runner.query(`ALTER TABLE mps_monthly_plans DROP CONSTRAINT uq_mps_monthly_plan;
      ALTER TABLE mps_monthly_plans ADD CONSTRAINT uq_mps_monthly_plan UNIQUE(tenant_id,order_number,item_code);
      ALTER TABLE mps_group_plans ALTER COLUMN order_amount SET NOT NULL`);
  }
}
