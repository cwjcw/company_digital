import { notificationEventDefinition, notificationEventDefinitions } from "./notification-event.registry";

describe("Notification Event Registry", () => {
  it("registers the equipment fault and shipping plan events", () => {
    expect(notificationEventDefinitions()).toHaveLength(2);
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
    expect(notificationEventDefinition("shipping_plan.key_fields_changed")).toMatchObject({
      eventType: "shipping_plan.key_fields_changed",
      moduleCode: "planning",
      resourceCode: "mps-shipping-plans",
      label: "出货计划关键字段变化",
      conditionDescription: "已有出货计划的关键字段发生实际变化时触发",
      defaultChannel: "WECHAT_WORK",
      messageType: "text",
      allowedRecipientRules: ["FIXED_USERS"]
    });
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
    expect(notificationEventDefinition("shipping_plan.key_fields_changed")?.templateVariables).toEqual([
      { key: "recordId", label: "记录 ID" },
      { key: "customerCode", label: "客户编码" },
      { key: "orderNumber", label: "订单编号" },
      { key: "itemCode", label: "品项编码" },
      { key: "itemName", label: "品项名称" },
      { key: "deliveryNumber", label: "交期编码" },
      { key: "divisionName", label: "承接事业部" },
      { key: "changeSummary", label: "变更内容" },
      { key: "actorName", label: "修改人" },
      { key: "occurredAt", label: "发生时间" }
    ]);
  });
});
