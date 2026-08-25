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

/**
 * Single registry for every independently authorized table/report in KDOS.
 * New UI tables must be registered here before they are exposed by an API.
 */
export const tableResourceRegistry = [
  { code: "sales-summary-dashboard", label: "销售接单汇总大屏", module: "公司驾驶舱" },
  { code: "rolling-plan", label: "销售接单明细", module: "主计划" },
  { code: "monthly-plan", label: "月度计划", module: "主计划" },
  { code: "daily-progress", label: "日进度", module: "主计划" },
  { code: "sales-orders", label: "订单表", module: "数据中心" },
  { code: "finished-goods-inbound", label: "入库表", module: "数据中心" },
  { code: "business-customer-mapping", label: "业务人员与客户对应表", module: "营销中心" },
  { code: "order-schedule", label: "订单排期", module: "营销中心" },
  { code: "weekly-plan", label: "周计划", module: "主计划" },
  { code: "work-report", label: "报工表", module: "主计划" },
  { code: "development-requests", label: "需求提报与审批", module: "流程审批" },
  { code: "approval-flow-configs", label: "审批流程配置", module: "流程审批" },
  { code: "suppliers", label: "供应商", module: "系统管理" },
  { code: "dictionaries", label: "字典", module: "系统管理" },
  { code: "processes", label: "工序", module: "系统管理" },
  { code: "users", label: "用户", module: "系统管理" },
  { code: "roles", label: "角色与权限", module: "系统管理" },
  { code: "organization", label: "组织架构", module: "系统管理" },
  { code: "contacts", label: "通讯录", module: "系统管理" },
  { code: "imports", label: "导入记录", module: "系统管理" },
  { code: "audit-logs", label: "审计日志", module: "系统管理" },
  { code: "api-keys", label: "API Key", module: "系统管理" },
  { code: "tplus-sales-orders", label: "T+ 销售订单同步", module: "系统管理" }
] as const;

export type TableResourceCode = typeof tableResourceRegistry[number]["code"];

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
