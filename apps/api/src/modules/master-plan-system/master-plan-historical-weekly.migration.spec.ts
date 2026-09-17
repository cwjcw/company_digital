import { MasterPlanHistoricalWeeklyReviewDate1722920062000 } from "../../migrations/1722920062000-MasterPlanHistoricalWeeklyReviewDate";
import { MASTER_PLAN_RESOURCE_MAP, weeklyAdmissionMissingFields, weeklyAdmissionSql } from "./master-plan.config";

/**
 * KN-MPS-INIT-001：存储层允许历史周计划没有评审交期，但正常业务流程准入**不得**被放宽。
 * 该用例把“数据库可存历史 NULL” ≠ “正常业务允许缺评审交期进入周计划”锁定下来。
 */
describe("MasterPlanHistoricalWeeklyReviewDate1722920062000", () => {
  it("up：仅把 latest_review_due_date 改为 NULLABLE，并写明准入规则未放宽", async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new MasterPlanHistoricalWeeklyReviewDate1722920062000().up({ query } as never);
    const sql = query.mock.calls.map(([statement]) => String(statement)).join("\n");

    expect(sql).toContain("ALTER TABLE mps_weekly_plans ALTER COLUMN latest_review_due_date DROP NOT NULL");
    expect(sql).toContain("正常周计划准入仍强制要求该字段");
    /* 不得顺手放宽 base_plan_id / 其他约束。 */
    expect(sql).not.toContain("base_plan_id DROP NOT NULL");
    expect(sql).not.toContain("inspection_required");
  });

  it("down：存在 NULL 时明确失败，不制造假日期；全部有值时才能恢复 NOT NULL", async () => {
    const failing = jest.fn(async (statement: string) => statement.includes("count(*)::integer AS nulls") ? [{ nulls: 1169 }] : undefined);
    await expect(new MasterPlanHistoricalWeeklyReviewDate1722920062000().down({ query: failing } as never))
      .rejects.toThrow(/仍有 1169 条 latest_review_due_date IS NULL/);
    expect(failing.mock.calls.map(([statement]) => String(statement)).join("\n")).not.toContain("SET NOT NULL");

    const passing = jest.fn(async (statement: string) => statement.includes("count(*)::integer AS nulls") ? [{ nulls: 0 }] : undefined);
    await new MasterPlanHistoricalWeeklyReviewDate1722920062000().down({ query: passing } as never);
    const sql = passing.mock.calls.map(([statement]) => String(statement)).join("\n");
    expect(sql).toContain("SET NOT NULL");
  });

  it("正常周计划准入规则未被放宽：仍然强制要求 latestReviewDueDate", () => {
    const base = MASTER_PLAN_RESOURCE_MAP.get("mps-base-plans")!;
    /* 准入字段清单与 SQL 谓词都必须继续包含评审交期。 */
    expect(base.weeklyAdmissionRequiredFields).toEqual(["latestReviewDueDate", "productAttribute", "surfaceNature", "manufacturingMethod"]);
    const admission = weeklyAdmissionSql(base, "base");
    expect(admission).toContain("NULLIF(btrim(base.latest_review_due_date::text),'') IS NOT NULL");
    /* 缺评审交期的 base（哪怕其他字段齐全）仍然被判定为未满足准入。 */
    const missing = weeklyAdmissionMissingFields(base, {
      latestReviewDueDate: null, productAttribute: "五金", surfaceNature: "烤漆", manufacturingMethod: "自制"
    });
    expect(missing).toEqual(["latestReviewDueDate"]);
    /* 其他三个字段缺失同样继续阻挡准入。 */
    expect(weeklyAdmissionMissingFields(base, {
      latestReviewDueDate: "2026-09-30", productAttribute: null, surfaceNature: null, manufacturingMethod: null
    })).toEqual(["productAttribute", "surfaceNature", "manufacturingMethod"]);
  });
});
