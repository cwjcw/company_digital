import { ForbiddenException } from "@nestjs/common";
import { MasterPlanWorkOrderService, WORK_ORDER_SOURCE_FIELDS, WORK_ORDER_USER_FIELDS } from "./master-plan.work-order.service";
import type { MasterPlanActor } from "./master-plan.types";
import { fieldsFor, MASTER_PLAN_RESOURCE_MAP } from "./master-plan.config";

/**
 * KN-MPS-WO-001：3天生产工单同步契约。
 * 关键不变量：唯一同步身份是 weeklyPlanId；只覆盖 source-owned 字段；人工字段（生产日期/备注/加工备注）永不被同步覆盖；
 * 幂等（无变化不涨 version）；不做“来源消失即删除”；不依赖 deliveryNumber。
 */
const actor = (permissions: string[]): MasterPlanActor => ({
  tenantId: "KAINAN", userId: "11111111-1111-4111-8111-111111111111", username: "tester",
  permissions, moduleAdminCodes: [], tableDataScopes: [], requestId: "req-wo", source: "web"
});
const syncer = actor(["mps-three-day-work-orders:*:update", "mps-weekly-plans:*:read"]);
const weeklySource = (overrides: Record<string, unknown> = {}) => ({
  weekly_plan_id: "22222222-2222-4222-8222-222222222222", division_id: "d23442f9-4862-4641-b4a7-c8d470bc56ea",
  customer_code: "0001", order_number: "O001", order_date: "2026-09-01", model_age: null,
  item_code: "P001", item_name: "品项", image_refs: [], planned_quantity: "100.0000", manufacturing_method: null,
  blank_completion_date: "2026-09-20", packaging_completion_date: null, ...overrides
});

function build(sourceRows: Array<Record<string, unknown>>, upsertResults: Array<Array<Record<string, unknown>>>) {
  const queries: Array<[string, unknown[]?]> = [];
  let upsertIndex = 0;
  const query = jest.fn(async (...args: [string, unknown[]?]) => {
    const [sql] = args;
    queries.push(args);
    if (sql.includes("FROM mps_three_day_work_orders WHERE tenant_id=$1") && sql.startsWith("SELECT")) return [];
    if (sql.includes("INSERT INTO mps_three_day_work_orders")) return upsertResults[upsertIndex++] ?? [];
    return [];
  });
  const manager = { query };
  const dataSource = { transaction: (work: (value: typeof manager) => unknown) => work(manager), manager, query };
  const queryService = { weeklyWorkOrderSource: jest.fn().mockResolvedValue(sourceRows) };
  const service = new MasterPlanWorkOrderService(dataSource as never, queryService as never);
  return { service, queryService, query, queries };
}
const sqlOf = (queries: Array<[string, unknown[]?]>) => queries.map(([sql]) => String(sql)).join("\n");

describe("KN-MPS-WO-001 从周计划同步", () => {
  it("同步权限：必须同时具备 3天生产工单 维护权限与周计划查看权限", async () => {
    const { service } = build([], []);
    await expect(service.syncFromWeekly(actor(["mps-weekly-plans:*:read"]))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.syncFromWeekly(actor(["mps-three-day-work-orders:*:update"]))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.syncFromWeekly(actor(["*"]))).resolves.toEqual(expect.objectContaining({ scanned: 0 }));
  });

  it("用同一份来源集合创建工单：scanned/created/unchanged 与 upsert 返回一致，人工字段初始为空", async () => {
    const rows = [weeklySource(), weeklySource({ weekly_plan_id: "33333333-3333-4333-8333-333333333333", order_number: "O002", item_code: "P002" })];
    const created = rows.map((row, index) => ({ id: `id-${index}`, weekly_plan_id: row.weekly_plan_id, inserted: true }));
    const { service, query, queries } = build(rows, [created]);

    await expect(service.syncFromWeekly(syncer)).resolves.toEqual({ scanned: 2, created: 2, updated: 0, unchanged: 0, skipped: 0 });
    const sql = sqlOf(queries);
    /* 冲突目标是 (tenant_id, weekly_plan_id) 唯一约束：身份稳定，不依赖订单号+品项+交期。 */
    expect(sql).toContain("ON CONFLICT ON CONSTRAINT uq_mps_three_day_work_order DO UPDATE SET");
    /* 人工字段绝不出现在 INSERT 列表或 UPDATE 覆盖列表里。 */
    for (const key of ["production_start_date", "production_end_date", "remark", "processing_remark"]) {
      expect(sql.split("ON CONFLICT")[0]).not.toContain(key);
      expect(sql.split("ON CONFLICT")[1].split("WHERE")[0]).not.toContain(`${key}=excluded.${key}`);
    }
    /* 绝不删除来源已不存在的工单。 */
    expect(sql).not.toContain("DELETE FROM mps_three_day_work_orders");
    /* 新建审计 + 同步汇总审计。 */
    expect(query.mock.calls.filter(([statement]) => String(statement).includes("INSERT INTO audit_logs"))).toHaveLength(2);
  });

  it("幂等：来源无变化时 upsert 不返回行 → created=0、updated=0、unchanged=N，version 不递增", async () => {
    const rows = [weeklySource()];
    const { service, query, queries } = build(rows, [[]]);

    await expect(service.syncFromWeekly(syncer)).resolves.toEqual({ scanned: 1, created: 0, updated: 0, unchanged: 1, skipped: 0 });
    const sql = sqlOf(queries);
    /* 只有来源字段确有差异才更新（无变化 → 不 update → 不涨 version、不动 updated_at）。 */
    expect(sql).toContain("IS DISTINCT FROM");
    /* 未发生任何记录级写入时只留一条同步汇总审计（scanned/created/updated/unchanged）。 */
    const audits = query.mock.calls.filter(([statement]) => String(statement).includes("INSERT INTO audit_logs"));
    expect(audits).toHaveLength(1);
    /* 审计参数里包含同步汇总 JSON（引号在参数中已转义）。 */
    expect(JSON.stringify(audits[0]![1])).toContain("unchanged");
    expect(JSON.stringify(audits[0]![1])).toContain("1");
  });

  it("来源变化只更新来源字段：updated 计数正确，人工字段 SQL 不参与覆盖", async () => {
    const rows = [weeklySource({ planned_quantity: "120.0000", blank_completion_date: "2026-09-21" })];
    const changed = [{ id: "id-1", weekly_plan_id: rows[0]!.weekly_plan_id, inserted: false }];
    const { service, queries } = build(rows, [changed]);

    await expect(service.syncFromWeekly(syncer)).resolves.toEqual({ scanned: 1, created: 0, updated: 1, unchanged: 0, skipped: 0 });
    const updateClause = sqlOf(queries).split("ON CONFLICT")[1].split("WHERE")[0];
    for (const field of WORK_ORDER_SOURCE_FIELDS) {
      const column = field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      expect(updateClause).toContain(`${column}=excluded.${column}`);
    }
    for (const field of WORK_ORDER_USER_FIELDS) {
      const column = field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      expect(updateClause).not.toContain(`${column}=`);
    }
  });

  it("同订单同品项不同 weeklyPlanId 生成两条工单（身份只看 weeklyPlanId）", async () => {
    const rows = [
      weeklySource({ weekly_plan_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
      weeklySource({ weekly_plan_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })
    ];
    const { service, queries } = build(rows, [[{ id: "id-a", weekly_plan_id: rows[0]!.weekly_plan_id, inserted: true }, { id: "id-b", weekly_plan_id: rows[1]!.weekly_plan_id, inserted: true }]]);

    await expect(service.syncFromWeekly(syncer)).resolves.toEqual({ scanned: 2, created: 2, updated: 0, unchanged: 0, skipped: 0 });
    const sql = sqlOf(queries);
    /* 两条来源行都按 weeklyPlanId 参数写入（UUID 走参数化，不拼进 SQL）。 */
    const upsertParams = queries.filter(([statement]) => String(statement).includes("INSERT INTO mps_three_day_work_orders")).flatMap(([, params]) => params ?? []);
    expect(upsertParams).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(upsertParams).toContain("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    /* 同步 SQL 不使用 delivery_number / 订单号+品项做匹配。 */
    expect(sql).not.toContain("delivery_number");
  });

  it("来源行缺少必填字段（division/订单号/品项）时计入 skipped，不制造假数据", async () => {
    const rows = [weeklySource(), weeklySource({ weekly_plan_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", division_id: null }), weeklySource({ weekly_plan_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", item_code: "" })];
    const { service } = build(rows, [[{ id: "id-1", weekly_plan_id: rows[0]!.weekly_plan_id, inserted: true }]]);

    await expect(service.syncFromWeekly(syncer)).resolves.toEqual({ scanned: 3, created: 1, updated: 0, unchanged: 0, skipped: 2 });
  });

  it("目标表 metadata 不含交期编码；来源字段只读、人工字段可编辑", () => {
    const fields = fieldsFor(MASTER_PLAN_RESOURCE_MAP.get("mps-three-day-work-orders")!);
    const keys = fields.map((field) => field.key);
    expect(keys).not.toContain("deliveryNumber");
    for (const field of WORK_ORDER_SOURCE_FIELDS) expect(fields.find((entry) => entry.key === field)?.editable).toBe(false);
    for (const field of WORK_ORDER_USER_FIELDS) expect(fields.find((entry) => entry.key === field)?.editable).toBe(true);
    /* 合并展示列只用于网页/打印，不参与高级筛选。 */
    expect(fields.find((entry) => entry.key === "productionDateRange")?.filterable).toBe(false);
    /* 来源周计划 UUID 不打印。 */
    expect(fields.find((entry) => entry.key === "weeklyPlanId")?.printable).toBe(false);
  });
});
