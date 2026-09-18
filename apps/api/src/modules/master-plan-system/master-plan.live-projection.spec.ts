import { MasterPlanSyncService } from "./master-plan.sync.service";
import { MASTER_PLAN_ERP_ADMISSION } from "./master-plan.erp-admission";

const TENANT = "KAINAN";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const KEJIA = MASTER_PLAN_ERP_ADMISSION.sourceDatabase;

async function projectPlansSql() {
  const query = jest.fn(async (statement: string) => (String(statement).includes("AS blocked_by_missing_customer_mapping")
    ? [{ blocked_by_missing_customer_mapping: 8, division_defaulted: 0 }] : []));
  const dataSource = { transaction: async (work: (manager: unknown) => unknown) => work({ query }) };
  const service = new MasterPlanSyncService(dataSource as never);
  await (service as any).projectPlans(TENANT, ACTOR, "tester");
  return (query.mock.calls as Array<[unknown]>).map(([statement]) => String(statement));
}

const statementOf = (statements: string[], needle: string) => statements.find((statement) => statement.includes(needle))!;

/** KN-MPS-LIVE-002：计划投影的事业部归属与入库账套口径。 */
describe("KN-MPS-LIVE-002 master plan projection boundaries", () => {
  it("Case H：事业部只由客户映射派生，未映射订单不得进入月计划", async () => {
    const statements = await projectPlansSql();
    const allocation = statementOf(statements, "INSERT INTO mps_order_allocations");
    /* 分配表显式写入由客户映射派生的事业部，而不是依赖列默认值。 */
    /* PostgreSQL 没有 max(uuid) 聚合；映射在 (tenant,customer) 上唯一，组内取确定性唯一值。 */
    expect(allocation).toContain("(array_agg(map.primary_division_id))[1]");
    expect(allocation).not.toContain("max(map.primary_division_id)");
    expect(allocation).toContain("LEFT JOIN mps_customer_division_mappings map ON map.tenant_id=e.tenant_id AND map.customer_code=e.customer_code AND map.enabled=true");
    expect(allocation).toContain("division_id=excluded.division_id");
    /* 事业部变化也必须触发更新（否则新增映射不会生效）。 */
    expect(allocation).toContain("mps_order_allocations.division_id");

    const monthly = statementOf(statements, "INSERT INTO mps_monthly_plans");
    expect(monthly).toContain("a.division_id IS NOT NULL");
    /* 月计划仍然保留原来的业务键，不受影响。 */
    expect(monthly).toContain("ON CONFLICT(tenant_id,order_number,item_code) DO UPDATE SET");
  });

  it("Case J：累计入库/欠数/完成率只统计科加账套", async () => {
    const statements = await projectPlansSql();
    const recalc = statementOf(statements, "UPDATE mps_monthly_plans p SET cumulative_inbound_quantity=COALESCE(t.quantity,0)");
    expect(recalc).toContain(`AND source_database='${KEJIA}'`);
    expect(recalc).not.toContain("UFTData741219_000012");
    const reset = statementOf(statements, "SET cumulative_inbound_quantity=0");
    expect(reset).toContain(`i.source_database='${KEJIA}'`);
    /* 只重置已进入计划链（存在订单分配）的月计划，且绝不清空其他账套的判定结果。 */
    expect(reset).toContain("EXISTS(SELECT 1 FROM mps_order_allocations a");
  });

  it("Case I/J：周计划入库 FIFO 分摊同样只统计科加账套", async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new MasterPlanSyncService({ query } as never);
    await (service as any).allocateInbound(TENANT, "tester");
    const sql = String((query.mock.calls as Array<[unknown]>)[0]![0]);

    expect(sql).toContain(`AND source_database='${KEJIA}'`);
    expect(sql).not.toContain("UFTData741219_000012");
    /* 多交期 FIFO：客户最新交期 → 交期编码 → id，最早交期优先吃入库数量。 */
    expect(sql).toContain("ORDER BY w.latest_customer_due_date NULLS LAST,w.delivery_number,w.id");
    expect(sql).toContain("least(inbound_quantity-prior_planned,planned_quantity)");
  });

  it("投影计数写入同步日志（未映射客户必须可见）", async () => {
    const query = jest.fn(async (statement: string) => (String(statement).includes("AS blocked_by_missing_customer_mapping")
      ? [{ blocked_by_missing_customer_mapping: 8, division_defaulted: 0 }] : []));
    const service = new MasterPlanSyncService({ transaction: async (work: (manager: unknown) => unknown) => work({ query }) } as never);
    const outcome = await (service as any).projectPlans(TENANT, ACTOR, "tester");

    expect(outcome.metrics).toMatchObject({ blocked_by_missing_customer_mapping: 8, division_defaulted: 0 });
    expect(Object.keys(outcome.metrics).sort()).toEqual([
      "allocations", "blocked_by_missing_customer_mapping", "division_defaulted", "group_plans", "inbound_recalculated", "monthly_plans"
    ]);
  });

  it("未映射订单只产生数据异常，不进入月计划（异常仍由既有统一异常机制负责）", async () => {
    const statements = await projectPlansSql();
    const exceptions = statements.filter((statement) => statement.includes("mps_data_exceptions"));
    expect(exceptions.length).toBeGreaterThan(0);
    expect(exceptions.join("\n")).toContain("MISSING_ALLOCATION_DIVISION");
    /* 未映射客户异常继续来自 division_id IS NULL，而不是被默认值掩盖。 */
    expect(exceptions.join("\n")).toContain("FROM mps_order_allocations WHERE tenant_id=$1 AND division_id IS NULL");
  });
});
