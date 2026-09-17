import { MASTER_PLAN_RESOURCE_MAP, virtualColumns, fieldsFor } from "./master-plan.config";
import { standardProcesses } from "@tracker/shared";

/**
 * KN-MPS-EXEC-001：工序生产进度与统一异常的 SQL 语义契约。
 * 关键不变量：累计报工来自 mps_process_reports 的 SUM（不是最后一条/MAX/AVG/条数）；
 * 月计划按需求加权（SUM(actual)/SUM(demand)）且用两层聚合防止 JOIN 重复累计；异常带来源标签并去重。
 */
const weekly = MASTER_PLAN_RESOURCE_MAP.get("mps-weekly-plans")!;
const monthly = MASTER_PLAN_RESOURCE_MAP.get("mps-monthly-plans")!;
const weeklyColumns = virtualColumns(weekly);
const monthlyColumns = virtualColumns(monthly);

describe("KN-MPS-EXEC-001 生产进度 SQL", () => {
  it("每个标准工序都有生产进度/累计报工/报工次数虚拟列（10 个工序，顺序来自 canonical registry）", () => {
    expect(standardProcesses).toHaveLength(10);
    for (const process of standardProcesses) {
      expect(weeklyColumns[`${process.code}ProductionProgress`]).toBeTruthy();
      expect(weeklyColumns[`${process.code}ReportedQuantity`]).toBeTruthy();
      expect(weeklyColumns[`${process.code}ReportCount`]).toBeTruthy();
      expect(monthlyColumns[`${process.code}ProductionProgress`]).toBeTruthy();
      /* 定性状态字段必须继续存在（不能被进度替代）。 */
      expect(fieldsFor(weekly).some((field) => field.key === `${process.code}Status`)).toBe(true);
      expect(fieldsFor(monthly).some((field) => field.key === `${process.code}Status`)).toBe(true);
    }
  });

  it("周计划进度 = SUM(实际报工) / 正式工序需求，且不使用 MAX/AVG/条数", () => {
    const sql = String(weeklyColumns.cuttingProductionProgress);
    expect(sql).toContain("sum(report.production_quantity)");
    expect(sql).toContain("report.weekly_plan_id=record.id");
    expect(sql).toContain("report.process_code='cutting'");
    expect(sql).toContain("record.planned_quantity");
    expect(sql).not.toMatch(/\bmax\(|\bavg\(/i);
    /* 需求为 0/NULL 时返回 NULL（界面显示 —），不产生除零。 */
    expect(sql).toContain("CASE WHEN COALESCE(record.planned_quantity,0) > 0");
  });

  it("月计划按需求加权：SUM(actual)/SUM(demand)，禁止平均百分比", () => {
    const sql = String(monthlyColumns.cuttingProductionProgress);
    /* 分子：先按 tenant+weekly_plan_id+process_code 聚合并 SUM（两层聚合，防一对多 JOIN 放大）。 */
    expect(sql).toContain("GROUP BY report.tenant_id,report.weekly_plan_id");
    expect(sql).toContain("sum(per_week.reported)");
    /* 分母：当前月计划范围内所有关联周计划的需求数量之和。 */
    expect(sql).toContain("sum(weekly.planned_quantity)");
    expect(sql).not.toMatch(/avg\(/i);
  });

  it("防 JOIN 重复累计：进度不使用 mps_weekly_process_plans 与报工同层 JOIN 求和", () => {
    for (const code of ["cutting", "blank", "packaging"]) {
      const weeklySql = String(weeklyColumns[`${code}ProductionProgress`]);
      const monthlySql = String(monthlyColumns[`${code}ProductionProgress`]);
      /* 周计划：报工聚合子查询内部不再 JOIN 工序计划表（否则一次报工被工序计划条数放大）。 */
      expect(weeklySql.match(/mps_weekly_process_plans/g) ?? []).toHaveLength(0);
      /* 月计划：报工聚合子查询内部只 JOIN 周计划（weekly_plan_id 一对一），不 JOIN 工序计划。 */
      expect((monthlySql.match(/mps_weekly_process_plans/g) ?? []).length).toBe(0);
    }
  });

  it("统一异常：包含全部正式来源与来源标签，按来源+文本去重且顺序稳定", () => {
    for (const [label, columns] of [["周计划", weeklyColumns], ["月计划", monthlyColumns]] as const) {
      const sql = String(columns.exceptionSummary);
      expect(`${label}:${sql ? "ok" : "missing"}`).toBe(`${label}:ok`);
      /* 辅助异常来源 */
      for (const source of ["技术：", "五金主材：", "木作主材：", "外协："]) expect(`${label}${sql.includes(source) ? "has" : "missing"}`).toContain("has");
      /* 10 个标准工序异常（带工序中文名标签，顺序按 canonical registry） */
      const labeled = standardProcesses.map((process) => `${process.name}：`);
      for (const source of labeled) expect(`${label}${sql.includes(source) ? "has" : "missing"}${source}`).toContain("has");
      expect(labeled.map((value) => sql.indexOf(value))).toEqual([...labeled.map((value) => sql.indexOf(value))].sort((left, right) => left - right));
      /* 去重：每个来源内部使用 DISTINCT 聚合。 */
      expect(sql).toContain("string_agg(DISTINCT");
      expect(sql).toContain("concat_ws('；'");
    }
  });

  it("异常列只有一个正式字段 exceptionSummary（每工序 Exception 仅保留为内部兼容）", () => {
    for (const resource of [weekly, monthly]) {
      const keys = fieldsFor(resource).map((field) => field.key);
      expect(keys.filter((key) => key === "exceptionSummary")).toHaveLength(1);
      expect(fieldsFor(resource).find((field) => field.key === "exceptionSummary")?.type).toBe("text");
    }
  });

  it("生产进度 metadata 为只读 percentage 字段（10 个工序 × 2 张表）", () => {
    for (const resource of [weekly, monthly]) {
      const progressFields = fieldsFor(resource).filter((field) => field.key.endsWith("ProductionProgress"));
      expect(progressFields).toHaveLength(10);
      for (const field of progressFields) {
        expect(field.type).toBe("number");
        expect(field.format).toBe("percentage");
        expect(field.editable).toBe(false);
        expect(field.label).toMatch(/·生产进度$/);
      }
    }
  });
});
