import { MASTER_PLAN_RESOURCE_MAP, virtualColumns, fieldsFor, dispatchedWeeklyQuantitySql } from "./master-plan.config";
import { tableSupportFieldsFor } from "@kdos/contracts";
import { standardProcesses } from "@tracker/shared";

/**
 * KN-MPS-EXEC-001 / KN-MPS-UI-001：工序生产进度与统一异常的 SQL 语义契约。
 * - 周计划进度 = SUM(实际报工) / weekly.planned_quantity；月计划进度 = SUM(全部关联周计划实际报工) / monthly.required_quantity；
 * - 主表只显示管理字段：辅助计算字段（累计报工/报工次数/每工序已下达数量）不得成为业务字段；
 * - 异常唯一来源是人工报工事实表，系统提示（weekly_process_plans.exception_text / data_exceptions）绝不进入异常。
 */
const weekly = MASTER_PLAN_RESOURCE_MAP.get("mps-weekly-plans")!;
const monthly = MASTER_PLAN_RESOURCE_MAP.get("mps-monthly-plans")!;
const weeklyColumns = virtualColumns(weekly);
const monthlyColumns = virtualColumns(monthly);

describe("KN-MPS-EXEC-001 生产进度 SQL", () => {
  it("每个标准工序都有生产进度虚拟列（10 个工序，顺序来自 canonical registry）", () => {
    expect(standardProcesses).toHaveLength(10);
    for (const process of standardProcesses) {
      expect(weeklyColumns[`${process.code}ProductionProgress`]).toBeTruthy();
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

  it("月计划进度 = 整个订单/月度总需求完成率：SUM(actual)/record.required_quantity，禁止平均百分比", () => {
    const sql = String(monthlyColumns.cuttingProductionProgress);
    /* 分子：先按 tenant+weekly_plan_id+process_code 聚合并 SUM（两层聚合，防一对多 JOIN 放大）。 */
    expect(sql).toContain("GROUP BY report.tenant_id,report.weekly_plan_id");
    expect(sql).toContain("sum(per_week.reported)");
    /* 分母：月计划正式总需求 required_quantity（整个订单/月度总需求），不是已下达周计划数量。 */
    expect(sql).toContain("record.required_quantity");
    expect(sql).toContain("COALESCE(record.required_quantity,0) > 0");
    expect(sql).not.toMatch(/avg\(/i);
  });

  it("永久锁定：月计划进度分母绝不能是 SUM(weekly.planned_quantity)（已下达周计划数量）", () => {
    /* 若有人把分母改回“已下达周计划数量”，本用例立即失败：
       样例 required=500、两个 weekly planned 合计 300 且全部报满 300 → 正确 60%，错误实现会显示 100%。 */
    for (const code of ["cutting", "machining", "packaging"]) {
      const progressSql = String(monthlyColumns[`${code}ProductionProgress`]);
      expect(progressSql).not.toContain("planned_quantity");
      expect(progressSql).not.toContain("sum(weekly.planned_quantity)");
      expect(progressSql).toContain("record.required_quantity");
    }
  });

  it("防 JOIN 重复累计：进度不使用 mps_weekly_process_plans 与报工同层 JOIN 求和", () => {
    for (const code of ["cutting", "blank", "packaging"]) {
      const weeklySql = String(weeklyColumns[`${code}ProductionProgress`]);
      const monthlySql = String(monthlyColumns[`${code}ProductionProgress`]);
      expect(weeklySql.match(/mps_weekly_process_plans/g) ?? []).toHaveLength(0);
      expect((monthlySql.match(/mps_weekly_process_plans/g) ?? []).length).toBe(0);
    }
  });
});

describe("KN-MPS-UI-001 辅助计算字段与月计划唯一已下达数量", () => {
  it("主表只显示管理字段：累计报工/报工次数/每工序已下达数量都不是业务字段", () => {
    for (const [label, resource] of [["周计划", weekly], ["月计划", monthly]] as const) {
      const keys = fieldsFor(resource).map((field) => field.key);
      expect(`${label}:${keys.some((key) => key.endsWith("ReportCount"))}`).toBe(`${label}:false`);
      expect(`${label}:${keys.some((key) => key.endsWith("ReportedQuantity"))}`).toBe(`${label}:false`);
      expect(`${label}:${keys.some((key) => key.endsWith("DispatchedQuantity"))}`).toBe(`${label}:false`);
      /* 每工序只有 周期 / 交期 / 状态 / 生产进度。 */
      for (const process of standardProcesses) {
        const expected = ["CycleDays", "DueDate", "Status", "ProductionProgress"].map((suffix) => `${process.code}${suffix}`);
        expect(expected.every((key) => keys.includes(key))).toBe(true);
        expect(keys.includes(`${process.code}Exception`)).toBe(false);
      }
      /* 累计报工登记为辅助计算字段（仅供 Tooltip），并有对应的行投影 SQL。 */
      expect(tableSupportFieldsFor(resource.code).map((field) => field.key)).toEqual(standardProcesses.map((process) => `${process.code}ReportedQuantity`));
      for (const process of standardProcesses) expect(String(virtualColumns(resource)[`${process.code}ReportedQuantity`])).toContain("sum(report.production_quantity)");
    }
  });

  it("月计划只有一个「已下达周计划数量」，与工序无关且不参与生产进度分母", () => {
    const monthlyKeys = fieldsFor(monthly).map((field) => field.key);
    expect(monthlyKeys.filter((key) => key === "dispatchedWeeklyQuantity")).toHaveLength(1);
    expect(monthlyKeys.filter((key) => key.endsWith("DispatchedQuantity"))).toHaveLength(0);
    const field = fieldsFor(monthly).find((item) => item.key === "dispatchedWeeklyQuantity")!;
    expect(field).toMatchObject({ label: "已下达周计划数量", type: "number", editable: false, format: "decimal" });
    /* 周计划没有该字段。 */
    expect(fieldsFor(weekly).some((item) => item.key === "dispatchedWeeklyQuantity")).toBe(false);
    /* SQL 只算一次：SUM(关联 weekly.planned_quantity)，且绝不出现在任何 ProductionProgress 中。 */
    expect(String(monthlyColumns.dispatchedWeeklyQuantity)).toBe(dispatchedWeeklyQuantitySql);
    expect(String(monthlyColumns.dispatchedWeeklyQuantity)).toContain("sum(weekly.planned_quantity)");
    for (const process of standardProcesses) {
      expect(String(monthlyColumns[`${process.code}ProductionProgress`])).not.toContain("sum(weekly.planned_quantity)");
      expect(monthlyColumns[`${process.code}DispatchedQuantity`]).toBeUndefined();
      expect(weeklyColumns[`${process.code}DispatchedQuantity`]).toBeUndefined();
    }
  });

  it("报工次数彻底删除：没有任何 *ReportCount 虚拟列或元数据字段", () => {
    for (const resource of [weekly, monthly]) {
      expect(Object.keys(virtualColumns(resource)).filter((key) => key.endsWith("ReportCount"))).toEqual([]);
      expect(fieldsFor(resource).map((field) => field.key).filter((key) => key.endsWith("ReportCount"))).toEqual([]);
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

describe("KN-MPS-UI-001 统一异常只来自人工报工事实", () => {
  it("周/月计划异常只读报工表：技术 / 五金主材 / 木作主材 / 外协 / 10 工序，顺序稳定且带来源标签", () => {
    for (const [label, columns] of [["周计划", weeklyColumns], ["月计划", monthlyColumns]] as const) {
      const sql = String(columns.exceptionSummary);
      expect(sql.startsWith("(")).toBe(true);
      for (const source of ["技术：", "五金主材：", "木作主材：", "外协："]) expect(`${label}${sql.includes(source) ? "has" : "missing"}${source}`).toContain("has");
      const labeled = standardProcesses.map((process) => `${process.name}：`);
      for (const source of labeled) expect(`${label}${sql.includes(source) ? "has" : "missing"}${source}`).toContain("has");
      expect(labeled.map((value) => sql.indexOf(value))).toEqual([...labeled.map((value) => sql.indexOf(value))].sort((left, right) => left - right));
      /* 去重：每个来源内部使用 DISTINCT 聚合。 */
      expect(sql).toContain("string_agg(DISTINCT");
      expect(sql).toContain("concat_ws('；'");
      /* 正式报工事实来源。 */
      for (const table of ["mps_technical_reports", "mps_material_reports", "mps_outsourcing_reports", "mps_process_reports"]) expect(sql).toContain(table);
    }
  });

  it("永久锁定：工序异常来源只能是 mps_process_reports.exception_text，weekly_process_plans 绝不参与", () => {
    for (const [label, columns] of [["周计划", weeklyColumns], ["月计划", monthlyColumns]] as const) {
      const sql = String(columns.exceptionSummary);
      expect(`${label}:${sql.includes("mps_weekly_process_plans")}`).toBe(`${label}:false`);
      expect(`${label}:${sql.includes("process.exception_text")}`).toBe(`${label}:false`);
      expect(`${label}:${sql.includes("report.exception_text")}`).toBe(`${label}:true`);
      for (const process of standardProcesses) expect(`${label}:${sql.includes(`report.process_code='${process.code}'`)}`).toBe(`${label}:true`);
    }
  });

  it("永久锁定：系统提示文本（未维护周期/缺失配置等）绝不进入异常汇总", () => {
    for (const columns of [weeklyColumns, monthlyColumns]) {
      const sql = String(columns.exceptionSummary);
      for (const forbidden of ["未维护", "未配置", "缺少", "缺失", "同步失败", "mps_data_exceptions"]) expect(sql).not.toContain(forbidden);
    }
  });

  it("异常列只有一个正式字段 exceptionSummary，且每工序不再有异常列", () => {
    for (const resource of [weekly, monthly]) {
      const keys = fieldsFor(resource).map((field) => field.key);
      expect(keys.filter((key) => key === "exceptionSummary")).toHaveLength(1);
      expect(fieldsFor(resource).find((field) => field.key === "exceptionSummary")?.type).toBe("text");
      expect(keys.filter((key) => key.endsWith("Exception"))).toEqual([]);
      /* 辅助异常字段（技术/五金/木作/外协）也不再是业务字段。 */
      for (const key of ["technicalException", "hardwareException", "woodException", "outsourcingException"]) expect(keys).not.toContain(key);
    }
  });
});
