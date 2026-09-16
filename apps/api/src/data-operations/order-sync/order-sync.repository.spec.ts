import { OrderSyncRepository } from "./order-sync.repository";
import type { SyncActor } from "./order-sync.types";

const actor: SyncActor = { userId: "11111111-1111-4111-8111-111111111111", displayName: "tester", requestId: "request-1", source: "API" };
const consumer = {
  consumer_key: "sales-orders-v1", enabled: true, record_types: ["ORDER_HEADER", "ORDER_LINE", "DELIVERY_PLAN"], batch_size: 1000,
  last_event_created_at_exact: "2026-09-15 04:30:01.647718+00", last_event_id: "01a0a354-3baf-7b72-aeeb-bb987954cac1",
  lease_token: "11111111-2222-4333-8444-555555555555", lease_expires_at: "2026-09-16T03:00:00.000Z", in_flight_event_id: "01a0a354-3baf-7b72-aeeb-bb987954cac1"
};
const idleConsumer = { ...consumer, lease_token: null, lease_expires_at: null, in_flight_event_id: null, in_flight_event_created_at: null, next_retry_at: null };

function fakeDataSource(replies: unknown[][]) {
  const statements: string[] = [];
  const query = jest.fn(async (sql: string) => {
    statements.push(String(sql));
    if (String(sql).includes("set_config")) return [];
    return replies.length ? replies.shift() : [];
  });
  const manager = { query };
  return { statements, dataSource: { query, transaction: (work: (value: typeof manager) => unknown) => work(manager) } };
}

const statementContaining = (statements: string[], needle: string) => statements.find((sql) => sql.includes(needle)) ?? "";

describe("OrderSyncRepository projection cursor and lease", () => {
  it("claims the next batch with a stable (created_at, id) cursor so no event is skipped or repeated", async () => {
    const { dataSource, statements } = fakeDataSource([[idleConsumer], [{ eventId: "e1" }], [{ token: "lease-1" }], []]);
    const result = await new OrderSyncRepository(dataSource as never).claimProjectionBatch("sales-orders-v1", actor);
    const claim = statementContaining(statements, "FROM erp_change_events e JOIN erp_staging_raw_records r");

    expect(result.leaseToken).toBe("lease-1");
    expect(claim).toContain("e.created_at>COALESCE($3::timestamptz");
    expect(claim).toContain("e.created_at=COALESCE($3::timestamptz,'epoch'::timestamptz) AND e.id>COALESCE($4::uuid");
    expect(claim).toContain("ORDER BY e.created_at,e.id LIMIT $5");
    expect(claim).not.toContain(">=");
    expect(claim).toContain("e.tenant_id=$1");
    expect(statementContaining(statements, "SET status='RUNNING',lease_token=$3")).toContain("in_flight_event_id=$5");
  });

  it("only advances the projection cursor after a completed batch", async () => {
    const { dataSource, statements } = fakeDataSource([[consumer], []]);
    const result = await new OrderSyncRepository(dataSource as never).completeProjectionBatch("sales-orders-v1", consumer.lease_token, actor);
    const update = statementContaining(statements, "UPDATE erp_projection_consumers");

    expect(result.completed).toBe(true);
    expect(update).toContain("last_event_created_at=in_flight_event_created_at,last_event_id=in_flight_event_id");
    expect(update).toContain("retry_count=0");
    expect(update).toContain("tenant_id=$1 AND consumer_key=$2");
  });

  it("keeps the cursor unchanged when a projection batch fails so the same events are retried", async () => {
    const { dataSource, statements } = fakeDataSource([[consumer], []]);
    const result = await new OrderSyncRepository(dataSource as never).failProjectionBatch("sales-orders-v1", consumer.lease_token, "ON CONFLICT DO UPDATE command cannot affect row a second time", actor);
    const update = statementContaining(statements, "UPDATE erp_projection_consumers");

    expect(result.failed).toBe(true);
    expect(update).toContain("status='FAILED'");
    expect(update).toContain("retry_count=retry_count+1");
    expect(update).toContain("next_retry_at=now()+make_interval");
    expect(update).not.toContain("last_event_created_at=");
    expect(update).not.toContain("last_event_id=");
  });

  it("rejects a second concurrent claim while a lease is still active", async () => {
    const live = { ...consumer, lease_expires_at: new Date(Date.now() + 60_000).toISOString() };
    const { dataSource } = fakeDataSource([[live]]);

    await expect(new OrderSyncRepository(dataSource as never).claimProjectionBatch("sales-orders-v1", actor)).rejects.toThrow("投影订阅已有运行中的租约");
  });

  it("keeps the projection inside the failure backoff instead of re-running the same failing batch", async () => {
    const waiting = { ...consumer, lease_token: null, next_retry_at: new Date(Date.now() + 60_000).toISOString() };
    const { dataSource } = fakeDataSource([[waiting]]);

    await expect(new OrderSyncRepository(dataSource as never).claimProjectionBatch("sales-orders-v1", actor)).rejects.toThrow("投影订阅仍在失败退避期");
  });
});
