import { MasterPlanSyncService } from "./master-plan.sync.service";
import { MASTER_PLAN_ERP_ADMISSION } from "./master-plan.erp-admission";

const TENANT = "KAINAN";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const KEJIA = MASTER_PLAN_ERP_ADMISSION.sourceDatabase;

/** 捕获 projectOrders 生成的全部 SQL 与参数（不改库：全部走 mock）。 */
async function projectOrdersCalls() {
  const query = jest.fn().mockResolvedValue([]);
  const dataSource = { query: jest.fn().mockResolvedValue([{ watermark_at: null }]), transaction: async (work: (manager: unknown) => unknown) => work({ query }) };
  const service = new MasterPlanSyncService(dataSource as never);
  await (service as any).projectOrders(TENANT, ACTOR, "tester");
  return (query.mock.calls as Array<[unknown, unknown[]?]>).map(([statement, params]) => ({ sql: String(statement), params: params ?? [] }));
}

const sqlOf = (calls: Array<{ sql: string }>) => calls.map((call) => call.sql);
const statementOf = (statements: string[], needle: string) => statements.find((statement) => statement.includes(needle))!;

/**
 * KN-MPS-LIVE-002 验收矩阵（Case A–J）。
 * SQL 结构断言与真实数据库行为一致：准入谓词、来源身份判定、快照业务键抑制、计划链保护都在同一份生成 SQL 上锁定。
 */
describe("KN-MPS-LIVE-002 master plan live admission", () => {
  it("Case C：只读科加账套，其他账套不得进入主计划", async () => {
    const statements = sqlOf(await projectOrdersCalls());
    const joined = statements.join("\n");
    /* 每一条读写 ERP 的语句都必须带账套白名单（计数语句在 CTE 内使用 s 别名）。 */
    const erpStatements = statements.filter((statement) => statement.includes("FROM sales_orders o"));
    expect(erpStatements).toHaveLength(4);
    for (const statement of erpStatements) expect(statement).toContain(`source_database='${KEJIA}'`);
    expect(joined).toContain(`o.source_database='${KEJIA}'`);
    expect(joined).toContain(`s.source_database='${KEJIA}'`);
    /* 其他账套完全不出现在任何语句里。 */
    expect(joined).not.toContain("E10_6.0.0.1.NEW.CHS");
    expect(joined).not.toContain("UFTData741219_000012");
    expect(joined).not.toContain("'E10'");
  });

  it("Case B：下单日期水位只约束新来源身份，已准入记录仍然可更新", async () => {
    const upsert = statementOf(sqlOf(await projectOrdersCalls()), "INSERT INTO mps_erp_order_lines");
    /* 业务准入条件使用 order_date，不是 created_at / updated_at。 */
    expect(upsert).toContain("o.order_date >= DATE '2026-09-17'");
    expect(upsert).not.toContain("o.created_at");
    /* 9月16日历史订单即使今天被修改：既没有自有身份也没有别名时，ON CONFLICT 分支不可达（不满足 ON CONFLICT 目标键）。 */
    const identityBranch = upsert.indexOf("EXISTS (SELECT 1 FROM mps_erp_order_lines t WHERE t.tenant_id=$1 AND t.source_system=");
    const dateBranch = upsert.indexOf("o.order_date >= DATE '2026-09-17'");
    expect(identityBranch).toBeGreaterThan(-1);
    expect(identityBranch).toBeLessThan(dateBranch);
    /* 日期水位只出现在「新来源身份」的 OR 分支里，不出现在 WHERE 顶层。 */
    const topLevel = upsert.split("WHERE ").slice(1).join("WHERE ").split("AND (\n              EXISTS")[0]!;
    expect(topLevel).not.toContain("2026-09-17");
  });

  it("Case F：已关闭/已完成/已作废不得作为新订单准入，且状态决定 source_active", async () => {
    const statements = sqlOf(await projectOrdersCalls());
    const upsert = statementOf(statements, "INSERT INTO mps_erp_order_lines");
    expect(upsert).toContain("o.close_status NOT IN ('已关闭','已完成','已作废')");
    expect(upsert).toContain("AS source_active");
    expect(upsert).toContain("source_active=excluded.source_active");
    /* 关闭只更新来源状态字段，不删除任何计划链数据。 */
    expect(statements.join("\n")).not.toMatch(/DELETE\s+FROM/i);
  });

  it("Case D：新来源身份命中历史快照业务键时只建立别名，绝不 INSERT 第二条", async () => {
    const calls = await projectOrdersCalls();
    const statements = sqlOf(calls);
    const bind = statementOf(statements, "INSERT INTO mps_order_line_source_aliases");
    expect(bind).toContain("t.order_number=o.order_number AND t.item_code=o.item_number");
    expect(bind).toContain("t.source_system IN ('KDOS_INIT')");
    expect(bind).toContain("NOT EXISTS (SELECT 1 FROM mps_erp_order_lines t WHERE t.tenant_id=$1 AND t.source_system=");
    expect(bind).toContain("ON CONFLICT(tenant_id,source_system,source_database,source_key) DO NOTHING");
    /* 绑定原因作为参数写入（避免 SQL 字面量拼装）。 */
    expect(calls.find((call) => call.sql.includes("INSERT INTO mps_order_line_source_aliases"))!.params[3]).toBe("SNAPSHOT_BUSINESS_KEY_MATCH");
    expect(calls.find((call) => call.sql.includes("INSERT INTO mps_order_line_source_aliases"))!.params[2]).toBe("tester");
    /* 绑定后由 ERP 更新原记录：upsert 必须排除已绑定别名的来源身份。 */
    const upsert = statementOf(statements, "INSERT INTO mps_erp_order_lines");
    expect(upsert).toContain("NOT EXISTS (SELECT 1 FROM mps_order_line_source_aliases a");
  });

  it("Case E：已有来源身份（自有或别名）发生修改 → UPDATE 原记录，不新增第二条", async () => {
    const statements = sqlOf(await projectOrdersCalls());
    const byAlias = statementOf(statements, "UPDATE mps_erp_order_lines t SET");
    expect(byAlias).toContain("JOIN mps_order_line_source_aliases a ON a.tenant_id=$1");
    expect(byAlias).toContain("t.id=p.mps_order_line_id");
    expect(byAlias).toContain("IS DISTINCT FROM");
    /* 明细行身份绝不因更新而改变（保护已产生的计划链业务键）。 */
    const setClause = byAlias.split("SET")[1]!.split("FROM")[0]!;
    expect(setClause).not.toContain("order_number=");
    expect(setClause).not.toContain("item_code=");
    /* 自有身份的 upsert 以来源身份为冲突目标，不是订单号 + 品项。 */
    const upsert = statementOf(statements, "INSERT INTO mps_erp_order_lines");
    expect(upsert).toContain("ON CONFLICT(tenant_id,source_system,source_database,source_key) DO UPDATE SET");
    expect(upsert).not.toContain("ON CONFLICT(tenant_id,order_number,item_code)");
  });

  it("Case G/H-保护：实时同步绝不触碰计划链与人工字段", async () => {
    const joined = sqlOf(await projectOrdersCalls()).join("\n");
    for (const table of ["mps_monthly_plans", "mps_shipping_plans", "mps_base_plans", "mps_weekly_plans", "mps_weekly_process_plans",
      "mps_three_day_work_orders", "mps_technical_reports", "mps_material_reports", "mps_outsourcing_reports", "mps_process_reports"]) {
      expect(joined).not.toContain(table);
    }
    /* Planning-owned 字段（事业部/生产方式/产品属性/表面性质/评审日期）绝不出现在 ERP 投影里。 */
    for (const column of ["division_id", "manufacturing_method", "product_attribute", "surface_nature", "latest_review_due_date",
      "blank_completion_date", "packaging_completion_date", "remark", "processing_remark"]) {
      expect(joined).not.toContain(column);
    }
  });

  it("§29：同步日志必须给出全部扫描/准入/阻断计数，且第二次运行新增与重复都为 0", async () => {
    const query = jest.fn(async (statement: string) => {
      const sql = String(statement);
      if (sql.includes("INSERT INTO mps_order_line_source_aliases")) return [{ id: "alias-1" }, { id: "alias-2" }];
      if (sql.includes("UPDATE mps_erp_order_lines t SET")) return [{ id: "line-1" }];
      if (sql.includes("INSERT INTO mps_erp_order_lines")) return [{ id: "line-2", inserted: false }, { id: "line-3", inserted: true }];
      if (sql.includes("AS scanned")) return [{ scanned: 121485, eligible: 5, blocked_by_source_database: 103280, blocked_by_order_date: 3, blocked_by_status: 1, blocked_by_watermark: 0 }];
      return [];
    });
    const dataSource = { query: jest.fn().mockResolvedValue([{ watermark_at: null }]), transaction: async (work: (manager: unknown) => unknown) => work({ query }) };
    const service = new MasterPlanSyncService(dataSource as never);

    const first = await (service as any).projectOrders(TENANT, ACTOR, "tester");
    expect(Object.keys(first.metrics).sort()).toEqual([
      "alias_bound", "blocked_by_order_date", "blocked_by_source_database", "blocked_by_status", "blocked_by_watermark",
      "duplicate_suppressed", "eligible", "inserted", "scanned", "unchanged", "updated"
    ]);
    expect(first.metrics).toMatchObject({
      scanned: 121485, eligible: 5, inserted: 1, updated: 2, unchanged: 2, duplicate_suppressed: 2, alias_bound: 2,
      blocked_by_source_database: 103280, blocked_by_order_date: 3, blocked_by_status: 1, blocked_by_watermark: 0
    });
    expect(first.count).toBe(3);

    /* 第二次运行：ERP 无变化 → 没有新别名、没有写入、业务数据不变。 */
    const second = jest.fn(async (statement: string) => {
      const sql = String(statement);
      if (sql.includes("AS scanned")) return [{ scanned: 121485, eligible: 5, blocked_by_source_database: 103280, blocked_by_order_date: 3, blocked_by_status: 1, blocked_by_watermark: 0 }];
      return [];
    });
    const idleService = new MasterPlanSyncService({ query: jest.fn().mockResolvedValue([{ watermark_at: null }]), transaction: async (work: (manager: unknown) => unknown) => work({ query: second }) } as never);
    const repeat = await (idleService as any).projectOrders(TENANT, ACTOR, "tester");
    expect(repeat.metrics).toMatchObject({ inserted: 0, updated: 0, duplicate_suppressed: 0, alias_bound: 0, unchanged: 5 });
    expect(repeat.count).toBe(0);
  });

  it("cutover watermark 只约束新来源身份，默认关闭", async () => {
    const withoutWatermark = sqlOf(await projectOrdersCalls()).join("\n");
    expect(withoutWatermark).not.toContain("$4::timestamptz");

    const query = jest.fn().mockResolvedValue([]);
    const service = new MasterPlanSyncService({
      query: jest.fn().mockResolvedValue([{ watermark_at: "2026-09-17T16:00:00.000Z" }]),
      transaction: async (work: (manager: unknown) => unknown) => work({ query })
    } as never);
    await (service as any).projectOrders(TENANT, ACTOR, "tester");
    const withWatermark = (query.mock.calls as Array<[unknown]>).map(([statement]) => String(statement)).join("\n");
    expect(withWatermark).toContain("o.updated_at > $4::timestamptz");
  });
});
