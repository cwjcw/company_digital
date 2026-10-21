import { ForbiddenException } from "@nestjs/common";
import { NotificationAdminService } from "./notification-admin.service";

const systemActor = { tenantId: "KAINAN", userId: "00000000-0000-7000-8000-000000000010", name: "管理员", username: "admin", requestId: "req-1", isSystemAdmin: true, moduleAdminCodes: [] };
const planningActor = { ...systemActor, isSystemAdmin: false, moduleAdminCodes: ["planning"] };
const ordinaryActor = { ...systemActor, isSystemAdmin: false, moduleAdminCodes: [] };

describe("NotificationAdminService", () => {
  it("exposes finance events only to the owning module or system administrators", () => {
    const service=new NotificationAdminService({} as never,{} as never);
    const financeActor={...ordinaryActor,moduleAdminCodes:["finance"]};
    expect(service.availableEvents(financeActor)).toEqual([expect.objectContaining({eventType:"finance.monthly.daily_summary",moduleCode:"finance",module:"财务中心",resourceLabel:"月度数据"})]);
    expect(service.availableEvents(planningActor).some(e=>e.moduleCode==="finance")).toBe(false);
    expect(()=>service.templateVariables(planningActor,"finance.monthly.daily_summary")).toThrow(ForbiddenException);
    expect(service.availableEvents(systemActor).some(e=>e.module==="财务中心")).toBe(true);
  });
  it("only exposes registered events and supports the planning module administrator", () => {
    const service = new NotificationAdminService({} as never, {} as never);
    expect(service.availableEvents(planningActor)).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: "equipment.status.fault_changed", resource: "equipment-status-report", channel: "WECHAT_WORK", condition: "故障时长发生变化且新值大于0时触发", recipientLabels: { ORDER_ALLOCATION_DYNAMIC:"承接事业部＋订单业务员", EQUIPMENT_RESPONSIBLE: "设备责任人", FIXED_USERS: "组织架构 / 角色 / 员工" } })]));
    expect(service.templateVariables(planningActor, "equipment.status.fault_changed")).toEqual(
      expect.arrayContaining([{ key: "equipmentCode", label: "设备编号" }, { key: "occurredAt", label: "发生时间" }])
    );
    expect(() => service.availableEvents(ordinaryActor)).toThrow(ForbiddenException);
  });

  it("rejects arbitrary events/resources and accepts controlled double-brace variables", async () => {
    const manager = { query: jest.fn().mockResolvedValue([{ id: "rule-1", name: "故障", event_type: "equipment.status.fault_changed", resource: "equipment-status-report", module_code: "planning", recipient_rule: "EQUIPMENT_RESPONSIBLE", enabled: true, config: {}, version: 1 }]) };
    const dataSource = { transaction: jest.fn(async (work: (value: typeof manager) => unknown) => work(manager)) };
    const service = new NotificationAdminService(dataSource as never, {} as never);
    await expect(service.create(planningActor, { name: "故障", eventType: "not.registered", resource: "equipment-status-report" })).rejects.toThrow("当前数据表暂未注册可用的实时通知事件。");
    await expect(service.create(planningActor, { name: "故障", eventType: "equipment.status.fault_changed", resource: "other" })).rejects.toThrow("资源与通知事件不匹配");
    expect((service as any).normalizeTemplate("设备{{equipmentCode}}变化{{newFaultMinutes}}", ["equipmentCode", "newFaultMinutes"])).toBe("设备{equipmentCode}变化{newFaultMinutes}");
  });

  it("validates and stores fixed recipient user IDs without accepting names", () => {
    const service = new NotificationAdminService({} as never, {} as never);
    expect((service as any).validRule({
      name: "指定人员", eventType: "equipment.status.fault_changed", resource: "equipment-status-report",
      recipientRule: "FIXED_USERS", recipientUserIds: ["00000000-0000-7000-8000-000000000011"]
    })).toMatchObject({ recipientRule: "FIXED_USERS", recipientTargets: [{ type: "USER", userId: "00000000-0000-7000-8000-000000000011" }], config: { recipientTargets: [{ type: "USER", userId: "00000000-0000-7000-8000-000000000011" }] } });
    expect(() => (service as any).validRule({
      name: "指定人员", eventType: "equipment.status.fault_changed", resource: "equipment-status-report",
      recipientRule: "FIXED_USERS", recipientUserIds: ["张三"]
    })).toThrow("有效用户 ID");
  });

  it("saves a fixed-recipient rule with multiple stable user IDs", async () => {
    const manager = { query: jest.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ type: "USER", id: "00000000-0000-7000-8000-000000000011" }, { type: "USER", id: "00000000-0000-7000-8000-000000000012" }])
      .mockResolvedValueOnce([{ id: "00000000-0000-7000-8000-000000000099", rule_key: "fixed-users", name: "指定人员", event_type: "equipment.status.fault_changed", resource: "equipment-status-report", recipient_rule: "FIXED_USERS", config: { recipientTargets: [{ type: "USER", userId: "00000000-0000-7000-8000-000000000011" }, { type: "USER", userId: "00000000-0000-7000-8000-000000000012" }] }, enabled: true, version: 1 }])
      .mockResolvedValueOnce([]) };
    const dataSource = { transaction: jest.fn(async (work: (value: typeof manager) => unknown) => work(manager)) };
    const service = new NotificationAdminService(dataSource as never, { previewConfiguredRecipients: jest.fn().mockResolvedValue({ deliverable: 2 }) } as never);
    const result = await service.create(planningActor, {
      name: "指定人员", eventType: "equipment.status.fault_changed", resource: "equipment-status-report",
      recipientRule: "FIXED_USERS",
      recipientUserIds: ["00000000-0000-7000-8000-000000000011", "00000000-0000-7000-8000-000000000012"]
    });
    expect(result).toMatchObject({ recipientRule: "FIXED_USERS", recipientTargets: [{ type: "USER", userId: "00000000-0000-7000-8000-000000000011" }, { type: "USER", userId: "00000000-0000-7000-8000-000000000012" }] });
    expect(manager.query.mock.calls[2][1][7]).toBe("FIXED_USERS");
  });

  it("accepts mixed organization, role and employee targets with stable IDs", () => {
    const service = new NotificationAdminService({} as never, {} as never);
    expect((service as any).validRule({
      name: "混合接收对象", eventType: "equipment.status.fault_changed", resource: "equipment-status-report", recipientRule: "FIXED_USERS",
      recipientTargets: [
        { type: "ORGANIZATION", organizationUnitId: "00000000-0000-0000-0000-000000000021", includeDescendants: false },
        { type: "ROLE", roleId: "00000000-0000-0000-0000-000000000022" },
        { type: "USER", userId: "00000000-0000-0000-0000-000000000023" }
      ]
    }).config.recipientTargets).toEqual([
      { type: "ORGANIZATION", organizationUnitId: "00000000-0000-0000-0000-000000000021", includeDescendants: false },
      { type: "ROLE", roleId: "00000000-0000-0000-0000-000000000022" },
      { type: "USER", userId: "00000000-0000-0000-0000-000000000023" }
    ]);
  });

  it("exposes the same organization, role and employee option sources used by authorization", async () => {
    const dataSource = { query: jest.fn()
      .mockResolvedValueOnce([{ id: "org-1", name: "事业一部", parentId: null, level: 1, enabled: true, sortOrder: 1 }])
      .mockResolvedValueOnce([{ id: "role-1", name: "PMC主管", roleGroupId: "group-1", roleGroupName: "计划角色" }])
      .mockResolvedValueOnce([{ id: "user-1", displayName: "张三", username: "zhang", enabled: true, roleIds: ["role-1"] }]) };
    const service = new NotificationAdminService(dataSource as never, {} as never);
    await expect(service.recipientOptions(planningActor)).resolves.toMatchObject({
      organizations: [expect.objectContaining({ id: "org-1", pathLabel: "事业一部" })],
      roles: [expect.objectContaining({ id: "role-1" })],
      users: [expect.objectContaining({ id: "user-1" })]
    });
  });

  it("test send enqueues a real notification for the rule recipients without a mode field", async () => {
    const dataSource = { query: jest.fn()
      .mockResolvedValueOnce([{ id: "00000000-0000-7000-8000-000000000099", event_type: "equipment.status.fault_changed", resource: "equipment-status-report", recipient_rule: "FIXED_USERS", config: {}, enabled: true, version: 1 }])
      .mockResolvedValueOnce(undefined) };
    const notifications = { enqueueEvent: jest.fn().mockResolvedValue({ row: { id: "00000000-0000-7000-8000-000000000088" }, created: true }) };
    const service = new NotificationAdminService(dataSource as never, notifications as never);
    const result = await service.testSend(planningActor, "00000000-0000-7000-8000-000000000099", {
      payload: { equipmentId: "00000000-0000-7000-8000-000000000010" }
    });
    expect(result).toEqual({ row: { id: "00000000-0000-7000-8000-000000000088" }, created: true, message: "已创建规则测试通知，将发送给当前规则实际接收人。" });
    expect(notifications.enqueueEvent).toHaveBeenCalledTimes(1);
    expect(notifications.enqueueEvent).toHaveBeenCalledWith("KAINAN", expect.objectContaining({ ruleId: "00000000-0000-7000-8000-000000000099" }));
    expect(JSON.parse(String(dataSource.query.mock.calls[1]?.[1]?.[3]))).toEqual({ outboxId: "00000000-0000-7000-8000-000000000088" });
  });
});

describe("notification rule draft, state and safety", () => {
  const id = "00000000-0000-7000-8000-000000000099";
  const userId = "00000000-0000-7000-8000-000000000011";
  const config = { template: "自定义{yearMonth}", recipientTargets: [{ type: "USER", userId }], custom: { keep: true } };
  const row = { id, tenant_id: "KAINAN", name: "财务月度数据每日汇总", event_type: "finance.monthly.daily_summary", resource: "finance-e10-monthly", recipient_rule: "FIXED_USERS", enabled: false, config, version: 3 };
  function fixture(current = row, deliverable = 1) {
    const query = jest.fn(async (sql: string, args?: unknown[]) => {
      if (sql.includes("FOR UPDATE")) return [current];
      if (sql.startsWith("SELECT 'ORGANIZATION'")) return [{ type: "USER", id: userId }];
      if (sql.startsWith("UPDATE")) return [[{ ...current, enabled: args?.[2], version: current.version + 1 }], 1];
      return [];
    });
    const source = { transaction: async (work: (m: unknown) => unknown) => work({ query }) };
    const notifications = { previewConfiguredRecipients: jest.fn().mockResolvedValue({ deliverable }) };
    return { service: new NotificationAdminService(source as never, notifications as never), query, notifications };
  }
  it("allows a disabled empty draft but refuses activation with an actionable code", async () => {
    const { service } = fixture();
    expect((service as any).validRule({ ...row, eventType: row.event_type, recipientRule: "FIXED_USERS", enabled: false, config: { recipientTargets: [] } }).recipientTargets).toEqual([]);
    const empty = fixture({ ...row, config: { ...config, recipientTargets: [] } });
    await expect(empty.service.toggle(systemActor, id, true, 3)).rejects.toMatchObject({ response: { code: "NOTIFICATION_RECIPIENTS_REQUIRED" } });
    expect(empty.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
  });
  it("toggles only state/version and keeps the exact original config", async () => {
    const { service, query, notifications } = fixture();
    const updated = await service.toggle(systemActor, id, true, 3);
    expect(updated.config).toEqual(config);
    expect(updated.enabled).toBe(true);
    const [sql, args] = query.mock.calls.find(([sql]) => sql.startsWith("UPDATE"))!;
    expect(sql).not.toContain("config="); expect(args).toEqual([systemActor.tenantId, id, true, systemActor.userId, 3]);
    expect(notifications.previewConfiguredRecipients).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.some(([sql]) => sql.includes("audit_logs"))).toBe(true);
  });
  it("can always disable a rule even when its former recipients are no longer usable", async () => {
    const { service, notifications } = fixture({ ...row, enabled: true }, 0);
    await expect(service.toggle(systemActor, id, false, 3)).resolves.toMatchObject({ enabled: false, config });
    expect(notifications.previewConfiguredRecipients).not.toHaveBeenCalled();
  });
  it("rejects no deliverable members and stale versions without writing", async () => {
    const f = fixture(row, 0);
    await expect(f.service.toggle(systemActor, id, true, 3)).rejects.toThrow("未配置有效接收人");
    await expect(f.service.toggle(systemActor, id, true, 2)).rejects.toThrow("刷新后重试");
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
  });
  it("enforces module ownership and ordinary-user save permissions", async () => {
    for (const actor of [ordinaryActor, planningActor]) {
      const f = fixture();
      await expect(f.service.toggle(actor, id, true, 3)).rejects.toThrow(ForbiddenException);
      expect(f.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
    }
  });
  it("scopes saved employee IDs and candidates to the actor tenant", async () => {
    const f = fixture(); await f.service.toggle(systemActor, id, true, 3);
    const validation = f.query.mock.calls.find(([sql]) => sql.startsWith("SELECT 'ORGANIZATION'"))!;
    expect(validation[0]).toContain("tenant_id=$4"); expect(validation[1]?.[3]).toBe("KAINAN");
    const query = jest.fn().mockResolvedValue([]);
    await new NotificationAdminService({ query } as never, {} as never).recipientOptions(systemActor);
    expect(query.mock.calls[2][0]).toContain("u.enabled"); expect(query.mock.calls[2][1]).toEqual(["KAINAN"]);
  });
});
