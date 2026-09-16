import { FormalProjectionRepository } from "./formal-projection.repository";
import type { ProjectionRecord, SyncActor } from "./order-sync.types";

const actor: SyncActor = { userId: "11111111-1111-4111-8111-111111111111", displayName: "tester", requestId: "request-1", source: "API" };
const record = (overrides: Partial<ProjectionRecord> = {}): ProjectionRecord => ({
  eventId: "22222222-2222-4222-8222-222222222222", eventCreatedAt: "2026-09-15T06:00:01.000Z", operation: "UPSERT", recordVersion: 2,
  sourceSystem: "E10", sourceDatabase: "E10_6.0.0.1.NEW.CHS", sourceTable: "ORDER_LINE", sourceId: "33333333-3333-4333-8333-333333333333",
  recordType: "ORDER_LINE", sourceOrderId: "44444444-4444-4444-8444-444444444444", orderNumber: "S-2609040", ...overrides
});

function runSalesOrderProjection(records: ProjectionRecord[], replies: unknown[] = []) {
  const statements: string[] = [];
  const query = jest.fn(async (sql: string) => { statements.push(String(sql)); return replies.length ? replies.shift() : []; });
  const repository = new FormalProjectionRepository({} as never);
  const run = (repository as any).applySalesOrders({ query } as never, records, actor) as Promise<unknown>;
  return { run, statements };
}

const statementStartingWith = (statements: string[], prefix: string) => statements.find((sql) => sql.trim().startsWith(prefix)) ?? "";

describe("FormalProjectionRepository sales-orders-v1 identity alignment", () => {
  it("groups order_items by the on-conflict identity so merged ERP lines cannot target one row twice", async () => {
    const { run, statements } = runSalesOrderProjection([record()]);
    await run;
    const items = statementStartingWith(statements, "WITH lines AS (");

    expect(items).toContain("ON CONFLICT(period_id,order_id,item_number) DO UPDATE");
    expect(items).toContain("GROUP BY line.source_database,line.order_number,line.item_code,line.period_date");
    /* 目标唯一键是（期间、订单、品项）；品名与客户字段进入分组维度会让同一目标行在一次 INSERT 中被写两次。 */
    expect(items).not.toMatch(/GROUP BY[^)]*item_name/);
    expect(items).not.toMatch(/GROUP BY[^)]*customer/);
    expect(items).not.toMatch(/GROUP BY[^)]*source_order_id/);
  });

  it("merges duplicate ERP lines with deterministic rules: quantity summed, earliest due date, latest text", async () => {
    const { run, statements } = runSalesOrderProjection([record()]);
    await run;
    const items = statementStartingWith(statements, "WITH lines AS (");

    expect(items).toContain("sum(COALESCE(line.quantity,0)) quantity");
    expect(items).toContain("min(line.delivery_date) delivery_date");
    expect(items).toContain("(array_agg(line.item_name ORDER BY line.modified_at DESC NULLS LAST,line.source_id DESC))[1] item_name");
    expect(items).toContain("(array_agg(COALESCE(NULLIF(line.customer_name,''),line.customer_code) ORDER BY line.modified_at DESC NULLS LAST,line.source_id DESC))[1] customer_name");
    expect(items).toContain("(array_agg(line.source_order_id ORDER BY line.modified_at DESC NULLS LAST,line.source_id DESC))[1] source_order_id");
  });

  it("keeps the orders identity aligned with (source_database, order_number) while every ERP line stays distinct", async () => {
    const { run, statements } = runSalesOrderProjection([record()]);
    await run;
    const orders = statementStartingWith(statements, "WITH headers AS (");
    const lines = statementStartingWith(statements, "WITH affected_lines AS (");

    expect(orders).toContain("SELECT DISTINCT ON(r.source_database,r.order_number)");
    expect(orders).not.toContain("DISTINCT ON(r.source_system,r.source_database,r.source_order_id)");
    expect(orders).toContain("ON CONFLICT(source_database,order_number) WHERE source_database IS NOT NULL");
    expect(orders).toContain("LEFT JOIN line_summary lines ON lines.source_database=h.source_database AND lines.order_number=h.order_number");

    /* sales_orders 的行身份是 ERP 行主键：同一订单号下的多条 ERP 行必须全部保留，不得去重。 */
    expect(lines).toContain("ON CONFLICT(source_system,source_database,source_key) WHERE source_key IS NOT NULL");
    expect(lines).toContain("line.source_id");
    expect(lines).not.toContain("DISTINCT");
  });

  it("matches affected orders with EXISTS so one staging row is never fanned out twice", async () => {
    const { run, statements } = runSalesOrderProjection([record()]);
    await run;
    const body = statements.filter((sql) => sql.includes("erp_staging_raw_records")).join("\n");

    expect(body).not.toContain("JOIN projection_affected_orders");
    expect(body.match(/EXISTS \(SELECT 1 FROM projection_affected_orders a/g)?.length).toBe(5);
  });

  it("rejects the batch with a descriptive error when duplicated line targets are detected", async () => {
    const duplicate = [{ duplicate_key: "E10|E10_6.0.0.1.NEW.CHS|33333333-3333-4333-8333-333333333333", duplicate_count: 2, sample_source_ids: "33333333-3333-4333-8333-333333333333" }];
    const { run } = runSalesOrderProjection([record()], [[], duplicate]);

    await expect(run).rejects.toThrow(/正式投影 sales-orders-v1 输入存在重复目标键，已阻止写入/);
    await expect(run).rejects.toThrow(/count=2, sourceIds=33333333-3333-4333-8333-333333333333/);
  });

  it("keeps every upsert tenant scoped and free of DISTINCT based duplicate hiding", async () => {
    const { run, statements } = runSalesOrderProjection([record()]);
    await run;
    const upserts = statements.filter((sql) => sql.includes("INSERT INTO orders") || sql.includes("INSERT INTO sales_orders") || sql.includes("INSERT INTO order_items"));

    expect(upserts).toHaveLength(3);
    for (const sql of upserts) {
      expect(sql).toContain("tenant_id=$1");
      expect(sql).toContain("ON CONFLICT");
      /* 只有 orders 表头按目标身份取最新一条使用 DISTINCT ON；不存在用 SELECT DISTINCT 掩盖重复行的写法。 */
      expect(sql).not.toMatch(/SELECT DISTINCT (?!ON\b)/);
    }
  });
});
