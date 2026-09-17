import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { MasterPlanSyncService } from "./master-plan.sync.service";
import { processReportPendingFields, PROCESS_REPORT_PENDING_FIELDS } from "./master-plan.config";
import type { MasterPlanActor } from "./master-plan.types";

const actor = (permissions: string[], scopes: MasterPlanActor["tableDataScopes"] = []): MasterPlanActor => ({
  tenantId: "KAINAN", userId: "11111111-1111-4111-8111-111111111111", username: "tester",
  permissions, moduleAdminCodes: [], tableDataScopes: scopes, requestId: "request-1", source: "web"
});
const admin: MasterPlanActor = { ...actor(["*"]), isSystemAdmin: true };
const directory = { listEnabled: jest.fn().mockResolvedValue([]) };
/** 真实报工填报人：有工序报工表的读/新增权限与相关字段读权限，但没有通配权限，因此数据范围校验生效。 */
const reporter = (scopes: MasterPlanActor["tableDataScopes"] = []) => actor([
  "mps-process-reports:*:read", "mps-process-reports:*:create",
  "mps-process-reports:weeklyPlanId:read", "mps-process-reports:processCode:read",
  "mps-process-reports:productionDate:read", "mps-process-reports:productionQuantity:read"
], scopes);
const weeklyPlanRow = (divisionId = "88888888-8888-4888-8888-888888888888") =>
  ({ division_id: divisionId, order_number: "SO-1", item_code: "ITEM-1", item_name: "品项", delivery_number: 1, planned_quantity: "100", manufacturing_method: "自制" });
const task = {
  id: "22222222-2222-4222-8222-222222222222", version: 3, weeklyPlanId: "33333333-3333-4333-8333-333333333333",
  processCode: "bending", processName: "折弯", orderNumber: "SO-1", itemCode: "ITEM-1", itemName: "品项",
  plannedQuantity: "100.0000", cumulativeReportedQuantity: "10", remainingQuantity: "90"
};

describe("KN-PR-001 pending process reporting view", () => {
  it("defines the pending view fields once, in the approved order, with the reporting inputs", () => {
    expect(PROCESS_REPORT_PENDING_FIELDS.map((field) => field.label)).toEqual([
      "订单编号", "品项编码", "品项名称", "工序", "计划数量", "累计报工", "剩余数量", "本次报工数量", "生产日期", "异常"
    ]);
    expect(PROCESS_REPORT_PENDING_FIELDS.map((field) => field.key)).toEqual([
      "orderNumber", "itemCode", "itemName", "processCode", "plannedQuantity",
      "cumulativeReportedQuantity", "remainingQuantity", "productionQuantity", "productionDate", "exceptionText"
    ]);
    const fields = processReportPendingFields();
    expect(fields.filter((field) => field.input).map((field) => field.key)).toEqual(["productionQuantity", "productionDate", "exceptionText"]);
    /* 数量与生产日期必填；异常是可选人工文本。 */
    expect(fields.filter((field) => field.input && field.required).map((field) => field.key)).toEqual(["productionQuantity", "productionDate"]);
    expect(fields.find((field) => field.key === "exceptionText")).toMatchObject({ label: "异常", type: "text", editable: true, required: false });
    expect(fields.filter((field) => !field.input).every((field) => field.editable === false)).toBe(true);
    /* 工序字典 options 与正式字段定义同源。 */
    /* KN-PROC-001：工序 options 只有正式 10 工序，毛坯在研磨之后、表面处理之前。 */
    expect(fields.find((field) => field.key === "processCode")?.options?.map((option) => option.value)).toEqual([
      "cutting", "machining", "bending", "spotWelding", "welding", "woodworking", "grinding", "blank", "surfaceTreatment", "packaging"
    ]);
  });

  it("projects pending tasks from weekly process tasks and sums actual reports for cumulative and remaining", async () => {
    const query = jest.fn(async (...args: [string, unknown[]?]) => args[0].includes("count(*)") ? [{ count: 1 }] : [{ ...task, canUpdate: false, canDelete: false, pendingTask: true }]);
    const result = await new MasterPlanQueryService({ query } as never, directory as never).list("mps-process-reports", { view: "PENDING" }, admin);
    const sql = query.mock.calls.map(([statement]) => String(statement)).join(" ");
    const dataSql = query.mock.calls.map(([statement]) => String(statement)).find((statement) => statement.startsWith("WITH record AS") && statement.includes("pendingTask")) ?? "";

    expect(result.rows).toHaveLength(1);
    expect((result as { view?: string }).view).toBe("PENDING");
    expect(sql).toContain("FROM mps_weekly_process_plans task");
    expect(sql).toContain("LEFT JOIN (SELECT tenant_id,weekly_plan_id,process_code,sum(production_quantity) cumulative_quantity FROM mps_process_reports GROUP BY 1,2,3) reports");
    expect(sql).toContain("COALESCE(reports.cumulative_quantity,0) cumulative_reported_quantity");
    expect(sql).toContain("GREATEST(COALESCE(weekly.planned_quantity,0)-COALESCE(reports.cumulative_quantity,0),0) remaining_quantity");
    /* 累计达到计划数量即完成，任务不再出现在待报工列表。 */
    expect(sql).toContain("NOT (COALESCE(weekly.planned_quantity,0)>0 AND COALESCE(reports.cumulative_quantity,0)>=COALESCE(weekly.planned_quantity,0))");
    expect(dataSql).toContain('record."weeklyPlanId"');
    expect(sql).not.toContain("INSERT INTO mps_process_reports");
    expect(result.visibleFields).toEqual(expect.arrayContaining(["cumulativeReportedQuantity", "remainingQuantity"]));
  });

  it("keeps pending tasks read-only except the two reporting inputs and never exposes an action column", async () => {
    const query = jest.fn(async (...args: [string, unknown[]?]) => args[0].includes("count(*)") ? [{ count: 1 }] : [{ ...task, canUpdate: false, canDelete: false, pendingTask: true }]);
    const result = await new MasterPlanQueryService({ query } as never, directory as never).list("mps-process-reports", { view: "PENDING" }, admin);

    expect(result.rows[0]).toMatchObject({ canUpdate: false, canDelete: false, pendingTask: true });
    expect(result.visibleFields).not.toContain("__rowActions");
    const metadata = new MasterPlanQueryService({} as never, directory as never).metadata("mps-process-reports", admin);
    expect(metadata.pendingFields?.map((field) => field.label)).toEqual(PROCESS_REPORT_PENDING_FIELDS.map((field) => field.label));
    expect(metadata.actions.reportProcess).toBe(true);
  });

  it("requires create permission rather than update permission to report from pending tasks", () => {
    const service = new MasterPlanQueryService({} as never, directory as never);
    const updateOnly = actor(["mps-process-reports:*:read", "mps-process-reports:*:update"]);
    expect(service.metadata("mps-process-reports", updateOnly).actions.reportProcess).toBe(false);
    expect(service.metadata("mps-process-reports", actor(["mps-process-reports:*:read", "mps-process-reports:*:create"])).actions.reportProcess).toBe(true);
  });
});

describe("KN-PR-001 actual process reports", () => {
  const insertedReport = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", version: 1, weekly_plan_id: task.weeklyPlanId, process_code: "bending" };
  /** 默认 mock：周计划来源可解析、报工可插入、outbox 行可按需返回。 */
  const reportQuery = (extra?: (sql: string) => unknown[] | undefined) => jest.fn(async (sql: string) => {
    if (sql.includes("FROM mps_weekly_plans")) return [weeklyPlanRow()];
    if (sql.startsWith("INSERT INTO mps_process_reports")) return [insertedReport];
    return extra?.(sql) ?? [];
  });
  const buildService = (query: jest.Mock) => new MasterPlanApplicationService(
    { query, manager: { query }, transaction: (work: (value: { query: jest.Mock }) => unknown) => work({ query }) } as never,
    { processOutbox: jest.fn().mockResolvedValue(1) } as never
  );

  it("creates one independent report per submission while the identity fields stay create-only", async () => {
    const query = reportQuery();
    const service = buildService(query);
    const inserted = await service.create("mps-process-reports", {
      weeklyPlanId: task.weeklyPlanId, processCode: "bending", productionDate: "2026-09-16", productionQuantity: 10
    }, reporter());
    expect(inserted).toBeDefined();
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO mps_process_reports"))).toBe(true);

    /* 身份字段生成后不得被普通修改或批量修改。 */
    await expect(service.update("mps-process-reports", task.id, { processCode: "welding", expectedVersion: 1 }, admin)).rejects.toThrow("字段 processCode 不允许写入");
    await expect(service.batchUpdate("mps-process-reports", { records: [{ id: task.id, expectedVersion: 1 }], fieldKey: "weeklyPlanId", value: task.weeklyPlanId, idempotencyKey: "44444444-4444-4444-8444-444444444444" }, admin))
      .rejects.toThrow("所选字段不支持批量修改");
  });

  it("keeps correction and deletion of actual reports recomputing the rollup from the fact table", async () => {
    const current = { id: "55555555-5555-4555-8555-555555555555", version: 2, weekly_plan_id: task.weeklyPlanId, process_code: "bending", production_date: "2026-09-16", production_quantity: "10.0000", planned_quantity: "100.0000" };
    const updated = { ...current, version: 3, production_quantity: "8.0000" };
    const query = reportQuery((sql) => {
      if (sql.startsWith("SELECT * FROM mps_process_reports")) return [current];
      if (sql.startsWith("UPDATE mps_process_reports")) return [[updated], 1];
      return undefined;
    });
    const service = buildService(query);
    const result = await service.update("mps-process-reports", current.id, { productionQuantity: 8, expectedVersion: 2 }, admin);

    expect(result).toMatchObject({ id: current.id, version: 3 });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("mps_reconciliation_outbox"))).toBe(true);

    /* 删除：同一记录删除后同样排入重新汇总，不保留旧累计。 */
    const deleteQuery = reportQuery((sql) => sql.startsWith("SELECT * FROM mps_process_reports") ? [{ ...updated, version: 3 }] : undefined);
    const deleteService = buildService(deleteQuery);
    await deleteService.remove("mps-process-reports", current.id, 3, admin);
    expect(deleteQuery.mock.calls.some(([sql]) => String(sql).startsWith("DELETE FROM mps_process_reports"))).toBe(true);
    expect(deleteQuery.mock.calls.some(([sql]) => String(sql).includes("mps_reconciliation_outbox"))).toBe(true);
  });

  it("rolls cumulative reported quantity up from actual reports only", async () => {
    const processRow = { id: "99999999-9999-4999-8999-999999999999", weekly_plan_id: task.weeklyPlanId, process_code: "bending", due_date: "2026-09-30", report_date: "2026-09-16", planned_quantity: "100", cumulative_reported: "100", daily_reported: "8" };
    const manager = { query: jest.fn(async (sql: string) => sql.startsWith("SELECT p.id,p.weekly_plan_id") ? [processRow] : []) };
    const service = new MasterPlanSyncService({ transaction: (work: (value: typeof manager) => unknown) => work(manager) } as never);
    await (service as any).executionRollup("KAINAN", "tester");
    const sql = manager.query.mock.calls.map(([statement]) => String(statement)).join(" ");

    expect(sql).toContain("COALESCE(sum(r.production_quantity),0) cumulative_reported");
    expect(sql).toContain("LEFT JOIN mps_process_reports r ON r.tenant_id=p.tenant_id AND r.weekly_plan_id=p.weekly_plan_id AND r.process_code=p.process_code");
    expect(sql).toContain("UPDATE mps_weekly_process_plans SET daily_reported_quantity=$3,status=$4");
    /* 状态由事实表 SUM 得出的累计决定（100 >= 100 → 已完成），不是增量漂移。 */
    expect((manager.query.mock.calls as unknown[][]).some((call) => JSON.stringify(call[1] ?? "").includes("已完成"))).toBe(true);
    expect(sql).not.toContain("INSERT INTO mps_process_reports");
  });

  it("keeps manual report facts safe from later plan synchronisation", async () => {
    const manager = { query: jest.fn().mockResolvedValue([]) };
    const service = new MasterPlanSyncService({} as never);
    await (service as any).ensureExecutionRows(manager, {
      id: task.weeklyPlanId, division_id: "66666666-6666-4666-8666-666666666666", order_number: "SO-1", item_code: "ITEM-1",
      item_name: "品项", delivery_number: 1, latest_review_due_date: "2026-09-30", planned_quantity: "100", manufacturing_method: "自制",
      technical_days: 1, cutting_days: 1, machining_days: 1, bending_days: 1, spot_welding_days: 1, welding_days: 1,
      woodworking_days: 1, grinding_days: 1, surface_treatment_days: 1, packaging_days: 1
    }, "KAINAN", "11111111-1111-4111-8111-111111111111", "tester");
    const reportUpdate = manager.query.mock.calls.map(([statement]) => String(statement)).find((statement) => statement.startsWith("UPDATE mps_process_reports"))!;

    expect(reportUpdate).toContain("division_id=$3");
    expect(reportUpdate).toContain("planned_quantity=$8");
    expect(reportUpdate).not.toMatch(/production_date=|production_quantity=/);
  });

  it("blocks reporting into a division outside the actor data scope even with a forged weeklyPlanId", async () => {
    const scoped = actor(["mps-process-reports:*:read", "mps-process-reports:*:create"], [
      { resource: "mps-process-reports", scope: "CUSTOM", actions: ["create"], rules: [{ fieldKey: "divisionId", operator: "EQ", value: "77777777-7777-4777-8777-777777777777" }] }
    ]);
    const permittedReporter = { ...reporter([{ resource: "mps-process-reports", scope: "CUSTOM", actions: ["create"], rules: [{ fieldKey: "divisionId", operator: "EQ", value: "77777777-7777-4777-8777-777777777777" }] }]), userId: scoped.userId };
    const query = reportQuery();
    const service = buildService(query);

    await expect(service.create("mps-process-reports", { weeklyPlanId: task.weeklyPlanId, processCode: "bending", productionDate: "2026-09-16", productionQuantity: 10 }, permittedReporter))
      .rejects.toThrow("当前数据范围不允许在该事业部新增记录");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO mps_process_reports"))).toBe(false);
  });

  it("allows reporting when the resolved division matches the actor data scope", async () => {
    const divisionId = "88888888-8888-4888-8888-888888888888";
    const scoped = reporter([{ resource: "mps-process-reports", scope: "CUSTOM", actions: ["create"], rules: [{ fieldKey: "divisionId", operator: "EQ", value: divisionId }] }]);
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("FROM mps_weekly_plans")) return [weeklyPlanRow(divisionId)];
      if (sql.startsWith("INSERT INTO mps_process_reports")) return [insertedReport];
      return [];
    });
    const service = buildService(query);

    await expect(service.create("mps-process-reports", { weeklyPlanId: task.weeklyPlanId, processCode: "bending", productionDate: "2026-09-16", productionQuantity: 10 }, scoped)).resolves.toBeDefined();
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO mps_process_reports"))).toBe(true);
  });

  it("reports execution rollup completion back to the caller instead of guessing with timers", async () => {
    const query = reportQuery((sql) => sql.includes("FROM mps_reconciliation_outbox") ? [{ status: "SUCCESS", last_error: null }] : undefined);
    const sync = { processOutbox: jest.fn().mockResolvedValue(1) };
    const service = new MasterPlanApplicationService({ query, manager: { query }, transaction: (work: (value: { query: jest.Mock }) => unknown) => work({ query }) } as never, sync as never);

    await expect(service.create("mps-process-reports", { weeklyPlanId: task.weeklyPlanId, processCode: "bending", productionDate: "2026-09-16", productionQuantity: 10 }, admin))
      .resolves.toMatchObject({ reconciliation: { status: "SUCCESS", message: null } });
    expect(sync.processOutbox).toHaveBeenCalled();

    const pendingQuery = reportQuery((sql) => sql.includes("FROM mps_reconciliation_outbox") ? [{ status: "RUNNING", last_error: null }] : undefined);
    const pendingService = new MasterPlanApplicationService({ query: pendingQuery, manager: { query: pendingQuery }, transaction: (work: (value: { query: jest.Mock }) => unknown) => work({ query: pendingQuery }) } as never, { processOutbox: jest.fn().mockResolvedValue(0) } as never);
    await expect(pendingService.create("mps-process-reports", { weeklyPlanId: task.weeklyPlanId, processCode: "bending", productionDate: "2026-09-16", productionQuantity: 10 }, admin))
      .resolves.toMatchObject({ reconciliation: { status: "RUNNING", message: "报工已保存，执行状态正在同步，请稍后刷新查看。" } });
  });

  it("never fabricates empty reports and leaves identity resolution to the server", async () => {
    const query = reportQuery();
    const service = buildService(query);
    await service.create("mps-process-reports", { weeklyPlanId: task.weeklyPlanId, processCode: "bending", productionDate: "2026-09-16", productionQuantity: 10 }, admin);
    const insert = String(query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO mps_process_reports"))?.[0] ?? "");

    expect(insert).toContain("weekly_plan_id");
    expect(insert).toContain("process_name");
    /* 创建时服务端补齐来源快照，不允许前端传入订单/品项/事业部。 */
    expect(query.mock.calls.some(([sql]) => String(sql).includes("FROM mps_weekly_plans"))).toBe(true);
  });
});
