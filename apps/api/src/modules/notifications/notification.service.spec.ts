import { NotificationService } from "./notification.service";
import { notificationEventDefinition } from "./notification-event.registry";
import { encryptGroupWebhook } from "./group-webhook.crypto";

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
  it("claims one equipment fault for both existing personal recipients and configured group targets", async () => {
    const { manager, source } = dataSource();
    const outbox = { id: outboxId, event_type: "equipment.status.fault_changed", notification_rule_id: ruleId, payload: { equipmentCode: "EQ-1" } };
    manager.query.mockResolvedValueOnce(undefined).mockResolvedValueOnce([outbox]).mockResolvedValueOnce([]);
    const service = new NotificationService(source as never);
    const personal = [{ deliveryId: "personal-delivery", userId: "user-1", displayName: "值班人", wechatUserId: "wecom-1" }];
    const group = { notificationId: outboxId, messageType: "group_text", content: "故障提醒", recipients: [{ deliveryId: "group-delivery", targetType: "WECHAT_GROUP_WEBHOOK", targetId: "group-1", webhookUrl: "https://example.invalid" }] };
    jest.spyOn(service as any, "resolveRule").mockResolvedValue({ resource: "equipment-status-report", recipient_rule: "EQUIPMENT_RESPONSIBLE", config: {} });
    jest.spyOn(service as any, "resolveRecipients").mockResolvedValue([{ userId: "user-1", displayName: "值班人", wechatUserId: "wecom-1" }]);
    jest.spyOn(service as any, "prepareRecipientDeliveries").mockResolvedValue(personal);
    jest.spyOn(service as any, "prepareGroupWebhookClaims").mockResolvedValue([group]);

    await expect(service.claimForDispatcher(tenantId, "worker-1")).resolves.toEqual([
      { notificationId: outboxId, messageType: "text", content: expect.stringContaining("EQ-1"), recipients: personal }, group
    ]);
    expect((service as any).prepareGroupWebhookClaims).toHaveBeenCalledWith(manager, tenantId, outbox, expect.stringContaining("EQ-1"));
  });

  it("creates one delivery row per group and component and reclaims only failed target attempts", async () => {
    const previousKey=process.env.KDOS_NOTIFICATION_SECRET_KEY;process.env.KDOS_NOTIFICATION_SECRET_KEY="service-test-key";
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce([
      {id:"group-a",group_name:"已送达群",webhook_ciphertext:encryptGroupWebhook("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdefghijklmnop1111")},
      {id:"group-b",group_name:"待重试群",webhook_ciphertext:encryptGroupWebhook("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdefghijklmnop2222")}
    ]).mockResolvedValueOnce([{id:"component-text",sequence:1,component_type:"text",content_text:"日报"}])
      .mockResolvedValueOnce([{id:"sent-a",attempt:1,status:"SENT"}])
      .mockResolvedValueOnce([{id:"failed-b",attempt:1,status:"FAILED"}])
      .mockResolvedValueOnce([{id:"retry-b",attempt:2,status:"PENDING"}]);
    try {
      const service=new NotificationService(source as never);
      const claims=await (service as any).prepareGroupWebhookClaims(manager,tenantId,{id:outboxId,event_type:"equipment.daily_report"});
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({messageType:"group_text",content:"日报",recipients:[{deliveryId:"retry-b",targetName:"待重试群",webhookUrl:"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdefghijklmnop2222"}]});
      expect(String(manager.query.mock.calls[0][0])).toContain("target_type='WECHAT_GROUP_WEBHOOK'");
      expect(String(manager.query.mock.calls[0][0])).toContain("target_type='RECIPIENT_GROUP'");
      expect(String(manager.query.mock.calls[0][0])).toContain("g.enabled=true");
      expect(String(manager.query.mock.calls[0][0])).toContain("DISTINCT ON(id)");
      expect(String(manager.query.mock.calls[0][0])).toContain("w.enabled=true");
      expect(manager.query.mock.calls.filter(([sql])=>String(sql).includes("INSERT INTO notification_delivery_logs"))).toHaveLength(1);
      expect(JSON.stringify(manager.query.mock.calls.filter(([sql])=>String(sql).includes("INSERT INTO notification_delivery_logs")))).not.toContain("abcdefghijklmnop2222");
    } finally { if(previousKey===undefined)delete process.env.KDOS_NOTIFICATION_SECRET_KEY;else process.env.KDOS_NOTIFICATION_SECRET_KEY=previousKey; }
  });

  it("recovers only the missing second image while preserving four successful first-image deliveries", async () => {
    const {manager,source}=dataSource();
    const ids=["target-a","target-b","target-c","target-d"];
    manager.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{id:outboxId,event_type:"equipment.daily_report",status:"SENT"}])
      .mockResolvedValueOnce([{sequence:1,component_type:"text"},{sequence:2,component_type:"image"},{sequence:3,component_type:"image"}])
      .mockResolvedValueOnce(ids.map(target_id=>({target_id})))
      .mockResolvedValueOnce(ids.map(target_id=>({target_id})))
      .mockResolvedValueOnce([ids.map((_,index)=>({id:`text-${index}`})),4])
      .mockResolvedValueOnce([ids.map((_,index)=>({id:`image-${index}`})),4])
      .mockResolvedValueOnce([[{id:outboxId}],1])
      .mockResolvedValueOnce([]);
    const service=new NotificationService(source as never);
    await expect(service.recoverLegacyDailyReportImage(tenantId,outboxId)).resolves.toEqual({outboxId,requeued:true,preservedTextDeliveries:4,preservedImageDeliveries:4,retrySequence:3});
    expect(manager.query.mock.calls[5][0]).toContain("component='group_text_1'");
    expect(manager.query.mock.calls[6][0]).toContain("component='group_image_2'");
    expect(manager.query.mock.calls[7][0]).toContain("status='PENDING'");
    expect(manager.query.mock.calls[8][0]).toContain("audit_logs");
  });

  it("uses sequence-specific keys for consecutive images", async () => {
    const previousKey=process.env.KDOS_NOTIFICATION_SECRET_KEY;process.env.KDOS_NOTIFICATION_SECRET_KEY="service-test-key";
    const {manager,source}=dataSource();
    manager.query.mockResolvedValueOnce([{id:"target-a",group_name:"设备群",webhook_ciphertext:encryptGroupWebhook("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdefghijklmnop3333")}])
      .mockResolvedValueOnce([{id:"operation",sequence:2,component_type:"image",filename:"operation.png"},{id:"reporting",sequence:3,component_type:"image",filename:"reporting.png"}])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{id:"operation-delivery",attempt:1,status:"PENDING"}])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([{id:"reporting-delivery",attempt:1,status:"PENDING"}]);
    try {
      const service=new NotificationService(source as never);
      const claims=await (service as any).prepareGroupWebhookClaims(manager,tenantId,{id:outboxId,event_type:"equipment.daily_report"});
      expect(claims.map((claim:any)=>claim.messageType)).toEqual(["group_image","group_image"]);
      expect(claims.map((claim:any)=>claim.attachment.id)).toEqual(["operation","reporting"]);
      const inserts=manager.query.mock.calls.filter(([sql])=>String(sql).includes("INSERT INTO notification_delivery_logs"));
      expect(inserts.map(([,params])=>(params as unknown[])[3])).toEqual(["group_image_2","group_image_3"]);
      expect(new Set(claims.map((claim:any)=>claim.recipients[0].deliveryId)).size).toBe(2);
    } finally {if(previousKey===undefined)delete process.env.KDOS_NOTIFICATION_SECRET_KEY;else process.env.KDOS_NOTIFICATION_SECRET_KEY=previousKey;}
  });

  it("renders a Work fault event as one text component for its optional group route", async () => {
    const previousKey = process.env.KDOS_NOTIFICATION_SECRET_KEY;
    process.env.KDOS_NOTIFICATION_SECRET_KEY = "service-test-key";
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce([{ id: "target-a", group_name: "设备管理群", webhook_ciphertext: encryptGroupWebhook("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdefghijklmnop4444") }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "group-delivery", attempt: 1, status: "PENDING" }]);
    try {
      const service = new NotificationService(source as never);
      const claims = await (service as any).prepareGroupWebhookClaims(manager, tenantId, { id: outboxId, event_type: "equipment.status.fault_changed" }, "【设备故障提醒】EQ-01 发生故障");
      expect(claims).toEqual([expect.objectContaining({ messageType: "group_text", content: "【设备故障提醒】EQ-01 发生故障", recipients: [expect.objectContaining({ deliveryId: "group-delivery", targetName: "设备管理群" })] })]);
    } finally { if (previousKey === undefined) delete process.env.KDOS_NOTIFICATION_SECRET_KEY; else process.env.KDOS_NOTIFICATION_SECRET_KEY = previousKey; }
  });

  it("rejects routed events that do not start with text and blocks unknown event types", async () => {
    const {source}=dataSource();const service=new NotificationService(source as never);
    await expect(service.enqueueGroupEvent(tenantId,{eventType:"equipment.daily_report",dedupKey:"one",components:[{type:"image",filename:"x.png",mimeType:"image/png",base64:"iVBORw0KGgo="}]})).rejects.toThrow(/必须先发送文字/);
    await expect(service.enqueueGroupEvent(tenantId,{eventType:"unknown",dedupKey:"two",components:[{type:"text",content:"x"}]})).rejects.toThrow(/未注册/);
  });
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
    expect(manager.query.mock.calls[0][1]).toEqual([["00000000-0000-7000-8000-000000000011"], tenantId]);
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
    ], tenantId);
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
    ], tenantId)).resolves.toEqual([
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
    ], tenantId)).resolves.toEqual([
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
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: deliveryId }]);
    const service = new NotificationService(source as never);
    await expect(service.claimForDispatcher(tenantId, "dispatcher-1")).resolves.toEqual([]);
    expect(String(manager.query.mock.calls[1]?.[0])).toContain("FOR UPDATE SKIP LOCKED");
    expect(manager.query.mock.calls.some(([sql]) => String(sql).includes("next_retry_at=NULL"))).toBe(true);
    expect(manager.query.mock.calls.some(([sql]) => String(sql).includes("SKIPPED"))).toBe(true);
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
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ userId: "00000000-0000-7000-8000-000000000011", displayName: "张三", wechatUserId: "wx-zhang", enabled: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: deliveryId }])
      .mockResolvedValueOnce(undefined);
    const service = new NotificationService(source as never);
    await expect(service.claimForDispatcher(tenantId, "dispatcher-1")).resolves.toEqual([{
      notificationId: outboxId, messageType: "text", content: "EQ-01:60",
      recipients: [{ deliveryId, userId: "00000000-0000-7000-8000-000000000011", displayName: "张三", wechatUserId: "wx-zhang" }]
    }]);
    expect(manager.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO notification_delivery_logs"))).toBe(true);
    expect(manager.query.mock.calls.some(([sql]) => String(sql).includes("notification_rule_id=COALESCE($3::uuid"))).toBe(true);
  });

  it("skips a missing wechat id without blocking other recipients", async () => {
    const { manager, source } = dataSource();
    manager.query.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: outboxId, attempts: 1, notification_rule_id: ruleId, event_type: "equipment.status.fault_changed", channel: "WECHAT_WORK", payload: { equipmentId: "00000000-0000-7000-8000-000000000010" } }])
      .mockResolvedValueOnce([{ id: ruleId, resource: "equipment-status-report", recipient_rule: "EQUIPMENT_RESPONSIBLE", config: {} }])
      .mockResolvedValueOnce([])
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
      .mockResolvedValueOnce([])
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
