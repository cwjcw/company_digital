import { MasterPlanSyncService } from "./master-plan.sync.service";

const TENANT = "KAINAN";
const ACTOR = "33333333-3333-4333-8333-333333333333";

async function projectOrdersStatements() {
  const query = jest.fn().mockResolvedValue([]);
  const dataSource = { query: jest.fn().mockResolvedValue([{ watermark_at: null }]), transaction: async (work: (manager: unknown) => unknown) => work({ query }) };
  const service = new MasterPlanSyncService(dataSource as never);
  await (service as any).projectOrders(TENANT, ACTOR, ACTOR);
  return (query.mock.calls as Array<[unknown]>).map(([statement]) => String(statement));
}

const statementOf = (statements: string[], needle: string) => statements.find((statement) => statement.includes(needle))!;

/**
 * KN-MPS-LIVE-003-01 修复回归：首次 alias 绑定不回写历史初始化数据。
 *
 * 判定 ERP 是否发生变化的唯一依据必须是 canonical 来源的内容更新时间
 * （`sales_orders.updated_at` → `source_updated_at`）与 `alias.bound_at` 的比较，
 * 绝不使用目标表 `mps_erp_order_lines.updated_at`。
 */
describe("KN-MPS-LIVE-003-01 deferred snapshot write-back", () => {
  it("Case 1/5：首次快照绑定只建立 alias，不产生任何回写（即使 ERP 值与快照不同）", async () => {
    const statements = await projectOrdersStatements();
    const bind = statementOf(statements, "INSERT INTO mps_order_line_source_aliases");
    const writeBack = statementOf(statements, "UPDATE mps_erp_order_lines t SET");

    /* 绑定只写 alias 表：绝不触碰 mps_erp_order_lines 的业务字段、updated_at 或 version。 */
    expect(bind).toContain("INSERT INTO mps_order_line_source_aliases");
    expect(bind).not.toContain("UPDATE mps_erp_order_lines");
    expect(bind).toContain("ON CONFLICT(tenant_id,source_system,source_database,source_key) DO NOTHING");

    /* 回写必须要求「canonical 变更时间严格晚于绑定时刻」；新建 alias 的 bound_at=now() → 永远不满足。 */
    expect(writeBack).toContain("a.bound_at");
    expect(writeBack).toContain("p.source_updated_at IS NOT NULL AND p.source_updated_at > p.bound_at");
    expect(writeBack).not.toMatch(/[\s(]t\.updated_at\s*[<>]/);
    expect(writeBack).not.toContain("p.bound_at >= p.source_updated_at");
    expect(writeBack).not.toContain(">= p.bound_at");
  });

  it("Case 2：绑定后 ERP 无变化 → 时间戳相等/更早都不回写（严格大于）", async () => {
    const writeBack = statementOf(await projectOrdersStatements(), "UPDATE mps_erp_order_lines t SET");

    /* 严格大于：updated_at == bound_at（同一次采集）不更新。 */
    expect(writeBack).toContain("p.source_updated_at > p.bound_at");
    expect(writeBack).not.toContain("p.source_updated_at >= p.bound_at");
    /* 仍然保留差异守卫：即使时间更新，字段完全一致也不会写库（避免无意义 updated_at/version 变化）。 */
    expect(writeBack).toContain("IS DISTINCT FROM");
  });

  it("Case 3：绑定后 canonical 真实变化 → 允许 UPDATE 原记录，且只更新 ERP-owned 字段", async () => {
    const writeBack = statementOf(await projectOrdersStatements(), "UPDATE mps_erp_order_lines t SET");

    /* 变化判定来自 canonical（source_updated_at），并带上「同一条初始化行绑定多条 ERP 明细时优先取已变化那条」的排序。 */
    expect(writeBack).toContain("ORDER BY a.mps_order_line_id,(o.updated_at > a.bound_at) DESC,o.updated_at DESC NULLS LAST,o.id DESC");
    /* 变化时间写回目标行，供后续追溯。 */
    expect(writeBack).toContain("source_updated_at=p.source_updated_at");
    expect(writeBack).toContain("version=t.version+1");
    /* 明细身份字段不随 ERP 变化，保护既有计划链业务键。 */
    const setClause = writeBack.split("SET")[1]!.split("FROM")[0]!;
    expect(setClause).not.toContain("order_number=");
    expect(setClause).not.toContain("item_code=");
    /* Planning-owned 字段绝不出现在回写语句里。 */
    for (const column of ["division_id", "manufacturing_method", "product_attribute", "surface_nature", "latest_review_due_date",
      "blank_completion_date", "packaging_completion_date", "remark", "processing_remark", "inspection_required"]) {
      expect(writeBack).not.toContain(column);
    }
  });

  it("Case 4：新订单 INSERT 路径不受本次修复影响（仍走 LIVE-002 准入）", async () => {
    const upsert = statementOf(await projectOrdersStatements(), "INSERT INTO mps_erp_order_lines");

    expect(upsert).toContain("o.order_date >= DATE '2026-09-17'");
    expect(upsert).toContain("o.close_status NOT IN ('已关闭','已完成','已作废')");
    expect(upsert).toContain("o.source_database='UFTData418971_000003'");
    expect(upsert).toContain("ON CONFLICT(tenant_id,source_system,source_database,source_key) DO UPDATE SET");
    /* 新订单路径不涉及 alias 绑定时间。 */
    expect(upsert).not.toContain("bound_at");
  });

  it("绑定与回写共用同一事务顺序：先绑定（now()）后回写，因此首次运行 updated 必然为 0", async () => {
    const statements = await projectOrdersStatements();
    const bindIndex = statements.findIndex((statement) => statement.includes("INSERT INTO mps_order_line_source_aliases"));
    const writeBackIndex = statements.findIndex((statement) => statement.includes("UPDATE mps_erp_order_lines t SET"));

    expect(bindIndex).toBeGreaterThanOrEqual(0);
    expect(writeBackIndex).toBeGreaterThan(bindIndex);
    /* 绑定写入的 bound_at 使用数据库 now()（事务时间），而 canonical updated_at 不可能晚于该时刻。 */
    expect(statementOf(statements, "INSERT INTO mps_order_line_source_aliases")).toContain("now()");
  });
});
