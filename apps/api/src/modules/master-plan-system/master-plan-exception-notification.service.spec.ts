import { MasterPlanExceptionNotificationService } from "./master-plan-exception-notification.service";

describe("MasterPlanExceptionNotificationService", () => {
  const tenant = "KAINAN";
  const manager = { query: jest.fn() } as any;
  const notifications = { enqueueGroupEvent: jest.fn().mockResolvedValue({ created: true }) };
  let service: MasterPlanExceptionNotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    manager.query.mockImplementation(async (sql: string) => {
      if (sql.includes("notification_routes")) return [{ ready: true }];
      if (sql.includes("SELECT name FROM organization_units")) return [{ name: "事业一部" }];
      if (sql.includes("FROM (SELECT $2::varchar business_key")) return [{ order_number: "ORD-2", item_code: "ITEM-2", item_name: "零件", allocated_quantity: "8", division: "事业二部", monthly_quantity: "8", base_quantity: "8" }];
      return [];
    });
    service = new MasterPlanExceptionNotificationService({ transaction: jest.fn() } as any, notifications as any);
  });

  it("queues only an exception-version keyed group notice with business details", async () => {
    await service.enqueueDemandConflict(manager, tenant, { exception_key: "demand-consistency:hash", exception_type: "DEMAND_CONSISTENCY_BLOCKED", version: 4 }, {
      allocations: [{ order_number: "ORD-1", item_code: "ITEM-1", item_name: "部件", allocated_quantity: "8", division_id: "division-id" }],
      monthly: { required_quantity: "8" }, bases: [{ planned_quantity: "6" }, { planned_quantity: "2" }], reasons: ["基础计划需求差异"]
    });
    const [tenantId, event] = notifications.enqueueGroupEvent.mock.calls[0];
    expect(tenantId).toBe(tenant);
    expect(event.eventType).toBe("mps.sync_exception.immediate");
    expect(event.dedupKey).toBe("mps-exception:demand-consistency:hash:4");
    expect(event.components[0].content).toContain("订单号：ORD-1");
    expect(event.components[0].content).toContain("分配数量：8");
    expect(event.components[0].content).toContain("基础计划数量：8");
    expect(event.components[0].content).not.toContain("division-id");
  });

  it("creates a single summary event for the historical baseline", async () => {
    manager.query.mockImplementation(async (sql: string) => {
      if (sql.includes("notification_routes")) return [{ ready: true }];
      if (sql.includes("count(*) FILTER")) return [{ total: 323, created_today: 0, resolved_today: 0, priority: 0, retry_exhausted: 0 }];
      if (sql.includes("GROUP BY org.name")) return [{ name: "事业一部", count: 323 }];
      return [];
    });
    await service.queueSummary(manager, tenant, "initial", "2026-11-15");
    const [, event] = notifications.enqueueGroupEvent.mock.calls[0];
    expect(event.eventType).toBe("mps.sync_exception.daily_summary");
    expect(event.dedupKey).toBe("mps-exception-summary:initial:first-baseline");
    expect(event.components).toHaveLength(1);
    expect(event.components[0].content).toContain("当前未解决异常：323");
    expect(event.components[0].content).not.toContain("UUID");
  });

  it("does not enqueue a summary before an enabled, encrypted group route exists", async () => {
    manager.query.mockImplementation(async (sql: string) => sql.includes("notification_routes") ? [] : []);
    await expect(service.queueSummary(manager, tenant, "daily", "2026-11-15")).resolves.toMatchObject({ routeMissing: true });
    expect(notifications.enqueueGroupEvent).not.toHaveBeenCalled();
  });

  it("queues terminal retry exhaustion with business details and a versioned dedup key", async () => {
    await service.enqueueOutboxRetryLimit(manager, tenant, {
      id: "internal-outbox-id", version: 7, actor_id: null, business_key: "ORD-2/ITEM-2",
      record_id: null, scope_json: { allocationKey: { orderNumber: "ORD-2", itemCode: "ITEM-2" } }
    });
    const [, event] = notifications.enqueueGroupEvent.mock.calls[0];
    expect(event.dedupKey).toBe("mps-outbox-retry:internal-outbox-id:7");
    expect(event.components[0].content).toContain("订单号：ORD-2");
    expect(event.components[0].content).toContain("自动重试耗尽");
    expect(event.components[0].content).not.toContain("internal-outbox-id");
  });
});
