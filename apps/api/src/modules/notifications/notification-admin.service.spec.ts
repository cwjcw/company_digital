import { ForbiddenException } from "@nestjs/common";
import { NotificationAdminService } from "./notification-admin.service";

const systemActor = { tenantId: "KAINAN", userId: "00000000-0000-7000-8000-000000000010", name: "管理员", username: "admin", requestId: "req-1", isSystemAdmin: true, moduleAdminCodes: [] };
const planningActor = { ...systemActor, isSystemAdmin: false, moduleAdminCodes: ["planning"] };
const ordinaryActor = { ...systemActor, isSystemAdmin: false, moduleAdminCodes: [] };

describe("NotificationAdminService", () => {
  it("only exposes registered events and supports the planning module administrator", () => {
    const service = new NotificationAdminService({} as never, {} as never);
    expect(service.availableEvents(planningActor)).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: "equipment.status.fault_changed", resource: "equipment-status-report", channel: "WECHAT_WORK", condition: "故障时长发生变化且新值大于0时触发", recipientLabels: { EQUIPMENT_RESPONSIBLE: "设备责任人", FIXED_USERS: "组织架构 / 角色 / 员工" } })]));
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
    const service = new NotificationAdminService(dataSource as never, {} as never);
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
