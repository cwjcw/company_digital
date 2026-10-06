import { NotificationService } from "./notification.service";
import { notificationEventDefinition } from "./notification-event.registry";

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
  it("skips disabled users and creates a delivery for each enabled user", async () => {
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
      ]
    );
    expect(result).toEqual([{ deliveryId: "delivery-enabled", userId: "00000000-0000-7000-8000-000000000012", displayName: "张三", wechatUserId: "zhang" }]);
    expect(manager.query.mock.calls.some(([, params]) => Array.isArray(params) && params.includes("SKIPPED_DISABLED"))).toBe(true);
  });

  it("skips an enabled user without a WeCom UserId", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "delivery-skipped" }]);
    const service = new NotificationService(source as never);
    await expect((service as any).prepareRecipientDeliveries(manager, tenantId, { id: outboxId, attempts: 1 }, [
      { userId: "00000000-0000-7000-8000-000000000011", displayName: "无企微", wechatUserId: null, enabled: true }
    ])).resolves.toEqual([]);
    expect(manager.query.mock.calls.some(([, params]) => Array.isArray(params) && params.includes("SKIPPED_MISSING_WECHAT_ID"))).toBe(true);
  });

  it("resolves FIXED_USERS by stable IDs at dispatch time", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce([{ userId: "00000000-0000-7000-8000-000000000011", displayName: "张三", enabled: true, wechatUserId: "zhang" }]);
    const service = new NotificationService(source as never);
    await expect((service as any).resolveRecipients(manager, tenantId, {
      recipient_rule: "FIXED_USERS",
      config: { recipientUserIds: ["00000000-0000-7000-8000-000000000011"] }
    }, notificationEventDefinition("equipment.status.fault_changed"), {})).resolves.toEqual([expect.objectContaining({ userId: "00000000-0000-7000-8000-000000000011" })]);
    expect(manager.query.mock.calls[0][1]).toEqual([["00000000-0000-7000-8000-000000000011"]]);
  });

  it("resolves mixed organization, role and employee targets dynamically and keeps stable user IDs", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce([
      { id: "org-root", parent_id: null, name: "事业一部", enabled: true },
      { id: "org-child", parent_id: "org-root", name: "五金车间", enabled: true },
      { id: "org-other", parent_id: null, name: "事业二部", enabled: true }
    ]).mockResolvedValueOnce([{ organization_unit_id: "org-root" }]).mockResolvedValueOnce([
      { userId: "user-1", displayName: "张三", wechatUserId: "zhang", enabled: true },
      { userId: "user-2", displayName: "李四", wechatUserId: "li", enabled: false }
    ]);
    const service = new NotificationService(source as never);
    const result = await (service as any).resolveConfiguredRecipients(manager, [
      { type: "ORGANIZATION", organizationUnitId: "org-child", includeDescendants: false },
      { type: "ROLE", roleId: "role-1" },
      { type: "USER", userId: "user-1" }
    ]);
    expect(result).toEqual([
      { userId: "user-1", displayName: "张三", wechatUserId: "zhang", enabled: true },
      { userId: "user-2", displayName: "李四", wechatUserId: "li", enabled: false }
    ]);
    expect(String(manager.query.mock.calls[2]?.[0])).toContain("SELECT DISTINCT u.id");
    expect(String(manager.query.mock.calls[2]?.[0])).toContain("department_paths");
  });

  it("resolves an organization target from the current organization subtree", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce([
      { id: "org-root", parent_id: null, name: "事业一部", enabled: true },
      { id: "org-child", parent_id: "org-root", name: "五金车间", enabled: true }
    ]).mockResolvedValueOnce([
      { userId: "user-1", displayName: "张三", wechatUserId: "zhang", enabled: true },
      { userId: "user-2", displayName: "李四", wechatUserId: "li", enabled: true }
    ]);
    const service = new NotificationService(source as never);
    await expect((service as any).resolveConfiguredRecipients(manager, [
      { type: "ORGANIZATION", organizationUnitId: "org-root", includeDescendants: true }
    ])).resolves.toEqual([
      { userId: "user-1", displayName: "张三", wechatUserId: "zhang", enabled: true },
      { userId: "user-2", displayName: "李四", wechatUserId: "li", enabled: true }
    ]);
    expect(String(manager.query.mock.calls[1]?.[0])).toContain("department_paths");
    expect(manager.query.mock.calls[1]?.[1]).toContainEqual(JSON.stringify([["事业一部", "五金车间"]]));
  });

  it("resolves a role from direct membership and its current organization scopes", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce([
      { id: "org-root", parent_id: null, name: "事业一部", enabled: true }
    ]).mockResolvedValueOnce([{ organization_unit_id: "org-root" }])
      .mockResolvedValueOnce([
        { userId: "user-1", displayName: "张三", wechatUserId: "zhang", enabled: true },
        { userId: "user-2", displayName: "李四", wechatUserId: "li", enabled: true }
      ]);
    const service = new NotificationService(source as never);
    await expect((service as any).resolveConfiguredRecipients(manager, [
      { type: "ROLE", roleId: "role-1" }
    ])).resolves.toEqual([
      { userId: "user-1", displayName: "张三", wechatUserId: "zhang", enabled: true },
      { userId: "user-2", displayName: "李四", wechatUserId: "li", enabled: true }
    ]);
    expect(String(manager.query.mock.calls[1]?.[0])).toContain("role_organization_scopes");
    expect(String(manager.query.mock.calls[2]?.[0])).toContain("user_roles direct_role");
    expect(String(manager.query.mock.calls[2]?.[0])).toContain("SELECT DISTINCT u.id");
  });

  it("keeps the existing equipment fault default message format", () => {
    const { source } = dataSource();
    const service = new NotificationService(source as never);
    const content = (service as any).renderContent(
      { config: {} },
      notificationEventDefinition("equipment.status.fault_changed"),
      {
        divisionName: "事业一部", equipmentCode: "EQ-01", equipmentName: "冲床",
        oldFaultMinutes: 0, newFaultMinutes: 60, faultReason: "卡料",
        actorName: "填报人", occurredAt: "2026-09-23T10:00:00+08:00"
      }
    );
    expect(content).toBe("【设备故障提醒】\n\n事业部：事业一部\n设备编号：EQ-01\n设备名称：冲床\n\n故障时间：0分钟 → 60分钟\n故障原因：卡料\n\n填报人：填报人\n时间：2026-09-23T10:00:00+08:00\n\n请及时处理。");
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
    expect(String(manager.query.mock.calls[1]?.[0])).not.toContain("RECIPIENT_NOT_ALLOWED");
  });

  it("quarantines an unregistered notification event before rule matching", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: outboxId, attempts: 1, event_type: "notification.event.not_registered", channel: "WECHAT_WORK", payload: {} }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: deliveryId }]);
    const service = new NotificationService(source as never);
    await expect(service.claimForDispatcher(tenantId, "dispatcher-1")).resolves.toEqual([]);
    expect(manager.query.mock.calls.some(([, params]) => Array.isArray(params) && params.includes("UNREGISTERED_NOTIFICATION_EVENT"))).toBe(true);
    expect(manager.query.mock.calls.some(([sql]) => String(sql).includes("FROM notification_rules"))).toBe(false);
  });

  it("quarantines a rule whose resource differs from the registered event", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: outboxId, attempts: 1, notification_rule_id: ruleId, event_type: "equipment.status.fault_changed", channel: "WECHAT_WORK", payload: {} }])
      .mockResolvedValueOnce([{ id: ruleId, resource: "another-resource", recipient_rule: "EQUIPMENT_RESPONSIBLE", config: {} }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: deliveryId }]);
    const service = new NotificationService(source as never);
    await expect(service.claimForDispatcher(tenantId, "dispatcher-1")).resolves.toEqual([]);
    expect(manager.query.mock.calls.some(([, params]) => Array.isArray(params) && params.includes("NOTIFICATION_EVENT_RESOURCE_MISMATCH"))).toBe(true);
  });

  it("quarantines a recipient rule not allowed by the registered event", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: outboxId, attempts: 1, notification_rule_id: ruleId, event_type: "equipment.status.fault_changed", channel: "WECHAT_WORK", payload: {} }])
      .mockResolvedValueOnce([{ id: ruleId, resource: "equipment-status-report", recipient_rule: "ORDER_SALESPERSON", config: {} }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: deliveryId }]);
    const service = new NotificationService(source as never);
    await expect(service.claimForDispatcher(tenantId, "dispatcher-1")).resolves.toEqual([]);
    expect(manager.query.mock.calls.some(([, params]) => Array.isArray(params) && params.includes("UNSUPPORTED_RECIPIENT_RULE"))).toBe(true);
  });

  it("resolves enabled equipment responsibles and creates one pending delivery per wechat user", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: outboxId, attempts: 1, notification_rule_id: null, event_type: "equipment.status.fault_changed", channel: "WECHAT_WORK", payload: { equipmentId: "00000000-0000-7000-8000-000000000010", divisionName: "事业一部", equipmentCode: "EQ-01", equipmentName: "冲床", oldFaultMinutes: 0, newFaultMinutes: 60, faultReason: "卡料", actorName: "填报人", occurredAt: "2026-09-23T10:00:00+08:00" } }])
      .mockResolvedValueOnce([{ id: ruleId, resource: "equipment-status-report", recipient_rule: "EQUIPMENT_RESPONSIBLE", config: { messageType: "text", template: "{equipmentCode}:{newFaultMinutes}" } }])
      .mockResolvedValueOnce([{ userId: "00000000-0000-7000-8000-000000000011", displayName: "张三", wechatUserId: "wx-zhang", enabled: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: deliveryId }])
      .mockResolvedValueOnce(undefined);
    const service = new NotificationService(source as never);
    await expect(service.claimForDispatcher(tenantId, "dispatcher-1")).resolves.toEqual([{
      notificationId: outboxId, messageType: "text", content: "EQ-01:60",
      recipients: [{ deliveryId, userId: "00000000-0000-7000-8000-000000000011", displayName: "张三", wechatUserId: "wx-zhang" }]
    }]);
    expect(String(manager.query.mock.calls[4]?.[0])).toContain("notification_delivery_logs");
    expect(String(manager.query.mock.calls[6]?.[0])).toContain("notification_rule_id=$3::uuid");
  });

  it("skips a missing wechat id without blocking other recipients", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: outboxId, attempts: 1, notification_rule_id: ruleId, event_type: "equipment.status.fault_changed", channel: "WECHAT_WORK", payload: { equipmentId: "00000000-0000-7000-8000-000000000010" } }])
      .mockResolvedValueOnce([{ id: ruleId, resource: "equipment-status-report", recipient_rule: "EQUIPMENT_RESPONSIBLE", config: {} }])
      .mockResolvedValueOnce([
        { userId: "00000000-0000-7000-8000-000000000011", displayName: "无企微", wechatUserId: null, enabled: true },
        { userId: "00000000-0000-7000-8000-000000000012", displayName: "李四", wechatUserId: "li", enabled: true }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "delivery-skipped" }])
      .mockResolvedValueOnce([{ id: deliveryId }])
      .mockResolvedValueOnce(undefined);
    const service = new NotificationService(source as never);
    await expect(service.claimForDispatcher(tenantId, "dispatcher-1")).resolves.toEqual([expect.objectContaining({
      recipients: [{ deliveryId, userId: "00000000-0000-7000-8000-000000000012", displayName: "李四", wechatUserId: "li" }]
    })]);
    expect(manager.query.mock.calls.some(([, params]) => Array.isArray(params) && params.includes("SKIPPED_MISSING_WECHAT_ID"))).toBe(true);
  });

  it("creates independent delivery IDs for multiple resolved recipients", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: outboxId, attempts: 1, notification_rule_id: ruleId, event_type: "equipment.status.fault_changed", channel: "WECHAT_WORK", payload: { equipmentId: "00000000-0000-7000-8000-000000000010" } }])
      .mockResolvedValueOnce([{ id: ruleId, resource: "equipment-status-report", recipient_rule: "EQUIPMENT_RESPONSIBLE", config: {} }])
      .mockResolvedValueOnce([
        { userId: "00000000-0000-7000-8000-000000000011", displayName: "张三", wechatUserId: "zhang", enabled: true },
        { userId: "00000000-0000-7000-8000-000000000012", displayName: "李四", wechatUserId: "li", enabled: true },
        { userId: "00000000-0000-7000-8000-000000000013", displayName: "王五", wechatUserId: "wang", enabled: true }
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "delivery-1" }])
      .mockResolvedValueOnce([{ id: "delivery-2" }])
      .mockResolvedValueOnce([{ id: "delivery-3" }])
      .mockResolvedValueOnce(undefined);
    const service = new NotificationService(source as never);
    await expect(service.claimForDispatcher(tenantId, "dispatcher-1")).resolves.toEqual([expect.objectContaining({
      recipients: [
        { deliveryId: "delivery-1", userId: "00000000-0000-7000-8000-000000000011", displayName: "张三", wechatUserId: "zhang" },
        { deliveryId: "delivery-2", userId: "00000000-0000-7000-8000-000000000012", displayName: "李四", wechatUserId: "li" },
        { deliveryId: "delivery-3", userId: "00000000-0000-7000-8000-000000000013", displayName: "王五", wechatUserId: "wang" }
      ]
    })]);
    expect(manager.query.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO notification_delivery_logs"))).toHaveLength(3);
  });

  it("marks only one delivery ID successful without updating sibling deliveries", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: outboxId, status: "PROCESSING" }])
      .mockResolvedValueOnce([{ status: "PENDING", count: 1 }, { status: "SENT", count: 1 }])
      .mockResolvedValueOnce([{ id: outboxId, status: "PROCESSING" }]);
    const service = new NotificationService(source as never);
    await expect(service.markDeliverySuccess(tenantId, outboxId, "dispatcher-1", {
      deliveryId, errcode: "0", errmsg: "ok", providerMessageId: "provider-1"
    })).resolves.toMatchObject({ status: "PROCESSING" });
    const updateSql = String(manager.query.mock.calls[1]?.[0]);
    const updateParams = manager.query.mock.calls[1]?.[1] as unknown[];
    expect(updateSql).toContain("delivery.id=$4::uuid");
    expect(updateSql).not.toContain("ANY($4");
    expect(updateParams[3]).toBe(deliveryId);
    expect(updateParams).toHaveLength(7);
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
    expect(updateSql).toContain("delivery.id=$4::uuid");
    expect(updateSql).not.toContain("$10");
    expect(updateParams).toHaveLength(9);
    expect(String(manager.query.mock.calls[3]?.[0])).toContain("status=$4::varchar");
  });
});
