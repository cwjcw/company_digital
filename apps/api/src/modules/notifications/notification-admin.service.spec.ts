import { ForbiddenException } from "@nestjs/common";
import { NotificationAdminService, NOTIFICATION_TEST_MODE_MESSAGE } from "./notification-admin.service";

const systemActor = { tenantId: "KAINAN", userId: "00000000-0000-7000-8000-000000000010", name: "管理员", username: "admin", requestId: "req-1", isSystemAdmin: true, moduleAdminCodes: [] };
const planningActor = { ...systemActor, isSystemAdmin: false, moduleAdminCodes: ["planning"] };
const ordinaryActor = { ...systemActor, isSystemAdmin: false, moduleAdminCodes: [] };

describe("NotificationAdminService", () => {
  it("only exposes registered events and supports the planning module administrator", () => {
    const service = new NotificationAdminService({} as never, {} as never);
    expect(service.availableEvents(planningActor)).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: "equipment.status.fault_changed", resource: "equipment-status-report", channel: "WECHAT_WORK" })]));
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

  it("keeps the test-mode contract visible to callers", () => {
    expect(NOTIFICATION_TEST_MODE_MESSAGE).toBe("当前处于企业微信测试模式，实际企业微信消息仅发送给崔玮杰。");
  });
});
