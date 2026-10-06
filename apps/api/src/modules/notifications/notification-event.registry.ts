import type { NotificationEventDefinition } from "./notification.types";

export const EQUIPMENT_RESPONSIBLE_RECIPIENT_RULE = "EQUIPMENT_RESPONSIBLE";
export const FIXED_USERS_RECIPIENT_RULE = "FIXED_USERS";

const EQUIPMENT_FAULT_TEMPLATE = "【设备故障提醒】\n\n事业部：{divisionName}\n设备编号：{equipmentCode}\n设备名称：{equipmentName}\n\n故障时间：{oldFaultMinutes}分钟 → {newFaultMinutes}分钟\n故障原因：{faultReason}\n\n填报人：{actorName}\n时间：{occurredAt}\n\n请及时处理。";
const SHIPPING_PLAN_KEY_FIELDS_CHANGED_TEMPLATE = "【出货计划变更】\n\n客户：{customerCode}\n订单：{orderNumber}\n品项：{itemCode} {itemName}\n事业部：{divisionName}\n\n变更内容：\n{changeSummary}\n\n修改人：{actorName}\n时间：{occurredAt}\n\n请相关人员确认后续计划。";

const definitions = [
  {
    eventType: "equipment.status.fault_changed",
    moduleCode: "planning",
    resourceCode: "equipment-status-report",
    label: "设备故障变化",
    conditionDescription: "故障时长发生变化且新值大于0时触发",
    defaultChannel: "WECHAT_WORK",
    messageType: "text",
    defaultTemplate: EQUIPMENT_FAULT_TEMPLATE,
    allowedRecipientRules: [EQUIPMENT_RESPONSIBLE_RECIPIENT_RULE, FIXED_USERS_RECIPIENT_RULE],
    templateVariables: [
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
    ]
  },
  {
    eventType: "shipping_plan.key_fields_changed",
    moduleCode: "planning",
    resourceCode: "mps-shipping-plans",
    label: "出货计划关键字段变化",
    conditionDescription: "已有出货计划的关键字段发生实际变化时触发",
    defaultChannel: "WECHAT_WORK",
    messageType: "text",
    defaultTemplate: SHIPPING_PLAN_KEY_FIELDS_CHANGED_TEMPLATE,
    allowedRecipientRules: [FIXED_USERS_RECIPIENT_RULE],
    templateVariables: [
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
    ]
  }
] as const satisfies readonly NotificationEventDefinition[];

const byEventType = new Map<string, NotificationEventDefinition>(
  definitions.map((definition) => [definition.eventType, definition])
);

export const notificationEventDefinitions = (): readonly NotificationEventDefinition[] => definitions;

export const notificationEventDefinition = (eventType: string): NotificationEventDefinition | undefined =>
  byEventType.get(eventType);
