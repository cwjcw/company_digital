import type { NotificationEventDefinition } from "./notification.types";

export const EQUIPMENT_RESPONSIBLE_RECIPIENT_RULE = "EQUIPMENT_RESPONSIBLE";
export const ORDER_ALLOCATION_DYNAMIC_RECIPIENT_RULE = "ORDER_ALLOCATION_DYNAMIC";
export const FIXED_USERS_RECIPIENT_RULE = "FIXED_USERS";

const EQUIPMENT_FAULT_TEMPLATE = "【设备故障提醒】\n\n事业部：{divisionName}\n设备编号：{equipmentCode}\n设备名称：{equipmentName}\n\n故障时间：{oldFaultMinutes}分钟 → {newFaultMinutes}分钟\n故障原因：{faultReason}\n\n填报人：{actorName}\n时间：{occurredAt}\n\n请及时处理。";
const SHIPPING_PLAN_KEY_FIELDS_CHANGED_TEMPLATE = "【出货计划变更】\n\n客户：{customerCode}\n订单：{orderNumber}\n品项：{itemCode} {itemName}\n事业部：{divisionName}\n\n变更内容：\n{changeSummary}\n\n修改人：{actorName}\n时间：{occurredAt}\n\n请相关人员确认后续计划。";

const definitions = [
  {
    eventType: "finance.monthly.daily_summary",
    moduleCode: "finance",
    resourceCode: "finance-e10-monthly",
    label: "财务月度数据每日汇总",
    conditionDescription: "每天08:30（上海时间）汇总当月有效订单；仅向已启用规则配置的接收人推送",
    defaultChannel: "WECHAT_WORK",
    messageType: "text",
    defaultTemplate: "【财务月度数据汇总】\n\n月份：{yearMonth}\n订单数：{orderCount}\n本币总金额：{orderTotal}元\n\n事业部分布：\n{departmentSummary}\n\n汇总时间：{occurredAt}\n最近数据读取：{lastReadAt}",
    allowedRecipientRules: [FIXED_USERS_RECIPIENT_RULE],
    templateVariables: [
      { key: "yearMonth", label: "汇总月份" },
      { key: "orderCount", label: "有效订单数" },
      { key: "orderTotal", label: "本币总金额（元）" },
      { key: "departmentSummary", label: "事业部分布" },
      { key: "occurredAt", label: "汇总时间" },
      { key: "lastReadAt", label: "最近数据读取时间" }
    ]
  },
  { eventType: "mps.order_allocation.batch_changed", moduleCode: "planning", resourceCode: "mps-order-allocations", label: "订单分配新增/变更", conditionDescription: "订单分配实际新增或非金额业务字段变更时按操作批次触发", defaultChannel: "WECHAT_WORK", messageType: "text_file", defaultTemplate: "【PMC订单分配通知】", allowedRecipientRules: [ORDER_ALLOCATION_DYNAMIC_RECIPIENT_RULE], templateVariables: [{key:"actorName",label:"操作人"},{key:"occurredAt",label:"操作时间"},{key:"batchId",label:"操作批次"}] },
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
