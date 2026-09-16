import { MasterPlanSyncService } from "./master-plan.sync.service";
import { MASTER_PLAN_RESOURCE_MAP, weeklyAdmissionSql } from "./master-plan.config";
import { ConflictException } from "@nestjs/common";

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
    expect(sql.some((statement) => statement.includes("INSERT INTO mps_process_reports"))).toBe(false);
    expect(sql.some((statement) => /DELETE FROM mps_(weekly_process_plans|outsourcing_reports)/.test(statement))).toBe(false);
    if (!processExpected) expect(sql.some((statement) => statement.startsWith("UPDATE mps_weekly_process_plans SET execution_enabled=false"))).toBe(true);
    if (!outsourcingExpected) expect(sql.some((statement) => statement.startsWith("UPDATE mps_outsourcing_reports SET execution_enabled=false"))).toBe(true);
  });

  it("creates and updates weekly rows only by stable base-plan identity and admission", async () => {
    const manager = { query: jest.fn().mockResolvedValue([]) };
    const dataSource = { transaction: jest.fn(async (work: (value: typeof manager) => Promise<unknown>) => work(manager)) };
    const service = new MasterPlanSyncService(dataSource as never);
    await (service as any).baseToWeekly("KAINAN", "33333333-3333-4333-8333-333333333333", "tester");
    const sql = manager.query.mock.calls.map(([statement]) => String(statement));
    expect(sql[0]).toContain("ON CONFLICT ON CONSTRAINT uq_mps_weekly_base");
    expect(sql[0]).toContain("order_number=excluded.order_number");
    expect(sql[0]).toContain("item_code=excluded.item_code");
    expect(sql[0]).toContain("delivery_number=excluded.delivery_number");
    expect(sql[0]).toContain(weeklyAdmissionSql(MASTER_PLAN_RESOURCE_MAP.get("mps-base-plans")!, "base"));
    expect(sql.join(" ")).not.toContain("SET base_plan_id=NULL");
    expect(sql.join(" ")).not.toContain("ON CONFLICT(tenant_id,order_number,item_code,delivery_number)");
    expect(sql.some((statement) => statement.includes("DELETE FROM mps_weekly_plans"))).toBe(false);
  });

  it("never copies an illegal dictionary value from the base plan into the weekly plan", async () => {
    const manager = { query: jest.fn().mockResolvedValue([]) };
    const dataSource = { transaction: jest.fn(async (work: (value: typeof manager) => Promise<unknown>) => work(manager)) };
    const service = new MasterPlanSyncService(dataSource as never);
    await (service as any).baseToWeekly("KAINAN", "33333333-3333-4333-8333-333333333333", "tester");
    const insert = manager.query.mock.calls.map(([statement]) => String(statement)).find((statement) => statement.includes("INSERT INTO mps_weekly_plans"))!;

    expect(insert).toContain("WHEN base.product_attribute::text IN ('五金','木作','亚克力','五金+木作') THEN base.product_attribute::text ELSE weekly.product_attribute END");
    expect(insert).toContain("WHEN base.surface_nature::text IN ('烤漆','电镀') THEN base.surface_nature::text ELSE weekly.surface_nature END");
    expect(insert).toContain("WHEN base.manufacturing_method::text IN ('自制','中心外购','外协','自制+外协') THEN base.manufacturing_method::text ELSE weekly.manufacturing_method END");
    expect(insert).toContain("LEFT JOIN mps_weekly_plans weekly ON weekly.tenant_id=base.tenant_id AND weekly.base_plan_id=base.id");
    expect(insert).toContain("ON CONFLICT ON CONSTRAINT uq_mps_weekly_base DO UPDATE");
    expect(insert).toContain("WHERE base.tenant_id=$1");
  });

  it("never copies an illegal dictionary value from the monthly plan into the base plan", async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new MasterPlanSyncService({ query } as never);
    await (service as any).shippingToBase("KAINAN", "33333333-3333-4333-8333-333333333333", "tester");
    const insert = String(query.mock.calls[0][0]);

    expect(insert).toContain("WHEN m.product_attribute::text IN ('五金','木作','亚克力','五金+木作') THEN m.product_attribute::text ELSE existing.product_attribute END");
    expect(insert).toContain("WHEN m.surface_nature::text IN ('烤漆','电镀') THEN m.surface_nature::text ELSE existing.surface_nature END");
    expect(insert).toContain("WHEN m.manufacturing_method::text IN ('自制','中心外购','外协','自制+外协') THEN m.manufacturing_method::text ELSE existing.manufacturing_method END");
    expect(insert).toContain("WHEN s.model_age::text IN ('新','旧') THEN s.model_age::text ELSE existing.model_age END");
    expect(insert).toContain("LEFT JOIN mps_base_plans existing ON existing.tenant_id=s.tenant_id AND existing.order_number=s.order_number AND existing.item_code=s.item_code AND existing.delivery_number=s.delivery_number");
    expect(insert).toContain("WHERE s.tenant_id=$1");
  });

  it("uses weekly-plan identity for every generated child and keeps manual execution fields", async () => {
    const manager = { query: jest.fn().mockResolvedValue([]) }; const service = new MasterPlanSyncService({} as never);
    await (service as any).ensureExecutionRows(manager, weekly("自制+外协"), "KAINAN", "33333333-3333-4333-8333-333333333333", "tester");
    const statements = manager.query.mock.calls.map(([statement]) => String(statement));
    const process = statements.find((sql) => sql.startsWith("INSERT INTO mps_weekly_process_plans"))!;
    const technical = statements.find((sql) => sql.startsWith("INSERT INTO mps_technical_reports"))!;
    const materials = statements.filter((sql) => sql.startsWith("INSERT INTO mps_material_reports"));
    const outsourcing = statements.find((sql) => sql.startsWith("INSERT INTO mps_outsourcing_reports"))!;
    expect(process).toContain("ON CONFLICT(tenant_id,weekly_plan_id,process_code)");
    expect(technical).toContain("ON CONFLICT(tenant_id,weekly_plan_id)");
    expect(materials).toHaveLength(2);
    expect(materials.every((sql) => sql.includes("ON CONFLICT(tenant_id,weekly_plan_id,material_name)"))).toBe(true);
    expect(outsourcing).toContain("ON CONFLICT(tenant_id,weekly_plan_id)");
    expect(process.split("DO UPDATE SET")[1]).not.toContain("exception_text=");
    expect(technical.split("DO UPDATE SET")[1]).not.toMatch(/drawing_due_date=|status=|exception_text=|responsible_user_id=|drawing_refs=/);
    expect(materials.every((sql) => !/received=|actual_inbound_date=|exception_text=/.test(sql.split("DO UPDATE SET")[1]!))).toBe(true);
    expect(outsourcing.split("DO UPDATE SET")[1]).not.toMatch(/purchase_order_number=|supplier_id=|outsourcing_method=|actual_inbound_date=|status=|exception_text=/);
  });

  it("synchronizes report snapshots by weekly-plan id without creating fake process reports", async () => {
    const manager = { query: jest.fn().mockResolvedValue([]) }; const service = new MasterPlanSyncService({} as never);
    await (service as any).ensureExecutionRows(manager, weekly("自制"), "KAINAN", "33333333-3333-4333-8333-333333333333", "tester");
    const sql = manager.query.mock.calls.map(([statement]) => String(statement));
    const reportUpdate = sql.find((statement) => statement.startsWith("UPDATE mps_process_reports"))!;
    expect(reportUpdate).toContain("weekly_plan_id=$2");
    expect(reportUpdate).toContain("item_code=$5");
    expect(reportUpdate).toContain("planned_quantity=$8");
    expect(sql.some((statement) => statement.includes("INSERT INTO mps_process_reports"))).toBe(false);
  });

  it("keeps an outbox event retryable when its sync key is already running instead of reporting a failure", async () => {
    const query = jest.fn(async (statement: string) => statement.includes("UPDATE mps_reconciliation_outbox") && statement.includes("status='RUNNING'")
      ? [{ id: "outbox-1", tenant_id: "KAINAN", sync_key: "base-to-weekly", actor_id: "33333333-3333-4333-8333-333333333333", actor_name: "tester", idempotency_key: "outbox:request-1:mps-base-plans:base-to-weekly" }]
      : []);
    const dataSource = { query, transaction: async (work: (value: { query: typeof query }) => unknown) => work({ query }) };
    const service = new MasterPlanSyncService(dataSource as never);
    jest.spyOn(service, "run").mockRejectedValue(new ConflictException("该同步任务正在运行"));

    await expect(service.processOutbox()).resolves.toBe(1);
    const updates = query.mock.calls.map(([statement]) => String(statement)).filter((statement) => /UPDATE mps_reconciliation_outbox SET status='(PENDING|FAILED)'/.test(statement));
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("status='PENDING'");
    expect(updates[0]).toContain("last_error=NULL");
    expect(updates[0]).not.toContain("FAILED");
  });
});
