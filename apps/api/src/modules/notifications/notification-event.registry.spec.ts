import { notificationEventDefinition, notificationEventDefinitions } from "./notification-event.registry";

describe("Notification Event Registry", () => {
  it("registers only the equipment fault event for this phase", () => {
    expect(notificationEventDefinitions()).toHaveLength(1);
    expect(notificationEventDefinition("equipment.status.fault_changed")).toMatchObject({
      eventType: "equipment.status.fault_changed",
      moduleCode: "planning",
      resourceCode: "equipment-status-report",
      label: "设备故障变化",
      conditionDescription: "故障时长发生变化且新值大于0时触发",
      defaultChannel: "WECHAT_WORK",
      messageType: "text",
      allowedRecipientRules: ["EQUIPMENT_RESPONSIBLE", "FIXED_USERS"]
    });
    expect(notificationEventDefinition("shipping_plan.key_fields_changed")).toBeUndefined();
  });

  it("owns the formal template variables and labels", () => {
    expect(notificationEventDefinition("equipment.status.fault_changed")?.templateVariables).toEqual([
      { key: "equipmentId", label: "设备 ID" },
      { key: "equipmentCode", label: "设备编号" },
      { key: "equipmentName", label: "设备名称" },
      { key: "divisionId", label: "事业部 ID" },
      { key: "divisionName", label: "事业部" },
      { key: "oldFaultMinutes", label: "原故障时长" },
      { key: "newFaultMinutes", label: "新故障时长" },
      { key: "faultReason", label: "故障原因" },
      { key: "actorUserId", label: "填报人 ID" },
      { key: "actorName", label: "填报人" },
      { key: "occurredAt", label: "发生时间" }
    ]);
  });
});
