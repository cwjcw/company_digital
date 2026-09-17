import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * KN-MPS-INIT-001：允许历史/迁移周计划在没有评审交期的情况下入库。
 *
 * 背景：一次性历史初始化（事业四部）中，源数据没有可靠的「最迟评审交期」，用户正式确认保持 NULL，
 * 不允许用初始化日期、客户交期、装柜日期或其他推算日期填充。
 *
 * 重要语义边界（本 migration **只放宽存储层**）：
 * - 数据库允许历史记录 `latest_review_due_date IS NULL`；
 * - 正常业务流程（基础计划的周计划准入 `weeklyAdmissionRequiredFields` / `weeklyAdmissionSql`）**完全不变**，
 *   缺评审交期的基础计划仍然不能进入周计划；本次没有、也不允许放宽 base-to-weekly admission。
 */
export class MasterPlanHistoricalWeeklyReviewDate1722920062000 implements MigrationInterface {
  name = "MasterPlanHistoricalWeeklyReviewDate1722920062000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE mps_weekly_plans ALTER COLUMN latest_review_due_date DROP NOT NULL`);
    await queryRunner.query(`COMMENT ON COLUMN mps_weekly_plans.latest_review_due_date IS 'KN-MPS-INIT-001：允许历史初始化为 NULL；正常周计划准入仍强制要求该字段（base-to-weekly weeklyAdmissionRequiredFields 不因本 migration 放宽）'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    /* 恢复 NOT NULL 前必须安全检查：存在 NULL 时明确失败，绝不静默造假日期。 */
    const [{ nulls }] = await queryRunner.query(`SELECT count(*)::integer AS nulls FROM mps_weekly_plans WHERE latest_review_due_date IS NULL`);
    if (Number(nulls) > 0) {
      throw new Error(`无法回滚：mps_weekly_plans 仍有 ${nulls} 条 latest_review_due_date IS NULL 的记录（历史初始化数据）。请先补齐评审交期或确认删除，migration 不会用假日期填充。`);
    }
    await queryRunner.query(`ALTER TABLE mps_weekly_plans ALTER COLUMN latest_review_due_date SET NOT NULL`);
  }
}
