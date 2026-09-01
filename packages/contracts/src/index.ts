import { legacyMonthlyPlanColumns, monthlyPlanColumns, type ColumnDefinition } from "@tracker/shared";

export type PlanVersionStatus = "DRAFT" | "PUBLISHED" | "LOCKED" | "ARCHIVED";
export type PlanningFieldDataType = "text" | "date" | "decimal" | "image" | "dictionary" | "uuid" | "integer";
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
  editorType?: "text" | "date" | "decimal" | "dictionary";
  sourceType: PlanningFieldSource;
  dictionaryCode?: string;
  pinned?: boolean;
}

const widths: Record<string, number> = {
  sequence: 52, orderNumber: 104, orderDate: 72, customerDueDate: 76, reviewDueDate: 76,
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
  editorType: column.kind === "dictionary" ? "dictionary" : column.kind === "date" ? "date" : column.kind === "decimal" ? "decimal" : column.kind === "image" ? undefined : "text",
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

/**
 * Single registry for every independently authorized table/report in KDOS.
 * New UI tables must be registered here before they are exposed by an API.
 */
export const tableResourceRegistry = [
  { code: "sales-summary-dashboard", label: "销售接单汇总大屏", module: "公司驾驶舱", moduleCode: "cockpit" },
  { code: "rolling-plan", label: "销售接单明细", module: "PMC中心", moduleCode: "planning" },
  { code: "monthly-plan", label: "月度计划", module: "PMC中心", moduleCode: "planning" },
  { code: "sales-orders", label: "订单表", module: "数据中心", moduleCode: "data" },
  { code: "finished-goods-inbound", label: "入库表", module: "数据中心", moduleCode: "data" },
  { code: "finished-goods-outbound", label: "出库表", module: "数据中心", moduleCode: "data" },
  { code: "duplicate-order-review", label: "重复订单业务复核", module: "数据中心", moduleCode: "data" },
  { code: "business-customer-mapping", label: "业务人员与客户对应表", module: "营销中心", moduleCode: "marketing" },
  { code: "order-schedule", label: "订单排期", module: "营销中心", moduleCode: "marketing" },
  { code: "hr-departure-check", label: "离职人员检查", module: "人力资源", moduleCode: "hr" },
  { code: "weekly-plan", label: "周计划", module: "PMC中心", moduleCode: "planning" },
  { code: "work-report", label: "报工表", module: "PMC中心", moduleCode: "planning" },
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

export type TablePermissionFieldType = "text" | "number" | "date" | "dictionary" | "member" | "department" | "boolean";
export interface TablePermissionFieldDefinition {
  key: string;
  label: string;
  type: TablePermissionFieldType;
  editable: boolean;
  required?: boolean;
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
  "monthly-plan": planningFieldRegistry.map((field) => ({ key: field.code, label: field.label, type: field.dataType === "decimal" || field.dataType === "integer" ? "number" : field.dataType === "uuid" ? "member" : field.dataType === "dictionary" ? "dictionary" : field.dataType === "date" ? "date" : "text", editable: field.editable, required: field.required })),
  "rolling-plan": fields([["orderNumber", "订单号"], ["orderDate", "下单日期", "date"], ["customerDueDate", "客户要求交期", "date"], ["itemNumber", "品号"], ["itemName", "品名"], ["productionQuantity", "订单需求数量", "number"], ["balanceQuantity", "订单欠数", "number", false], ["customer", "客户"]]),
  "sales-orders": fields([["customerCode", "客户代码"], ["customerName", "客户名称"], ["orderNumber", "订单编号"], ["orderDate", "订单日期", "date"], ["itemNumber", "品项编码"], ["itemName", "品项名称"], ["quantity", "订单数量", "number"], ["unit", "生产单位"], ["customerDueDate", "客户交期", "date"]]),
  "finished-goods-inbound": fields([["inboundDate", "入库日期", "date"], ["customerCode", "客户代码"], ["orderNumber", "订单编号"], ["itemNumber", "品项编码"], ["itemName", "品项名称"], ["quantity", "入库数量", "number"], ["warehouse", "仓库"]]),
  "finished-goods-outbound": fields([["outboundDate", "出库日期", "date"], ["customerCode", "客户代码"], ["orderNumber", "订单编号"], ["itemNumber", "品项编码"], ["itemName", "品项名称"], ["quantity", "出库数量", "number"], ["warehouse", "仓库"], ["deliveryNumber", "出库单号"]]),
  "duplicate-order-review": fields([["duplicateLevel", "重复等级"], ["suggestedAction", "建议动作"], ["e10OrderNumber", "E10订单号"], ["tplusOrderNumber", "T+订单号"], ["sourceAccountName", "来源账套"], ["customerSummary", "客户"], ["e10ItemQuantitySummary", "E10品项及数量摘要"], ["tplusItemQuantitySummary", "T+品项及数量摘要"], ["totalQuantityConsistent", "总数量是否一致", "boolean"], ["deliveryDateConsistent", "交期是否一致", "boolean"], ["matchingRule", "匹配规则"], ["matchingReason", "匹配理由"], ["systemSuggestion", "系统建议"], ["businessConfirmationStatus", "业务确认状态"], ["businessConfirmedBy", "业务确认人"], ["businessConfirmedAt", "业务确认日期", "date"], ["businessRemark", "备注"]]),
  "business-customer-mapping": fields([["departmentId", "部门", "department"], ["section", "课室"], ["customerCode", "客户"], ["salespersonUserIds", "业务员", "member"]]),
  "order-schedule": fields([["customerCode", "客户代码"], ["departmentId", "部门", "department", false], ["section", "课室", "text", false], ["salespersonUserIds", "业务员", "member", false], ["orderNumber", "订单编号"], ["itemNumber", "品项编码"], ["itemName", "品项名称"], ["customerDueDate", "客户交期", "date"], ["totalQuantity", "订单总数量", "number"], ["productionUnit", "生产单位"], ["completionRate", "订单完成比例", "number", false]]),
  "hr-departure-check": fields([["account", "账号"], ["name", "姓名"], ["status", "状态", "dictionary", false]]),
  "weekly-plan": fields([["customerCode", "客户代码"], ["orderNumber", "订单编号"], ["itemNumber", "品项编码"], ["itemName", "品项名称"], ["customerDueDate", "客户交期", "date"], ["reviewDueDate", "评审交期", "date"], ["completionRate", "完成比例", "number", false]]),
  "work-report": fields([["workDate", "日期", "date"], ["customer", "客户"], ["orderNumber", "订单编码"], ["itemNumber", "品项编码"], ["itemName", "品名"], ["requiredQuantity", "需求数量", "number", false], ["reportedQuantity", "报工数量", "number"]]),
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
