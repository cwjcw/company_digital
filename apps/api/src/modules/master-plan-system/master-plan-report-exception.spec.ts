import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanSyncService } from "./master-plan.sync.service";
import { MASTER_PLAN_RESOURCE_MAP, virtualColumns } from "./master-plan.config";
import { standardProcesses } from "@tracker/shared";

/**
 * KN-MPS-UI-001：异常是「人工报工事实」。
 * - 唯一来源是报工表 exception_text（技术/主材/外协/工序报工）；
 * - 系统提示、计划配置缺失、数据质量异常绝不能进入周/月计划统一异常；
 * - 异常绑定到每一次报工，多次报工按 来源+文本 去重合并。
 */
const actor = {
  tenantId: "KAINAN", userId: "11111111-1111-4111-8111-111111111111", username: "tester",
  permissions: ["*"], isSystemAdmin: true, moduleAdminCodes: [], tableDataScopes: [], requestId: "request-exception", source: "web" as const
};
const weeklyColumns = virtualColumns(MASTER_PLAN_RESOURCE_MAP.get("mps-weekly-plans")!);
const monthlyColumns = virtualColumns(MASTER_PLAN_RESOURCE_MAP.get("mps-monthly-plans")!);
const weeklyPlanIdForRollup = "33333333-3333-4333-8333-333333333333";

describe("KN-MPS-UI-001 统一异常只来自人工报工事实", () => {
  it("无人工异常时汇总为空：工序周期缺失（weekly_process_plans 提示）不会产生异常", () => {
    for (const columns of [weeklyColumns, monthlyColumns]) {
      const sql = String(columns.exceptionSummary);
      /* 工序任务表（系统“未维护工序周期”提示写在这里）完全不在异常来源里。 */
      expect(sql).not.toContain("mps_weekly_process_plans");
      /* 只有空值/空白的报工异常被排除，才能做到“没人填就没有异常”。 */
      expect(sql.split("btrim(COALESCE(report.exception_text,''))<>''").length - 1).toBeGreaterThanOrEqual(14);
      expect(sql).not.toContain("未维护");
    }
  });

  it("同一工序多次报工的人工异常按 来源+文本 去重合并（焊接：夹具异常、焊缝开裂）", () => {
    for (const columns of [weeklyColumns, monthlyColumns]) {
      const sql = String(columns.exceptionSummary);
      /* 每条来源用 DISTINCT 聚合、同工序多条用「、」连接、来源之间用「；」连接。 */
      expect(sql).toContain("string_agg(DISTINCT report.exception_text,'、' ORDER BY report.exception_text)");
      expect(sql).toContain("concat_ws('；'");
      /* 10 个工序各自一条来源片段，标签使用 canonical registry 的中文名。 */
      for (const process of standardProcesses) {
        expect(sql).toContain(`${process.name}：`);
        expect(sql).toContain(`report.process_code='${process.code}'`);
      }
      /* 每个工序名只出现一次（不重复工序名称）。 */
      expect(sql.split(`'${standardProcesses[4]!.name}：'`).length - 1).toBe(1);
    }
  });

  it("月计划异常跨所有关联 weekly 汇总（按 order_number + item_code 关联，不做只取第一条）", () => {
    const sql = String(monthlyColumns.exceptionSummary);
    expect(sql).toContain("FROM mps_weekly_plans weekly");
    expect(sql).toContain("JOIN mps_technical_reports report ON report.tenant_id=weekly.tenant_id AND report.weekly_plan_id=weekly.id");
    expect(sql).toContain("JOIN mps_process_reports report ON report.tenant_id=weekly.tenant_id AND report.weekly_plan_id=weekly.id");
    expect(sql).toContain("weekly.order_number=record.order_number AND weekly.item_code=record.item_code");
    /* 跨周去重：同一来源+文本只出现一次。 */
    expect(sql).toContain("string_agg(DISTINCT");
    expect(sql).not.toContain("LIMIT 1");
  });

  it("技术 / 五金主材 / 木作主材 / 外协的人工异常都进入统一异常，来源顺序稳定", () => {
    for (const columns of [weeklyColumns, monthlyColumns]) {
      const sql = String(columns.exceptionSummary);
      const labels = ["技术：", "五金主材：", "木作主材：", "外协：", ...standardProcesses.map((process) => `${process.name}：`)];
      const positions = labels.map((label) => sql.indexOf(label));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
      /* 主材按 material_name 区分 五金/木作，不外协混淆。 */
      expect(sql).toContain("report.material_name='五金'");
      expect(sql).toContain("report.material_name='木作'");
    }
  });
});

describe("KN-MPS-UI-001 报工入口与实时刷新", () => {
  const weeklyPlanId = "33333333-3333-4333-8333-333333333333";

  it("工序报工新增：人工异常随本次报工事实写入 exception_text，并触发 execution-rollup 重新汇总", async () => {
    const inserted = { id: "44444444-4444-4444-8444-444444444444", version: 1 };
    const weekly = { division_id: "22222222-2222-4222-8222-222222222222", order_number: "SO-1", item_code: "ITEM-1", item_name: "品项", delivery_number: 1, planned_quantity: "100", manufacturing_method: "自制" };
    const query = jest.fn(async (...args: [string, unknown[]?]) => {
      const [sql] = args;
      if (sql.startsWith("SELECT division_id,order_number,item_code,item_name,delivery_number,planned_quantity,manufacturing_method FROM mps_weekly_plans")) return [weekly];
      if (sql.startsWith("INSERT INTO mps_process_reports")) return [inserted];
      return [];
    });
    const manager = { query };
    const dataSource = { transaction: (work: (value: typeof manager) => unknown) => work(manager), manager, query };
    const sync = { processOutbox: jest.fn().mockResolvedValue(undefined) };
    const service = new MasterPlanApplicationService(dataSource as never, sync as never);

    await service.create("mps-process-reports", {
      weeklyPlanId, processCode: "welding", productionDate: "2026-09-17", productionQuantity: 20, exceptionText: "夹具异常"
    }, actor);

    const insert = query.mock.calls.find(([sql]) => String(sql).startsWith("INSERT INTO mps_process_reports"))!;
    expect(String(insert[0])).toContain("exception_text");
    expect(insert[1]).toContain("夹具异常");
    /* 报工写入必须进入执行对账队列，前端据此刷新周/月计划。 */
    const outbox = query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO mps_reconciliation_outbox"));
    expect(outbox.length).toBeGreaterThan(0);
    expect(outbox.some(([, params]) => JSON.stringify(params ?? "").includes("execution-rollup"))).toBe(true);
  });

  it("工序报工修改与删除：异常变化同样触发 execution-rollup 重新汇总（实时更新/消失）", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    const current = {
      id, version: 2, weekly_plan_id: weeklyPlanId, process_code: "welding", exception_text: "设备故障", created_by: actor.userId,
      production_date: "2026-09-17", production_quantity: "20", planned_quantity: "100", order_number: "SO-1", item_code: "ITEM-1",
      item_name: "品项", delivery_number: 1, division_id: "22222222-2222-4222-8222-222222222222"
    };
    const updated = { ...current, version: 3, exception_text: "夹具故障" };
    let currentRow = { ...current };
    const query = jest.fn(async (...args: [string, unknown[]?]) => {
      const [sql] = args;
      if (sql.startsWith("SELECT * FROM mps_process_reports")) return [currentRow];
      if (sql.startsWith("UPDATE mps_process_reports")) { currentRow = { ...updated }; return [[updated], 1]; }
      if (sql.startsWith("DELETE FROM mps_process_reports")) return [];
      return [];
    });
    const manager = { query };
    const sync = { processOutbox: jest.fn().mockResolvedValue(undefined) };
    const service = new MasterPlanApplicationService({ transaction: (work: (value: typeof manager) => unknown) => work(manager), manager, query } as never, sync as never);

    await service.update("mps-process-reports", id, { exceptionText: "夹具故障", expectedVersion: 2 }, actor);
    await service.remove("mps-process-reports", id, 3, actor);

    const update = query.mock.calls.find(([sql]) => String(sql).startsWith("UPDATE mps_process_reports"))!;
    expect(String(update[0])).toContain("exception_text=$");
    expect(update[1]).toContain("夹具故障");
    const outboxCalls = query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO mps_reconciliation_outbox"));
    expect(outboxCalls.length).toBeGreaterThanOrEqual(2);
    expect(outboxCalls.every(([, params]) => JSON.stringify(params ?? "").includes("execution-rollup"))).toBe(true);
  });
});

describe("KN-MPS-UI-001 同步绝不伪造生产异常", () => {
  const weeklyWithMissingCycles = {
    id: "11111111-1111-4111-8111-111111111111", division_id: "22222222-2222-4222-8222-222222222222",
    order_number: "SO-1", item_code: "ITEM-1", item_name: "品项", delivery_number: 1,
    latest_review_due_date: "2026-09-30", planned_quantity: "10", manufacturing_method: "自制",
    technical_days: null, cutting_days: null, machining_days: null, bending_days: null, spot_welding_days: null,
    welding_days: null, woodworking_days: null, grinding_days: null, surface_treatment_days: null, packaging_days: null
  };

  it("技术周期缺失不会写入技术报工的异常字段（只保留计划提示渠道）", async () => {
    const manager = { query: jest.fn().mockResolvedValue([]) };
    const service = new MasterPlanSyncService({} as never);
    await (service as any).ensureExecutionRows(manager, weeklyWithMissingCycles, "KAINAN", actor.userId, "tester");
    const call = manager.query.mock.calls.find(([statement]) => String(statement).startsWith("INSERT INTO mps_technical_reports"))!;
    const [sql, params] = call as [string, unknown[]];
    expect(sql).toContain("drawing_due_date,exception_text,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,");
    expect(params).not.toContain("未维护技术周期");
    expect(params.every((value) => value == null || !String(value).includes("未维护"))).toBe(true);
    /* 人工异常永不被同步覆盖：ON CONFLICT 更新列表里没有 exception_text。 */
    expect(sql.split("DO UPDATE SET")[1]).not.toContain("exception_text=");
  });

  it("工序周期缺失只写在工序任务（计划提示），报工事实表不产生任何行", async () => {
    const manager = { query: jest.fn().mockResolvedValue([]) };
    const service = new MasterPlanSyncService({} as never);
    await (service as any).ensureExecutionRows(manager, weeklyWithMissingCycles, "KAINAN", actor.userId, "tester");
    const statements = manager.query.mock.calls.map(([statement]) => String(statement));
    const processInsert = statements.find((statement) => statement.startsWith("INSERT INTO mps_weekly_process_plans"))!;
    const processCall = manager.query.mock.calls.find(([statement]) => String(statement).startsWith("INSERT INTO mps_weekly_process_plans"))!;
    expect((processCall[1] as unknown[])).toContain("未维护工序周期");
    /* 该提示在工序任务上，且工序任务表不参与统一异常（由 SQL 契约测试锁定）。 */
    expect(statements.some((statement) => statement.startsWith("INSERT INTO mps_process_reports"))).toBe(false);
    expect(processInsert.split("DO UPDATE SET")[1]).not.toContain("exception_text=");
  });

  it("执行对账只更新状态与当日报工，不写异常文本", async () => {
    const processRow = { id: "55555555-5555-4555-8555-555555555555", weekly_plan_id: weeklyPlanIdForRollup, process_code: "welding", due_date: "2026-09-20", report_date: null, planned_quantity: "100", cumulative_reported: "20", daily_reported: "20" };
    const query = jest.fn(async (...args: [string, unknown[]?]) => {
      const [sql] = args;
      if (sql.includes("SELECT p.id,p.weekly_plan_id")) return [processRow];
      if (sql.startsWith("UPDATE mps_weekly_process_plans")) return [{ id: processRow.id }];
      return [];
    });
    const dataSource = { query, transaction: (work: (value: { query: typeof query }) => unknown) => work({ query }) };
    const service = new MasterPlanSyncService(dataSource as never);
    await (service as any).executionRollup("KAINAN", "tester");
    const statements = query.mock.calls.map(([statement]) => String(statement));
    expect(statements.some((statement) => statement.includes("UPDATE mps_weekly_process_plans") && statement.includes("daily_reported_quantity=") && statement.includes("status="))).toBe(true);
    expect(statements.join(" ")).not.toContain("exception_text=");
  });
});
