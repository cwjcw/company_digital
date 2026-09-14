import { MasterPlanSyncService } from "./master-plan.sync.service";

describe("MasterPlanSyncService execution matrix", () => {
  const weekly = (manufacturingMethod: string) => ({
    id: "11111111-1111-4111-8111-111111111111", division_id: "22222222-2222-4222-8222-222222222222",
    order_number: "SO-1", item_code: "ITEM-1", item_name: "品项", delivery_number: 1,
    latest_review_due_date: "2026-09-30", planned_quantity: "10", manufacturing_method: manufacturingMethod,
    technical_days: 1, cutting_days: 1, machining_days: 1, bending_days: 1, spot_welding_days: 1,
    welding_days: 1, woodworking_days: 1, grinding_days: 1, surface_treatment_days: 1, packaging_days: 1
  });

  it.each([
    ["自制", true, false], ["中心外购", false, true], ["外协", false, true], ["自制+外协", true, true]
  ])("maps %s to process=%s outsourcing=%s without deleting history", async (method, processExpected, outsourcingExpected) => {
    const manager = { query: jest.fn().mockResolvedValue([]) }; const service = new MasterPlanSyncService({} as never);
    await (service as any).ensureExecutionRows(manager, weekly(method), "KAINAN", "33333333-3333-4333-8333-333333333333", "tester");
    const sql = manager.query.mock.calls.map(([statement]) => String(statement));
    expect(sql.some((statement) => statement.startsWith("INSERT INTO mps_weekly_process_plans"))).toBe(processExpected);
    expect(sql.some((statement) => statement.startsWith("INSERT INTO mps_outsourcing_reports"))).toBe(outsourcingExpected);
    expect(sql.some((statement) => /DELETE FROM mps_(weekly_process_plans|outsourcing_reports)/.test(statement))).toBe(false);
    if (!processExpected) expect(sql.some((statement) => statement.startsWith("UPDATE mps_weekly_process_plans SET execution_enabled=false"))).toBe(true);
    if (!outsourcingExpected) expect(sql.some((statement) => statement.startsWith("UPDATE mps_outsourcing_reports SET execution_enabled=false"))).toBe(true);
  });

  it("realigns an existing weekly row by stable base-plan identity before business-key upsert", async () => {
    const manager = { query: jest.fn().mockResolvedValue([]) };
    const dataSource = { transaction: jest.fn(async (work: (value: typeof manager) => Promise<unknown>) => work(manager)) };
    const service = new MasterPlanSyncService(dataSource as never);
    await (service as any).baseToWeekly("KAINAN", "33333333-3333-4333-8333-333333333333", "tester");
    const sql = manager.query.mock.calls.map(([statement]) => String(statement));
    expect(sql[0]).toContain("SET base_plan_id=NULL");
    expect(sql[1]).toContain("weekly.base_plan_id=base.id");
    expect(sql[2]).toContain("ON CONFLICT(tenant_id,order_number,item_code,delivery_number)");
  });
});
