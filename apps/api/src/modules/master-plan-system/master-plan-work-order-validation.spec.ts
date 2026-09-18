import { MasterPlanApplicationService } from "./master-plan.application.service";
import type { MasterPlanActor } from "./master-plan.types";

/**
 * KN-MPS-WO-001：3天生产工单写入边界（服务端权威校验）。
 * - 来源字段只读：即使直接调用 API 也必须拒绝；
 * - 人工字段可改：生产开始/结束日期、备注、加工备注；
 * - 生产日期：两者都空合法、单日合法、范围合法、不限制天数；只填一个或 start>end 必须拒绝；
 * - 普通新增与 Excel 新增都必须拒绝（只能“从周计划同步”）。
 */
const actor = (permissions: string[]): MasterPlanActor => ({
  tenantId: "KAINAN", userId: "11111111-1111-4111-8111-111111111111", username: "tester",
  permissions, moduleAdminCodes: [], tableDataScopes: [], requestId: "req-wo-val", source: "web"
});
const editor = actor(["*"]);
const id = "22222222-2222-4222-8222-222222222222";
const current = {
  id, version: 3, weekly_plan_id: "33333333-3333-4333-8333-333333333333", division_id: "d23442f9-4862-4641-b4a7-c8d470bc56ea",
  order_number: "O001", item_code: "P001", item_name: "品项", required_quantity: "100.0000",
  production_start_date: null, production_end_date: null, remark: null, processing_remark: null
};
function service(query: jest.Mock) {
  const manager = { query };
  const dataSource = { transaction: (work: (value: typeof manager) => unknown) => work(manager), manager, query };
  return new MasterPlanApplicationService(dataSource as never, { processOutbox: jest.fn().mockResolvedValue(undefined) } as never);
}
function patchService() {
  const query = jest.fn(async (statement: string) => {
    if (statement.startsWith("SELECT * FROM mps_three_day_work_orders")) return [current];
    if (statement.startsWith("UPDATE mps_three_day_work_orders")) return [[{ ...current, version: 4 }], 1];
    return [];
  });
  return { query, service: service(query) };
}

describe("KN-MPS-WO-001 普通写入边界", () => {
  it("来源字段不可写：直接 PATCH 必须被拒绝（不能绕过网页只读）", async () => {
    const { service: app } = patchService();
    for (const field of ["weeklyPlanId", "divisionId", "customerCode", "orderNumber", "orderDate", "modelAge", "itemCode", "itemName", "imageRefs", "requiredQuantity", "blankCompletionDate", "packagingCompletionDate", "manufacturingMethod"]) {
      await expect(app.update("mps-three-day-work-orders", id, { [field]: "x", expectedVersion: 3 }, editor)).rejects.toThrow(`字段 ${field} 不允许写入`);
    }
  });

  it("人工字段可写：生产开始/结束日期、备注、加工备注正常保存", async () => {
    const { query, service: app } = patchService();
    await expect(app.update("mps-three-day-work-orders", id, { productionStartDate: "2026-09-20", productionEndDate: "2026-09-22", remark: "加急", processingRemark: "先做A面", expectedVersion: 3 }, editor))
      .resolves.toEqual(expect.objectContaining({ id, version: 4 }));
    const update = query.mock.calls.find(([statement]) => String(statement).startsWith("UPDATE mps_three_day_work_orders"))!;
    expect(String(update[0])).toContain("production_start_date=");
    expect(String(update[0])).toContain("production_end_date=");
    expect(String(update[0])).toContain("processing_remark=");
  });

  it("生产日期规则：两者都空 / 单日 / 范围 / 超过 3 天均合法", async () => {
    for (const values of [
      { productionStartDate: null, productionEndDate: null },
      { productionStartDate: "2026-09-20", productionEndDate: "2026-09-20" },
      { productionStartDate: "2026-09-20", productionEndDate: "2026-09-22" },
      { productionStartDate: "2026-09-20", productionEndDate: "2026-09-25" }
    ]) {
      const { service: app } = patchService();
      await expect(app.update("mps-three-day-work-orders", id, { ...values, expectedVersion: 3 }, editor)).resolves.toEqual(expect.objectContaining({ version: 4 }));
    }
  });

  it("生产日期规则：只填开始 / 只填结束 / 开始晚于结束都必须拒绝（服务端最终校验）", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ productionStartDate: "2026-09-20", productionEndDate: null }, "生产开始日期和生产结束日期必须同时填写或同时留空"],
      [{ productionStartDate: null, productionEndDate: "2026-09-20" }, "生产开始日期和生产结束日期必须同时填写或同时留空"],
      [{ productionStartDate: "2026-09-22", productionEndDate: "2026-09-20" }, "生产结束日期不能早于生产开始日期"]
    ];
    for (const [values, message] of cases) {
      const { service: app } = patchService();
      await expect(app.update("mps-three-day-work-orders", id, { ...values, expectedVersion: 3 }, editor)).rejects.toThrow(message);
    }
  });

  it("普通新增被拒绝，并给出“先点击从周计划同步”的明确提示", async () => {
    const query = jest.fn().mockResolvedValue([]);
    const app = service(query);
    await expect(app.create("mps-three-day-work-orders", { orderNumber: "O001", itemCode: "P001" }, editor))
      .rejects.toThrow("3天生产工单不能通过Excel新增，请先在系统点击“从周计划同步”。");
    /* Excel 新增（记录ID/版本都为空）走同一闸门。 */
    await expect(app.importUpdates("mps-three-day-work-orders", [{ id: null, expectedVersion: null, values: { orderNumber: "O001", itemCode: "P001" } }], "file-hash", editor))
      .rejects.toThrow("3天生产工单不能通过Excel新增，请先在系统点击“从周计划同步”。");
    expect(query.mock.calls.some(([statement]) => String(statement).includes("INSERT INTO mps_three_day_work_orders"))).toBe(false);
  });
});
