import { legacyMonthlyPlanColumns, monthlyPlanColumns, type ColumnDefinition } from "@tracker/shared";

export type PlanVersionStatus = "DRAFT" | "PUBLISHED" | "LOCKED" | "ARCHIVED";
export type PlanningFieldDataType = "text" | "date" | "decimal" | "image" | "dictionary" | "department" | "uuid" | "integer";
export type PlanningFieldSource = "CORE" | "PROCESS" | "CALCULATED" | "DISPLAY" | "INTEGRATION" | "EXTENSION";
export type FieldAccess = "HIDDEN" | "READONLY" | "EDITABLE" | "MASKED";

export interface PlanningFieldDefinition {
  code: string;
  label: string;
  groupCode: string;
  groupLabel: string;
  dataType: PlanningFieldDataType;
  width: number;
  order: number;
  visible: boolean;
  editable: boolean;
  sortable: boolean;
  filterable: boolean;
  required: boolean;
  permissionCode: string;
  rendererType?: "image" | "date" | "datetime" | "status" | "decimal";
  editorType?: "text" | "date" | "decimal" | "dictionary" | "department";
  sourceType: PlanningFieldSource;
  dictionaryCode?: string;
  pinned?: boolean;
}

const widths: Record<string, number> = {
  sequence: 52, responsibleOrgId: 88, customer: 110, orderNumber: 104, orderDate: 72, customerDueDate: 76, reviewDueDate: 76,
  exceptionDueDate: 76, exceptionDeliveryMethod: 76, containerDate: 72, modelAge: 52,
  itemNumber: 90, relationKey: 132, itemName: 100, image: 54, productAttribute: 60,
  surfaceNature: 60, specialItem: 52, productionQuantity: 72, historicalInboundQuantity: 72,
  todayInboundQuantity: 68, balanceQuantity: 68, handlingMethod: 68, itemStatus: 68
};

function sourceType(column: ColumnDefinition): PlanningFieldSource {
  if (column.key.startsWith("processes.")) return "PROCESS";
  if (["balanceQuantity", "itemStatus", "inboundAmount", "balanceAmount", "month"].includes(column.key)) return "CALCULATED";
  if (column.kind === "image") return "DISPLAY";
  if (column.key === "relationKey") return "INTEGRATION";
  return "CORE";
}

function groupCode(column: ColumnDefinition) {
  if (column.key.startsWith("processes.")) return `process.${column.key.split(".")[1]}`;
  if (column.group === "外协相关") return "outsourcing";
  return "plan";
}

function fieldRegistry(columns: ColumnDefinition[], hideRelationKey = false): PlanningFieldDefinition[] { return columns.map((column, index) => ({
  code: column.key,
  label: column.header,
  groupCode: groupCode(column),
  groupLabel: column.group ?? "计划信息",
  dataType: column.kind,
  width: widths[column.key] ?? 82,
  order: index + 10,
  visible: !hideRelationKey || column.key !== "relationKey",
  editable: Boolean(column.editable),
  sortable: true,
  filterable: true,
  required: ["orderNumber", "itemNumber", "productionQuantity"].includes(column.key),
  permissionCode: `planning.plan.field.${column.key}`,
  rendererType: column.kind === "image" ? "image" : column.kind === "date" ? "date" : column.key.endsWith("status") || column.key === "itemStatus" ? "status" : column.kind === "decimal" ? "decimal" : undefined,
  editorType: column.kind === "department" ? "department" : column.kind === "dictionary" ? "dictionary" : column.kind === "date" ? "date" : column.kind === "decimal" ? "decimal" : column.kind === "image" ? undefined : "text",
  sourceType: sourceType(column),
  dictionaryCode: column.dictionaryCode,
  pinned: Boolean(column.pinned) || column.key === "relationKey"
})); }

/** Preserved for historical migrations; it is not exposed by the active monthly-plan page. */
export const legacyPlanningFieldRegistry = fieldRegistry(legacyMonthlyPlanColumns, true);
/** Exact field contract for the active monthly-plan page, import and export. */
export const monthlyPlanningFieldRegistry = fieldRegistry(monthlyPlanColumns);

const planningAuditSeeds: Array<{
  code: string; label: string; dataType: PlanningFieldDataType; width: number; rendererType?: PlanningFieldDefinition["rendererType"];
}> = [
  { code: "createdBy", label: "创建人", dataType: "uuid", width: 150 },
  { code: "createdAt", label: "创建时间", dataType: "text", width: 168, rendererType: "datetime" },
  { code: "updatedBy", label: "更新人", dataType: "uuid", width: 150 },
  { code: "updatedAt", label: "更新时间", dataType: "text", width: 168, rendererType: "datetime" }
];

export const planningAuditFieldRegistry: PlanningFieldDefinition[] = planningAuditSeeds.map((field, index) => ({
  ...field,
  groupCode: "audit",
  groupLabel: "审计信息",
  order: 10_000 + index,
  visible: true,
  editable: false,
  sortable: true,
  filterable: true,
  required: false,
  permissionCode: `planning.plan.field.${field.code}`,
  sourceType: "DISPLAY" as const
}));

export const orchestrationFieldRegistry: PlanningFieldDefinition[] = [
  ["priority", "优先级", "integer", 72],
  ["planSequence", "计划顺序", "integer", 76],
  ["responsibleOrgId", "责任组织", "uuid", 118],
  ["ownerUserId", "负责人", "uuid", 108],
  ["planningStatus", "计划状态", "text", 88]
].map(([code, label, dataType, width], index) => ({
  code: String(code), label: String(label), groupCode: "orchestration", groupLabel: "计划编排",
  dataType: dataType as PlanningFieldDataType, width: Number(width), order: index + 1,
  visible: true, editable: true, sortable: true, filterable: true, required: false,
  permissionCode: `planning.plan.field.${code}`, editorType: dataType === "integer" ? "decimal" : "text",
  sourceType: "CORE" as const, pinned: index < 2
}));

export const planningFieldRegistry = [...monthlyPlanningFieldRegistry, ...planningAuditFieldRegistry];

export const planningPermissions = [
  "planning.plan.read", "planning.plan.create", "planning.plan.update", "planning.plan.delete",
  "planning.plan.publish", "planning.plan.lock", "planning.plan.unlock", "planning.plan.import",
  "planning.plan.export", "planning.plan.move", "planning.process.read", "planning.process.update",
  "planning.progress.read", "planning.progress.update", "planning.admin.manage"
] as const;

export const tablePermissionActions = ["read", "create", "copy", "update", "delete", "batch_print", "batch_update", "import", "export"] as const;
export type TablePermissionAction = typeof tablePermissionActions[number];

export const presetPermissionGroupTypes = ["ADD_ONLY", "ADD_MANAGE_OWN", "ADD_VIEW_ALL", "MANAGE_ALL", "VIEW_ALL"] as const;
export type PresetPermissionGroupType = typeof presetPermissionGroupTypes[number];

/** Immutable server-side truth for KDOS system permission groups. Display names are deliberately not used as keys. */
export const presetTablePermissionMatrix: Record<PresetPermissionGroupType, Readonly<Record<TablePermissionAction, boolean>>> = {
  ADD_ONLY:       { read: false, create: true,  copy: false, update: false, delete: false, batch_print: false, batch_update: false, import: false, export: false },
  ADD_MANAGE_OWN: { read: true,  create: true,  copy: true,  update: true,  delete: true,  batch_print: true,  batch_update: true,  import: false, export: true  },
  ADD_VIEW_ALL:   { read: true,  create: true,  copy: false, update: false, delete: false, batch_print: true,  batch_update: false, import: false, export: false },
  MANAGE_ALL:     { read: true,  create: true,  copy: true,  update: true,  delete: true,  batch_print: true,  batch_update: true,  import: false, export: true  },
  VIEW_ALL:       { read: true,  create: false, copy: false, update: false, delete: false, batch_print: true,  batch_update: false, import: false, export: false }
};

export const presetTablePermissionDataScope: Record<PresetPermissionGroupType, "NONE" | "OWN" | "ALL"> = {
  ADD_ONLY: "NONE", ADD_MANAGE_OWN: "OWN", ADD_VIEW_ALL: "ALL", MANAGE_ALL: "ALL", VIEW_ALL: "ALL"
};

/** Stable module identities used by administrator grants. Labels are display-only. */
export const administrableModuleRegistry = [
  { code: "cockpit", label: "公司驾驶舱" },
  { code: "planning", label: "PMC中心" },
  { code: "data", label: "数据中心" },
  { code: "marketing", label: "营销中心" },
  { code: "hr", label: "人力资源" },
  { code: "workflow", label: "流程审批" }
] as const;
export type AdministrableModuleCode = typeof administrableModuleRegistry[number]["code"];

/** New master-plan tables. These stable codes are deliberately independent from the retained legacy planning forms. */
export const masterPlanResourceDefinitions = [
  { code: "mps-erp-orders", label: "ERP订单明细", area: "数据准备" },
  { code: "mps-customer-divisions", label: "客户事业部映射", area: "数据准备" },
  { code: "mps-order-allocations", label: "订单分配表", area: "数据准备" },
  { code: "mps-process-cycles", label: "工序周期表", area: "数据准备" },
  { code: "mps-group-plans", label: "集团主计划", area: "计划管理" },
  { code: "mps-monthly-plans", label: "事业部月度计划", area: "计划管理" },
  { code: "mps-shipping-plans", label: "出货计划表", area: "计划管理" },
  { code: "mps-base-plans", label: "事业部基础计划表", area: "计划管理" },
  { code: "mps-weekly-plans", label: "事业部周计划", area: "计划管理" },
  { code: "mps-weekly-process-plans", label: "周计划工序明细", area: "计划管理" },
  { code: "mps-technical-reports", label: "技术报工表", area: "生产执行" },
  { code: "mps-material-reports", label: "主材报工表", area: "生产执行" },
  { code: "mps-outsourcing-reports", label: "外协报工表", area: "生产执行" },
  { code: "mps-process-reports", label: "工序报工表", area: "生产执行" },
  { code: "mps-sync-configs", label: "同步配置", area: "系统运维" },
  { code: "mps-sync-logs", label: "同步日志", area: "系统运维" },
  { code: "mps-data-exceptions", label: "数据异常", area: "系统运维" },
  { code: "mps-system-settings", label: "系统参数", area: "系统运维" }
] as const;

/**
 * Single registry for every independently authorized table/report in KDOS.
 * New UI tables must be registered here before they are exposed by an API.
 */
export const tableResourceRegistry = [
  { code: "sales-summary-dashboard", label: "销售接单汇总大屏", module: "公司驾驶舱", moduleCode: "cockpit" },
  { code: "on-hand-summary-dashboard", label: "集团主计划", module: "PMC中心", moduleCode: "planning" },
  { code: "rolling-plan", label: "销售接单明细", module: "PMC中心", moduleCode: "planning" },
  { code: "monthly-plan", label: "月度计划", module: "PMC中心", moduleCode: "planning" },
  { code: "rolling-plan-table", label: "滚动计划表", module: "PMC中心", moduleCode: "planning" },
  { code: "division-order-review", label: "事业部订单评审", module: "PMC中心", moduleCode: "planning" },
  { code: "sales-orders", label: "订单表", module: "数据中心", moduleCode: "data" },
  { code: "finished-goods-inbound", label: "入库表", module: "数据中心", moduleCode: "data" },
  { code: "finished-goods-outbound", label: "出库表", module: "数据中心", moduleCode: "data" },
  { code: "duplicate-order-review", label: "重复订单业务复核", module: "数据中心", moduleCode: "data" },
  { code: "supplier-list", label: "供应商清单", module: "数据中心", moduleCode: "data" },
  { code: "business-customer-mapping", label: "业务人员与客户对应表", module: "营销中心", moduleCode: "marketing" },
  { code: "order-schedule", label: "订单排期", module: "营销中心", moduleCode: "marketing" },
  { code: "hr-departure-check", label: "离职人员检查", module: "人力资源", moduleCode: "hr" },
  { code: "weekly-plan", label: "周计划", module: "PMC中心", moduleCode: "planning" },
  { code: "work-report", label: "报工表", module: "PMC中心", moduleCode: "planning" },
  { code: "equipment-register", label: "设备总台账", module: "PMC中心", moduleCode: "planning" },
  { code: "equipment-status-report", label: "设备状态填报", module: "PMC中心", moduleCode: "planning" },
  { code: "equipment-dashboard", label: "集团设备大屏", module: "PMC中心", moduleCode: "planning" },
  ...masterPlanResourceDefinitions.map(({ code, label }) => ({ code, label, module: "PMC中心" as const, moduleCode: "planning" as const })),
  { code: "development-requests", label: "需求提报与审批", module: "流程审批", moduleCode: "workflow" },
  { code: "approval-flow-configs", label: "审批流程配置", module: "流程审批", moduleCode: "workflow" },
  { code: "suppliers", label: "供应商", module: "系统管理", moduleCode: "system" },
  { code: "dictionaries", label: "字典", module: "系统管理", moduleCode: "system" },
  { code: "processes", label: "工序", module: "系统管理", moduleCode: "system" },
  { code: "users", label: "用户", module: "系统管理", moduleCode: "system" },
  { code: "roles", label: "角色与权限", module: "系统管理", moduleCode: "system" },
  { code: "organization", label: "组织架构", module: "系统管理", moduleCode: "system" },
  { code: "contacts", label: "通讯录", module: "系统管理", moduleCode: "system" },
  { code: "imports", label: "导入记录", module: "系统管理", moduleCode: "system" },
  { code: "audit-logs", label: "审计日志", module: "系统管理", moduleCode: "system" },
  { code: "api-keys", label: "API Key", module: "系统管理", moduleCode: "system" },
  { code: "tplus-sales-orders", label: "T+ 销售订单同步", module: "系统管理", moduleCode: "system" },
  { code: "customer-data-import", label: "客户数据导入", module: "系统管理", moduleCode: "system" }
] as const;

export type TableResourceCode = typeof tableResourceRegistry[number]["code"];

export interface OnHandSummaryContract {
  source: {
    year: number;
    month: number;
    periodId: string | null;
    versionId: string | null;
    versionName: string | null;
    versionStatus: PlanVersionStatus | null;
  };
  visibleFields: string[];
  metrics: Partial<{
    itemCount: number;
    orderCount: number;
    customerCount: number;
    productionQuantity: string;
    historicalInboundQuantity: string;
    todayInboundQuantity: string;
    inboundQuantity: string;
    balanceQuantity: string;
    completionRate: number;
  }>;
  statusCounts: Partial<Record<"完成" | "进行中" | "即将延期" | "延期", number>>;
  divisionRows: Array<Partial<{
    divisionId: string | null;
    divisionName: string;
    divisionPath: string;
    itemCount: number;
    orderCount: number;
    productionQuantity: string;
    inboundQuantity: string;
    balanceQuantity: string;
    completionRate: number;
  }>>;
  customerRows: Array<Partial<{
    customer: string;
    itemCount: number;
    orderCount: number;
    productionQuantity: string;
    inboundQuantity: string;
    balanceQuantity: string;
    completionRate: number;
  }>>;
  processRows: Array<Partial<{
    processCode: string;
    processName: string;
    itemCount: number;
    completedCount: number;
    overdueCount: number;
    exceptionCount: number;
    completionRate: number;
  }>>;
  warningRows: Array<Partial<{
    id: string;
    orderNumber: string;
    itemNumber: string;
    itemName: string | null;
    customer: string;
    divisionName: string;
    customerDueDate: string | null;
    itemStatus: string;
    balanceQuantity: string;
    remainingDays: number | null;
  }>>;
}

export type TablePermissionFieldType = "text" | "number" | "date" | "dictionary" | "member" | "department" | "boolean";
export interface TablePermissionFieldDefinition {
  key: string;
  label: string;
  type: TablePermissionFieldType;
  editable: boolean;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}

const auditPermissionFields: TablePermissionFieldDefinition[] = [
  { key: "createdBy", label: "创建人", type: "member", editable: false },
  { key: "createdAt", label: "创建时间", type: "date", editable: false },
  { key: "updatedBy", label: "更新人", type: "member", editable: false },
  { key: "updatedAt", label: "更新时间", type: "date", editable: false }
];
const fields = (items: Array<[string, string, TablePermissionFieldType?, boolean?, boolean?]>) => [
  ...items.map(([key, label, type = "text", editable = true, required = false]) => ({ key, label, type, editable, required })),
  ...auditPermissionFields
];

/** Server-validated field identities used by the per-table permission editor. */
export const tablePermissionFieldRegistry: Partial<Record<TableResourceCode, TablePermissionFieldDefinition[]>> = {
  "sales-summary-dashboard": fields([["customer", "客户", "text", false], ["orderCount", "订单数", "number", false], ["orderQuantity", "订单数量", "number", false], ["completedQuantity", "完成数量", "number", false], ["balanceQuantity", "欠数", "number", false], ["completionRate", "完成比例", "number", false]]),
  "on-hand-summary-dashboard": fields([
    ["orderNumber", "订单号", "text", false], ["itemNumber", "品号", "text", false], ["itemName", "品名", "text", false],
    ["customer", "客户", "text", false], ["customerDueDate", "客户要求交期", "date", false], ["itemStatus", "品号状态", "text", false],
    ["itemCount", "品号数", "number", false], ["orderCount", "订单数", "number", false], ["customerCount", "客户数", "number", false],
    ["productionQuantity", "订单需求数量", "number", false], ["historicalInboundQuantity", "历史入库数量", "number", false],
    ["todayInboundQuantity", "当天入库数量", "number", false], ["inboundQuantity", "累计入库数量", "number", false],
    ["balanceQuantity", "在手欠数", "number", false], ["completionRate", "完成比例", "number", false],
    ["processName", "工序", "text", false], ["completedCount", "完成项数", "number", false],
    ["overdueCount", "延期项数", "number", false], ["exceptionCount", "异常项数", "number", false],
    ["responsibleOrgId", "事业部", "department", false], ["ownerUserId", "负责人", "member", false]
  ]),
  "monthly-plan": planningFieldRegistry.map((field) => ({ key: field.code, label: field.label, type: field.dataType === "decimal" || field.dataType === "integer" ? "number" : field.dataType === "department" ? "department" : field.dataType === "uuid" ? "member" : field.dataType === "dictionary" ? "dictionary" : field.dataType === "date" ? "date" : "text", editable: field.editable, required: field.required })),
  "rolling-plan-table": planningFieldRegistry.map((field) => ({ key: field.code, label: field.label, type: field.dataType === "decimal" || field.dataType === "integer" ? "number" : field.dataType === "department" ? "department" : field.dataType === "uuid" ? "member" : field.dataType === "dictionary" ? "dictionary" : field.dataType === "date" ? "date" : "text", editable: false, required: field.required })),
  "rolling-plan": fields([["orderNumber", "订单号"], ["orderDate", "下单日期", "date"], ["customerDueDate", "客户要求交期", "date"], ["itemNumber", "品号"], ["itemName", "品名"], ["productionQuantity", "订单需求数量", "number"], ["balanceQuantity", "订单欠数", "number", false], ["customer", "客户"]]),
  "sales-orders": fields([["customerCode", "客户代码"], ["customerName", "客户名称"], ["orderNumber", "订单编号"], ["orderDate", "订单日期", "date"], ["itemNumber", "品项编码"], ["itemName", "品项名称"], ["quantity", "订单数量", "number"], ["unit", "生产单位"], ["customerDueDate", "客户交期", "date"]]),
  "finished-goods-inbound": fields([["inboundDate", "入库日期", "date"], ["customerCode", "客户代码"], ["orderNumber", "订单编号"], ["itemNumber", "品项编码"], ["itemName", "品项名称"], ["quantity", "入库数量", "number"], ["warehouse", "仓库"]]),
  "finished-goods-outbound": fields([["outboundDate", "出库日期", "date"], ["customerCode", "客户代码"], ["orderNumber", "订单编号"], ["itemNumber", "品项编码"], ["itemName", "品项名称"], ["quantity", "出库数量", "number"], ["warehouse", "仓库"], ["deliveryNumber", "出库单号"]]),
  "duplicate-order-review": fields([["duplicateLevel", "重复等级"], ["suggestedAction", "建议动作"], ["e10OrderNumber", "E10订单号"], ["tplusOrderNumber", "T+订单号"], ["sourceAccountName", "来源账套"], ["customerSummary", "客户"], ["e10ItemQuantitySummary", "E10品项及数量摘要"], ["tplusItemQuantitySummary", "T+品项及数量摘要"], ["totalQuantityConsistent", "总数量是否一致", "boolean"], ["deliveryDateConsistent", "交期是否一致", "boolean"], ["matchingRule", "匹配规则"], ["matchingReason", "匹配理由"], ["systemSuggestion", "系统建议"], ["businessConfirmationStatus", "业务确认状态"], ["businessConfirmedBy", "业务确认人"], ["businessConfirmedAt", "业务确认日期", "date"], ["businessRemark", "备注"]]),
  "supplier-list": fields([
    ["sourceSystem", "来源系统", "text", false], ["sourceDatabase", "来源数据库", "text", false], ["sourceAccountName", "来源账套", "text", false],
    ["sourceId", "来源主键", "text", false], ["code", "供应商编码", "text", false, true], ["name", "供应商名称", "text", false, true],
    ["abbreviation", "供应商简称", "text", false], ["shorthand", "助记码", "text", false], ["categoryCode", "分类编码", "text", false],
    ["categoryName", "供应商分类", "text", false], ["partnerTypeLabel", "往来单位类型", "text", false], ["representative", "法人代表", "text", false],
    ["contact", "联系人", "text", false], ["mobilePhone", "手机", "text", false], ["telephone", "电话", "text", false],
    ["fax", "传真", "text", false], ["email", "邮箱", "text", false], ["address", "地址", "text", false],
    ["enabled", "状态", "boolean", false], ["sourceUpdatedAt", "T+更新时间", "date", false]
  ]),
  "business-customer-mapping": fields([["departmentId", "部门", "department"], ["section", "课室"], ["customerCode", "客户"], ["salespersonUserIds", "业务员", "member"]]),
  "order-schedule": fields([["customerCode", "客户代码"], ["departmentId", "部门", "department", false], ["section", "课室", "text", false], ["salespersonUserIds", "业务员", "member", false], ["orderNumber", "订单编号"], ["itemNumber", "品项编码"], ["itemName", "品项名称"], ["customerDueDate", "客户交期", "date"], ["orderTotalQuantity", "订单总数量", "number"], ["productionUnit", "生产单位"], ["completionRatio", "订单完成比例", "number"], ["status", "状态", "dictionary"]]),
  "division-order-review": fields([["customerCode", "客户代码", "text", false], ["departmentId", "部门", "department", false], ["section", "课室", "text", false], ["salespersonUserIds", "业务员", "member", false], ["orderNumber", "订单编号", "text", false], ["itemNumber", "品项编码", "text", false], ["itemName", "品项名称", "text", false], ["customerDueDate", "客户交期", "date", false], ["divisionReviewDueDate", "事业部评审交期", "date"], ["deliveryConfirmation", "交期确认", "dictionary", false], ["orderTotalQuantity", "订单总数量", "number", false], ["productionUnit", "生产单位", "text", false], ["completionRatio", "订单完成比例", "number", false], ["status", "状态", "dictionary", false]]),
  "hr-departure-check": fields([["account", "账号"], ["name", "姓名"], ["status", "状态", "dictionary", false]]),
  "weekly-plan": fields([["customerCode", "客户代码"], ["orderNumber", "订单编号"], ["itemNumber", "品项编码"], ["itemName", "品项名称"], ["customerDueDate", "客户交期", "date"], ["reviewDueDate", "评审交期", "date"], ["completionRate", "完成比例", "number", false]]),
  "work-report": fields([["workDate", "日期", "date"], ["divisionId", "事业部", "department", false], ["customer", "客户"], ["orderNumber", "订单编码"], ["itemNumber", "品项编码"], ["itemName", "品名"], ["requiredQuantity", "需求数量", "number", false], ["reportedQuantity", "报工数量", "number"]]),
  "equipment-register": fields([["divisionId", "事业部", "department"], ["usageDepartmentId", "使用部门", "department"], ["equipmentCode", "设备编号"], ["equipmentName", "设备名称"], ["purchaseDate", "购买日期", "date"], ["plannedStartupMinutes", "设备计划开机时间", "number"], ["monitored", "纳入状态填报", "boolean"], ["responsibleUserIds", "责任人", "member"]]),
  "equipment-status-report": fields([["equipmentId", "设备编号"], ["equipmentName", "设备名称", "text", false], ["divisionId", "事业部", "department", false], ["usageDepartmentId", "使用部门", "department", false], ["responsibleUserIds", "责任人", "member", false], ["reportDate", "填报日期", "date"], ["runtimeMinutes", "运行时长", "number"], ["faultMinutes", "故障时长", "number"], ["faultReason", "故障原因", "dictionary"]]),
  "equipment-dashboard": fields([["divisionId", "事业部", "department", false], ["totalEquipment", "设备总数", "number", false], ["reportedEquipment", "已填报设备", "number", false], ["missingEquipment", "未填报设备", "number", false], ["reportingRate", "录入率", "number", false], ["runtimeMinutes", "运行时长", "number", false], ["faultMinutes", "故障时长", "number", false]]),
  "mps-erp-orders": fields([["sourceAccountName", "来源账套", "text", false], ["salespersonName", "业务员", "text", false], ["customerCode", "客户编码", "text", false], ["customerName", "客户名称", "text", false], ["orderNumber", "订单编号", "text", false], ["orderType", "订单类型", "text", false], ["orderDate", "下单日期", "date", false], ["customerDueDate", "客户交期", "date", false], ["preproductionReviewDate", "产前评审日期", "date", false], ["expectedShippingDate", "预计出货日期", "date", false], ["itemCode", "品项编码", "text", false], ["itemName", "品项名称", "text", false], ["unit", "单位", "text", false], ["orderQuantity", "订单数量", "number", false], ["taxIncludedUnitPrice", "含税单价", "number", false], ["taxIncludedAmount", "含税金额", "number", false], ["orderStatus", "订单状态", "text", false]]),
  "mps-customer-divisions": fields([["customerCode", "客户编码", "text", true, true], ["primaryDivisionId", "主责事业部", "department", true, true], ["enabled", "启用", "boolean"], ["remark", "备注"]]),
  "mps-order-allocations": fields([["salespersonName", "业务员"], ["customerCode", "客户编码"], ["orderNumber", "订单编号", "text", true, true], ["orderDate", "下单日期", "date"], ["expectedShippingDate", "预计出货日期", "date"], ["itemCode", "品项编码", "text", true, true], ["itemName", "品项名称"], ["unit", "单位"], ["orderQuantity", "订单数量", "number"], ["allocatedQuantity", "分配数量", "number", true, true], ["divisionId", "承接事业部", "department", true, true], ["remark", "备注"]]),
  "mps-process-cycles": fields([["itemCode", "品项编码", "text", true, true], ["itemName", "品项名称"], ["technicalDays", "技术周期", "number"], ["cuttingDays", "下料周期", "number"], ["machiningDays", "机加周期", "number"], ["bendingDays", "折弯周期", "number"], ["spotWeldingDays", "点焊周期", "number"], ["weldingDays", "焊接周期", "number"], ["woodworkingDays", "木作周期", "number"], ["grindingDays", "研磨周期", "number"], ["surfaceTreatmentDays", "表面处理周期", "number"], ["packagingDays", "包装周期", "number"]]),
  "mps-group-plans": fields([["sourceAccounts", "来源账套", "text", false], ["orderNumber", "订单编号", "text", false], ["orderType", "订单类型", "text", false], ["customerCode", "客户编码", "text", false], ["orderDate", "下单日期", "date", false], ["customerDueDate", "客户交期", "date", false], ["preproductionReviewDate", "产前评审日期", "date", false], ["orderAmount", "订单金额", "number", false], ["requiredQuantity", "需求数量", "number", false], ["primaryDivisionId", "主责事业部", "department", false], ["completedQuantity", "完成数量", "number", false], ["pendingQuantity", "待完成数量", "number", false], ["completionRate", "完成比例", "number", false]]),
  "mps-monthly-plans": fields([["divisionId", "承接事业部", "department", false], ["customerCode", "客户编码", "text", false], ["orderNumber", "订单编号", "text", false], ["itemCode", "品项编码", "text", false], ["itemName", "品项名称", "text", false], ["orderDate", "下单日期", "date", false], ["customerDueDate", "客户交期", "date", false], ["preproductionReviewDate", "产前评审日期", "date", false], ["latestCustomerDueDate", "最迟客户交期", "date"], ["modelAge", "新旧款", "dictionary"], ["productAttribute", "产品属性"], ["surfaceNature", "表面性质"], ["specialItem", "特殊事项"], ["requiredQuantity", "需求数量", "number", false], ["cumulativeInboundQuantity", "累计入库数量", "number", false], ["pendingQuantity", "欠数", "number", false], ["completionRate", "完成比例", "number", false], ["manufacturingMethod", "生产方式", "dictionary"], ["plannedPageCount", "计划页数", "number"], ["orderExceptionInfo", "订单异常信息"], ["inspectionRequired", "是否验货", "boolean"], ["inspectionQuantity", "验货数量", "number"], ["remark", "备注"], ["orderWeekCount", "下单周数", "number", false]]),
  "mps-shipping-plans": fields([["customerCode", "客户编码", "text", true, true], ["orderNumber", "订单编号", "text", true, true], ["itemCode", "品项编码", "text", true, true], ["itemName", "品项名称", "text", true, true], ["deliveryNumber", "交期编码", "number", true, true], ["orderDate", "下单日期", "date"], ["latestCustomerDueDate", "最迟客户交期", "date", true, true], ["plannedQuantity", "计划数量", "number", true, true], ["divisionId", "承接事业部", "department", true, true], ["modelAge", "新旧款", "dictionary", true], ["enteredWeeklyPlan", "已进入周计划", "boolean", false]]),
  "mps-base-plans": fields([["divisionId", "承接事业部", "department"], ["customerCode", "客户编码"], ["orderNumber", "订单编号", "text", true, true], ["itemCode", "品项编码", "text", true, true], ["itemName", "品项名称"], ["deliveryNumber", "交期编码", "number", true, true], ["orderDate", "下单日期", "date"], ["latestCustomerDueDate", "最迟客户交期", "date", true, true], ["plannedQuantity", "计划数量", "number", true, true], ["latestReviewDueDate", "最迟评审交期", "date", true, true], ["modelAge", "新旧款", "dictionary", true], ["productAttribute", "产品属性", "dictionary", true, true], ["surfaceNature", "表面性质", "dictionary", true, true], ["manufacturingMethod", "生产方式", "dictionary", true, true]]),
  "mps-weekly-plans": fields([["divisionId", "承接事业部", "department"], ["customerCode", "客户编码"], ["orderNumber", "订单编号", "text", true, true], ["itemCode", "品项编码", "text", true, true], ["itemName", "品项名称"], ["deliveryNumber", "交期编码", "number", true, true], ["orderDate", "下单日期", "date"], ["latestCustomerDueDate", "最迟客户交期", "date", true, true], ["latestReviewDueDate", "最迟评审交期", "date", true, true], ["plannedQuantity", "计划数量", "number", true, true], ["allocatedInboundQuantity", "分摊入库数量", "number"], ["pendingQuantity", "欠数", "number", false], ["manufacturingMethod", "生产方式", "dictionary"], ["drawingDueDate", "图纸交期", "date", false], ["hardwareDueDate", "五金交期", "date", false], ["woodDueDate", "木作交期", "date", false], ["orderExceptionInfo", "订单异常信息"], ["inspectionRequired", "是否验货", "boolean"], ["inspectionQuantity", "验货数量", "number"], ["remark", "备注"]]),
  "mps-weekly-process-plans": fields([["weeklyPlanId", "所属事业部周计划", "text", true, true], ["processCode", "工序", "dictionary", true, true], ["cycleDays", "周期天数", "number"], ["dueDate", "工序交期", "date"], ["reportDate", "报工日期", "date", true, true], ["dailyReportedQuantity", "当日报工", "number", false], ["status", "状态", "dictionary", false], ["exceptionText", "异常说明"]]),
  "mps-technical-reports": fields([["divisionId", "事业部", "department", false], ["orderNumber", "订单编号", "text", false], ["itemCode", "品项编码", "text", false], ["itemName", "品项名称", "text", false], ["deliveryNumber", "交期编码", "number", false], ["responsibleUserId", "责任人", "member"], ["drawingDueDate", "图纸交期", "date", false], ["status", "状态", "dictionary"], ["exceptionText", "异常说明"]]),
  "mps-material-reports": fields([["divisionId", "事业部", "department", false], ["weeklyPlanId", "所属事业部周计划", "text", true, true], ["orderNumber", "订单编号", "text", false], ["itemCode", "品项编码", "text", false], ["itemName", "品项名称", "text", false], ["deliveryNumber", "交期编码", "number", false], ["materialName", "主材", "dictionary", true, true], ["received", "已入库", "boolean"], ["actualInboundDate", "实际入库日期", "date"], ["exceptionText", "异常说明"]]),
  "mps-outsourcing-reports": fields([["divisionId", "事业部", "department", false], ["orderNumber", "订单编号", "text", false], ["itemCode", "品项编码", "text", false], ["itemName", "品项名称", "text", false], ["deliveryNumber", "交期编码", "number", false], ["purchaseOrderNumber", "采购单号"], ["supplierId", "供应商", "text"], ["outsourcingMethod", "外协方式", "dictionary"], ["outsourcingDueDate", "外协交期", "date"], ["cycleDays", "周期天数", "number"], ["received", "已入库", "boolean"], ["actualInboundDate", "实际入库日期", "date"], ["status", "状态", "dictionary", false], ["exceptionText", "异常说明"]]),
  "mps-process-reports": fields([["divisionId", "事业部", "department", false], ["weeklyPlanId", "所属事业部周计划", "text", true, true], ["orderNumber", "订单编号", "text", false], ["itemCode", "品项编码", "text", false], ["itemName", "品项名称", "text", false], ["deliveryNumber", "交期编码", "number", false], ["processCode", "工序", "dictionary", true, true], ["productionDate", "生产日期", "date", true, true], ["plannedQuantity", "计划数量", "number", false], ["productionQuantity", "报工数量", "number", true, true]]),
  "mps-sync-configs": fields([["syncKey", "同步编码", "text", false], ["name", "同步任务", "text", false], ["enabled", "启用", "boolean"], ["intervalMinutes", "间隔分钟", "number"], ["lastStartedAt", "最近开始", "date", false], ["lastSuccessAt", "最近成功", "date", false], ["lastFailureAt", "最近失败", "date", false], ["lastSyncCount", "最近同步数量", "number", false], ["status", "状态", "dictionary", false], ["errorMessage", "错误信息", "text", false]]),
  "mps-sync-logs": fields([["syncKey", "同步编码", "text", false], ["runType", "运行类型", "dictionary", false], ["status", "状态", "dictionary", false], ["startedAt", "开始时间", "date", false], ["completedAt", "完成时间", "date", false], ["syncCount", "同步数量", "number", false], ["errorMessage", "错误信息", "text", false], ["idempotencyKey", "幂等标识", "text", false]]),
  "mps-data-exceptions": fields([["resource", "来源表", "text", false], ["businessKey", "业务键", "text", false], ["exceptionType", "异常类型", "dictionary", false], ["severity", "级别", "dictionary", false], ["message", "异常说明", "text", false], ["active", "未解决", "boolean", false], ["resolvedAt", "解决时间", "date", false]]),
  "mps-system-settings": fields([["settingKey", "参数编码", "text", false], ["name", "参数名称", "text", false], ["valueJson", "参数值"], ["description", "说明", "text", false]]),
  "development-requests": fields([["requestNumber", "需求编号", "text", false], ["title", "标题"], ["category", "类别", "dictionary"], ["description", "需求说明"], ["urgency", "紧急程度", "dictionary"], ["desiredDate", "期望完成日期", "date"], ["status", "状态", "dictionary", false], ["requesterId", "申请人", "member", false]]),
  "approval-flow-configs": fields([["flowKey", "流程编码", "text", false], ["name", "流程名称"], ["enabled", "启用", "boolean"]]),
  "suppliers": fields([["code", "供应商编码"], ["name", "供应商名称"], ["enabled", "启用", "boolean"]]),
  "dictionaries": fields([["typeCode", "字典类型编码"], ["typeName", "字典类型"], ["value", "字典值"], ["label", "显示名称"], ["enabled", "启用", "boolean"]]),
  "processes": fields([["code", "工序编码"], ["name", "工序名称"], ["sortOrder", "排序", "number"], ["enabled", "启用", "boolean"]]),
  "users": fields([["username", "账号"], ["displayName", "姓名"], ["employeeNo", "工号"], ["division", "部门"], ["position", "职位"], ["mobile", "手机"], ["email", "邮箱"], ["enabled", "状态", "boolean"]]),
  "roles": fields([["name", "角色名称"], ["description", "角色描述"], ["roleGroupId", "角色组", "dictionary"]]),
  "organization": fields([["name", "部门名称"], ["parentId", "上级部门", "department"], ["leaderUserIds", "部门负责人", "member", false], ["level", "层级", "number", false], ["enabled", "状态", "boolean"]]),
  "contacts": fields([["employeeNo", "工号"], ["name", "姓名"], ["position", "职位"], ["telephone", "电话"], ["departmentPaths", "部门路径", "department", false], ["enabled", "状态", "boolean", false]]),
  "imports": fields([["fileName", "文件名"], ["resource", "导入表单"], ["status", "状态", "dictionary", false], ["successCount", "成功数", "number", false], ["failureCount", "失败数", "number", false]]),
  "audit-logs": fields([["actorName", "操作人", "member", false], ["resource", "表单", "text", false], ["action", "操作", "text", false], ["source", "来源", "text", false], ["requestId", "请求ID", "text", false]]),
  "api-keys": fields([["name", "名称"], ["scopes", "权限范围"], ["enabled", "启用", "boolean"], ["expiresAt", "到期时间", "date"]]),
  "tplus-sales-orders": fields([["source", "数据源", "dictionary", false], ["customerCode", "客户代码", "text", false], ["orderNumber", "订单编号", "text", false], ["orderDate", "订单日期", "date", false]]),
  "customer-data-import": fields([["source", "数据源", "dictionary"], ["customerCode", "客户代码"], ["status", "状态", "dictionary", false]])
};

const standardMpsProcesses = [
  ["cutting", "下料"], ["machining", "机加"], ["bending", "折弯"], ["spotWelding", "点焊"], ["welding", "焊接"],
  ["woodworking", "木作"], ["grinding", "研磨"], ["surfaceTreatment", "表面处理"], ["packaging", "包装"]
] as const;

const mpsProcessPermissionFields: TablePermissionFieldDefinition[] = standardMpsProcesses.flatMap(([code, label]) => [
  { key: `${code}CycleDays`, label: `${label}·所需周期`, type: "number" as const, editable: false },
  { key: `${code}DueDate`, label: `${label}·交期`, type: "date" as const, editable: false },
  { key: `${code}Status`, label: `${label}·状态`, type: "dictionary" as const, editable: false },
  { key: `${code}Exception`, label: `${label}·异常`, type: "text" as const, editable: false }
]);
const weeklyAuxiliaryPermissionFields: TablePermissionFieldDefinition[] = [
  { key: "technicalCycleDays", label: "技术/图纸计划·所需周期", type: "number", editable: false },
  { key: "technicalStatus", label: "技术/图纸计划·状态", type: "dictionary", editable: false },
  { key: "technicalException", label: "技术/图纸计划·异常", type: "text", editable: false },
  { key: "hardwareCycleDays", label: "五金主材计划·所需周期", type: "number", editable: false },
  { key: "hardwareStatus", label: "五金主材计划·状态", type: "dictionary", editable: false },
  { key: "hardwareException", label: "五金主材计划·异常", type: "text", editable: false },
  { key: "woodCycleDays", label: "木作主材计划·所需周期", type: "number", editable: false },
  { key: "woodStatus", label: "木作主材计划·状态", type: "dictionary", editable: false },
  { key: "woodException", label: "木作主材计划·异常", type: "text", editable: false },
  { key: "outsourcingCycleDays", label: "外协计划·所需周期", type: "number", editable: false },
  { key: "outsourcingDueDate", label: "外协计划·交期", type: "date", editable: false },
  { key: "outsourcingStatus", label: "外协计划·状态", type: "dictionary", editable: false },
  { key: "outsourcingException", label: "外协计划·异常", type: "text", editable: false },
  { key: "outsourcingActualInboundDate", label: "外协计划·实际入库日期", type: "date", editable: false }
];
const monthlyAuxiliaryPermissionFields: TablePermissionFieldDefinition[] = [
  { key: "technicalCycleDays", label: "技术/图纸计划·所需周期", type: "number", editable: false },
  { key: "drawingDueDate", label: "技术/图纸计划·图纸交期", type: "date", editable: false },
  { key: "technicalStatus", label: "技术/图纸计划·状态", type: "dictionary", editable: false },
  { key: "technicalException", label: "技术/图纸计划·异常", type: "text", editable: false },
  { key: "hardwareCycleDays", label: "五金主材计划·所需周期", type: "number", editable: false },
  { key: "hardwareDueDate", label: "五金主材计划·交期", type: "date", editable: false },
  { key: "hardwareStatus", label: "五金主材计划·状态", type: "dictionary", editable: false },
  { key: "hardwareException", label: "五金主材计划·异常", type: "text", editable: false },
  { key: "woodCycleDays", label: "木作主材计划·所需周期", type: "number", editable: false },
  { key: "woodDueDate", label: "木作主材计划·交期", type: "date", editable: false },
  { key: "woodStatus", label: "木作主材计划·状态", type: "dictionary", editable: false },
  { key: "woodException", label: "木作主材计划·异常", type: "text", editable: false },
  ...weeklyAuxiliaryPermissionFields.filter((field) => field.key.startsWith("outsourcing"))
];
for (const resource of ["mps-monthly-plans", "mps-weekly-plans"] as const) {
  const current = tablePermissionFieldRegistry[resource] ?? auditPermissionFields;
  tablePermissionFieldRegistry[resource] = [
    ...current.slice(0, -auditPermissionFields.length),
    ...(resource === "mps-weekly-plans" ? weeklyAuxiliaryPermissionFields : monthlyAuxiliaryPermissionFields),
    ...mpsProcessPermissionFields,
    ...auditPermissionFields
  ];
}

export const tablePermissionFieldsFor = (resource: TableResourceCode) => tablePermissionFieldRegistry[resource] ?? auditPermissionFields;

export interface PlanningPeriodContract {
  id: string;
  year: number;
  month: number;
  status: string;
  currentVersionId: string | null;
  versions: PlanningVersionContract[];
}

export interface PlanningVersionContract {
  id: string;
  periodId: string;
  versionNumber: number;
  name: string;
  status: PlanVersionStatus;
  basedOnVersionId: string | null;
  publishedAt: string | null;
  lockedAt: string | null;
}

export interface PlanningRiskSummary {
  overdue: Array<{ id: string; orderNumber: string; itemNumber: string; deliveryDate: string }>;
  dueSoon: Array<{ id: string; orderNumber: string; itemNumber: string; deliveryDate: string }>;
  processOverdue: Array<{ planItemId: string; processCode: string; plannedDate: string }>;
  openExceptions: Array<{ planItemId: string; processCode?: string; exception: string }>;
}
