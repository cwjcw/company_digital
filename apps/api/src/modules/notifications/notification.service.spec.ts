import { NotificationService } from "./notification.service";

const tenantId = "KAINAN";
const ruleId = "00000000-0000-7000-8000-000000000001";
const outboxId = "00000000-0000-7000-8000-000000000002";
const deliveryId = "00000000-0000-7000-8000-000000000003";

function dataSource() {
  const manager = { query: jest.fn() };
  const source = { transaction: jest.fn(async (work: (value: typeof manager) => unknown) => work(manager)) };
  return { manager, source };
}

describe("NotificationService", () => {
  it("keeps TEST MODE forced on during this phase", () => {
    const { source } = dataSource();
    const service = new NotificationService(source as never);
    expect((service as any).testMode()).toBe(true);
  });

  it("does not make a disabled business user an actual recipient", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "delivery-disabled" }])
      .mockResolvedValueOnce([{ id: "delivery-enabled" }]);
    const service = new NotificationService(source as never);
    const result = await (service as any).prepareRecipientDeliveries(
      manager, tenantId, { id: outboxId, attempts: 1 },
      [
        { userId: "00000000-0000-7000-8000-000000000011", displayName: "禁用用户", wechatUserId: "disabled", enabled: false },
        { userId: "00000000-0000-7000-8000-000000000012", displayName: "张三", wechatUserId: "zhang", enabled: true }
      ],
      { userId: "00000000-0000-7000-8000-000000000014", displayName: "崔玮杰", wechatUserId: "CuiWeiJie", enabled: true }
    );
    expect(result[0]).toMatchObject({ userId: "00000000-0000-7000-8000-000000000014", deliveryIds: ["delivery-enabled"], testMode: true });
    expect(manager.query.mock.calls.some(([, params]) => Array.isArray(params) && params.includes("SKIPPED_DISABLED"))).toBe(true);
  });

  it("resolves FIXED_USERS by stable IDs at dispatch time", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce([{ userId: "00000000-0000-7000-8000-000000000011", displayName: "张三", enabled: true, wechatUserId: "zhang" }]);
    const service = new NotificationService(source as never);
    await expect((service as any).resolveBusinessRecipients(manager, tenantId, {
      recipient_rule: "FIXED_USERS",
      config: { recipientUserIds: ["00000000-0000-7000-8000-000000000011"] }
    }, {})).resolves.toEqual([expect.objectContaining({ userId: "00000000-0000-7000-8000-000000000011" })]);
    expect(manager.query.mock.calls[0][1]).toEqual([["00000000-0000-7000-8000-000000000011"]]);
  });

  it("upserts a tenant-scoped rule and uses a stable rule key", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValue([{ id: ruleId, tenant_id: tenantId, rule_key: "equipment.failure" }]);
    const service = new NotificationService(source as never);
    const result = await service.upsertRule(tenantId, { ruleKey: "equipment.failure", name: "设备故障", eventType: "equipment.failure", channel: "WECHAT_WORK" }, { userId: null });
    expect(result).toMatchObject({ rule_key: "equipment.failure" });
    expect(String(manager.query.mock.calls[1]?.[0])).toContain("ON CONFLICT(tenant_id,rule_key)");
    expect(String(manager.query.mock.calls[0]?.[0])).toContain("set_config('app.tenant_id'");
  });

  it("deduplicates enqueue by tenant and dedup key", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: outboxId, dedup_key: "equipment:1:2026-09-23" }]);
    const service = new NotificationService(source as never);
    const result = await service.enqueue(tenantId, {
      ruleId, eventType: "equipment.failure", channel: "WECHAT_WORK", dedupKey: "equipment:1:2026-09-23", payload: { equipmentId: "asset-1" }
    });
    expect(result).toEqual({ row: { id: outboxId, dedup_key: "equipment:1:2026-09-23" }, created: false });
    expect(String(manager.query.mock.calls[1]?.[0])).toContain("ON CONFLICT(tenant_id,dedup_key) DO NOTHING");
  });

  it("claims due and stale processing rows with FOR UPDATE SKIP LOCKED", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ id: outboxId, status: "PROCESSING", attempts: 1 }]);
    const service = new NotificationService(source as never);
    await expect(service.claim(tenantId, "notification-worker-1", 20)).resolves.toHaveLength(1);
    const sql = String(manager.query.mock.calls[1]?.[0]);
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("status='PROCESSING'");
    expect(sql).toContain("attempts=outbox.attempts+1");
  });

  it("records a failed delivery and leaves a retry timestamp", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: outboxId, attempts: 2, last_error: "temporary failure" }])
      .mockResolvedValueOnce(undefined);
    const service = new NotificationService(source as never);
    await service.markFailed(tenantId, outboxId, "notification-worker-1", "temporary failure");
    const update = String(manager.query.mock.calls[1]?.[0]);
    expect(update).toContain("status='FAILED'");
    expect(update).toContain("next_retry_at=COALESCE");
    expect(String(manager.query.mock.calls[2]?.[0])).toContain("notification_delivery_logs");
  });

  it("marks only the worker's processing row as sent and logs the attempt", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: outboxId, attempts: 1, status: "SENT" }])
      .mockResolvedValueOnce(undefined);
    const service = new NotificationService(source as never);
    await service.markSent(tenantId, outboxId, "notification-worker-1", { code: "200", body: { ok: true } });
    expect(String(manager.query.mock.calls[1]?.[0])).toContain("locked_by=$3");
    expect(String(manager.query.mock.calls[2]?.[0])).toContain("notification_delivery_logs");
  });

  it("never returns an outbox row without a matching enabled rule", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: outboxId, attempts: 1, event_type: "equipment.status.fault_changed", channel: "WECHAT_WORK", payload: { equipmentId: "00000000-0000-7000-8000-000000000010" } }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: deliveryId }]);
    const service = new NotificationService(source as never);
    await expect(service.claimForDispatcher(tenantId, "dispatcher-1")).resolves.toEqual([]);
    expect(String(manager.query.mock.calls[1]?.[0])).toContain("FOR UPDATE SKIP LOCKED");
    expect(String(manager.query.mock.calls[3]?.[0])).toContain("next_retry_at=NULL");
    expect(String(manager.query.mock.calls[4]?.[0])).toContain("SKIPPED");
    expect(String(manager.query.mock.calls[1]?.[0])).toContain("historical_delivery.errcode='RECIPIENT_NOT_ALLOWED'");
  });

  it("resolves enabled equipment responsibles and creates one pending delivery per wechat user", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: outboxId, attempts: 1, notification_rule_id: null, event_type: "equipment.status.fault_changed", channel: "WECHAT_WORK", payload: { equipmentId: "00000000-0000-7000-8000-000000000010", divisionName: "事业一部", equipmentCode: "EQ-01", equipmentName: "冲床", oldFaultMinutes: 0, newFaultMinutes: 60, faultReason: "卡料", actorName: "填报人", occurredAt: "2026-09-23T10:00:00+08:00" } }])
      .mockResolvedValueOnce([{ id: ruleId, resource: "equipment-status-report", recipient_rule: "EQUIPMENT_RESPONSIBLE", config: { messageType: "text", template: "{equipmentCode}:{newFaultMinutes}" } }])
      .mockResolvedValueOnce([{ userId: "00000000-0000-7000-8000-000000000011", displayName: "崔玮杰", wechatUserId: "wx-cui" }])
      .mockResolvedValueOnce([{ userId: "00000000-0000-7000-8000-000000000011", displayName: "崔玮杰", wechatUserId: "wx-cui", enabled: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: deliveryId }])
      .mockResolvedValueOnce(undefined);
    const service = new NotificationService(source as never);
    await expect(service.claimForDispatcher(tenantId, "dispatcher-1")).resolves.toEqual([{
      notificationId: outboxId, messageType: "text", content: "EQ-01:60",
      recipients: [{ deliveryId, deliveryIds: [deliveryId], userId: "00000000-0000-7000-8000-000000000011", displayName: "崔玮杰", wechatUserId: "wx-cui", resolvedRecipientUserIds: ["00000000-0000-7000-8000-000000000011"], testMode: true }]
    }]);
    expect(String(manager.query.mock.calls[5]?.[0])).toContain("notification_delivery_logs");
    expect(String(manager.query.mock.calls[7]?.[0])).toContain("notification_rule_id=$3::uuid");
  });

  it("skips a missing wechat id without blocking other recipients", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: outboxId, attempts: 1, notification_rule_id: ruleId, event_type: "equipment.status.fault_changed", channel: "WECHAT_WORK", payload: { equipmentId: "00000000-0000-7000-8000-000000000010" } }])
      .mockResolvedValueOnce([{ id: ruleId, resource: "equipment-status-report", recipient_rule: "EQUIPMENT_RESPONSIBLE", config: {} }])
      .mockResolvedValueOnce([{ userId: "00000000-0000-7000-8000-000000000011", displayName: "无企微", wechatUserId: null }])
      .mockResolvedValueOnce([{ userId: "00000000-0000-7000-8000-000000000012", displayName: "崔玮杰", wechatUserId: "CuiWeiJie", enabled: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: deliveryId }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const service = new NotificationService(source as never);
    await expect(service.claimForDispatcher(tenantId, "dispatcher-1")).resolves.toEqual([expect.objectContaining({
      recipients: [expect.objectContaining({ userId: "00000000-0000-7000-8000-000000000012", wechatUserId: "CuiWeiJie", testMode: true })]
    })]);
    expect(manager.query.mock.calls.some(([, params]) => Array.isArray(params) && params.includes("TEST_MODE_BUSINESS_RECIPIENT_MISSING_WECHAT_ID"))).toBe(true);
  });

  it("collapses multiple business recipients into one Cui WeiJie TEST MODE delivery", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: outboxId, attempts: 1, notification_rule_id: ruleId, event_type: "equipment.status.fault_changed", channel: "WECHAT_WORK", payload: { equipmentId: "00000000-0000-7000-8000-000000000010" } }])
      .mockResolvedValueOnce([{ id: ruleId, resource: "equipment-status-report", recipient_rule: "EQUIPMENT_RESPONSIBLE", config: {} }])
      .mockResolvedValueOnce([
        { userId: "00000000-0000-7000-8000-000000000011", displayName: "张三", wechatUserId: "zhang", enabled: true },
        { userId: "00000000-0000-7000-8000-000000000012", displayName: "李四", wechatUserId: "li", enabled: true },
        { userId: "00000000-0000-7000-8000-000000000013", displayName: "王五", wechatUserId: "wang", enabled: true }
      ])
      .mockResolvedValueOnce([{ userId: "00000000-0000-7000-8000-000000000014", displayName: "崔玮杰", wechatUserId: "CuiWeiJie", enabled: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "delivery-1" }])
      .mockResolvedValueOnce([{ id: "delivery-2" }])
      .mockResolvedValueOnce([{ id: "delivery-3" }])
      .mockResolvedValueOnce(undefined);
    const service = new NotificationService(source as never);
    await expect(service.claimForDispatcher(tenantId, "dispatcher-1")).resolves.toEqual([expect.objectContaining({
      recipients: [{
        deliveryId: "delivery-1",
        deliveryIds: ["delivery-1", "delivery-2", "delivery-3"],
        userId: "00000000-0000-7000-8000-000000000014",
        displayName: "崔玮杰",
        wechatUserId: "CuiWeiJie",
        resolvedRecipientUserIds: ["00000000-0000-7000-8000-000000000011", "00000000-0000-7000-8000-000000000012", "00000000-0000-7000-8000-000000000013"],
        testMode: true
      }]
    })]);
    expect(manager.query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO notification_delivery_logs"))).toHaveLength(3);
  });

  it("keeps an outbox retryable after one recipient fails while another is pending", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: outboxId, status: "PROCESSING" }])
      .mockResolvedValueOnce([{ status: "RETRY_PENDING", count: 1 }, { status: "PENDING", count: 1 }])
      .mockResolvedValueOnce([{ id: outboxId, status: "PROCESSING" }]);
    const service = new NotificationService(source as never);
    await expect(service.markDeliveryFailure(tenantId, outboxId, "dispatcher-1", { deliveryId, errcode: "500", errmsg: "temporary" })).resolves.toMatchObject({ status: "PROCESSING" });
    const updateSql = String(manager.query.mock.calls[1]?.[0]);
    const updateParams = manager.query.mock.calls[1]?.[1] as unknown[];
    expect(updateSql).toContain("outbox.id=$2::uuid");
    expect(updateSql).toContain("delivery.id=ANY($4::uuid[])");
    expect(updateSql).not.toContain("$10");
    expect(updateParams).toHaveLength(9);
    expect(String(manager.query.mock.calls[3]?.[0])).toContain("status=$4::varchar");
  });
});
