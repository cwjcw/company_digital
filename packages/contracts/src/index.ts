import { standardProcesses } from "@tracker/shared";

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
  /* KN-MPS-WO-001：3天生产工单（PMC中心 → 生产执行），只能由“从周计划同步”生成。 */
  { code: "mps-three-day-work-orders", label: "3天生产工单", area: "生产执行" },
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
  { code: "sales-orders", label: "订单表", module: "数据中心", moduleCode: "data" },
  { code: "finished-goods-inbound", label: "入库表", module: "数据中心", moduleCode: "data" },
  { code: "finished-goods-outbound", label: "出库表", module: "数据中心", moduleCode: "data" },
  { code: "supplier-list", label: "供应商清单", module: "数据中心", moduleCode: "data" },
  { code: "business-customer-mapping", label: "业务人员与客户对应表", module: "营销中心", moduleCode: "marketing" },
  { code: "order-schedule", label: "订单排期", module: "营销中心", moduleCode: "marketing" },
  { code: "hr-departure-check", label: "离职人员检查", module: "人力资源", moduleCode: "hr" },
  { code: "equipment-register", label: "设备总台账", module: "PMC中心", moduleCode: "planning" },
  { code: "equipment-status-report", label: "设备状态填报", module: "PMC中心", moduleCode: "planning" },
  { code: "equipment-dashboard", label: "集团设备大屏", module: "PMC中心", moduleCode: "planning" },
  ...masterPlanResourceDefinitions.map(({ code, label }) => ({ code, label, module: "PMC中心" as const, moduleCode: "planning" as const })),
  { code: "development-requests", label: "需求提报与审批", module: "流程审批", moduleCode: "workflow" },
  { code: "approval-flow-configs", label: "审批流程配置", module: "流程审批", moduleCode: "workflow" },
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

/**
 * KDOS 正式字段语义类型（KN-FILTER-001 Phase 0）。
 * 旧的 7 种类型不足以表达时间戳、关联、结构化与附件字段，导致筛选与显示只能靠字段名猜语义。
 * 新增类型必须与筛选编译器、候选值查询、显示格式一致；不允许按字段名或当前值猜类型。
 */
export type TablePermissionFieldType =
  | "text" | "number" | "date" | "datetime" | "boolean" | "dictionary" | "member" | "department" | "reference" | "structured" | "attachment";

/** 数值显示/输入格式：百分比、时长（分钟）、金额、整数与普通小数必须区分。 */
export type TableFieldFormat = "plain" | "integer" | "decimal" | "percentage" | "durationMinutes" | "currency";

/** 筛选值来源：普通列、虚拟列（子查询/表达式）、关联表、聚合值或专用自定义绑定。 */
export type TableFilterBindingKind = "column" | "virtual" | "relation" | "aggregate" | "custom";
export interface TableFilterBinding {
  kind: TableFilterBindingKind;
  /** 安全表达式或关联提示，仅服务端使用；客户端不得下发 SQL/列名。 */
  expression?: string;
  /** reference 字段的候选来源资源（必须在 tableResourceRegistry 内）。 */
  referenceResource?: string;
  valueField?: string;
  labelField?: string;
  note?: string;
}

export interface TablePermissionFieldDefinition {
  key: string;
  label: string;
  type: TablePermissionFieldType;
  editable: boolean;
  required?: boolean;
  /** 多值字段（数组/多选）必须显式声明，不能用类型推断。 */
  multiple?: boolean;
  format?: TableFieldFormat;
  /**
   * 百分比字段的真实存储尺度（必须按数据库实际 CHECK/写入语义声明，禁止全局假设）：
   * - `ratio`（默认）：存储 0..1，界面按 0..100 输入并 /100 后提交（例：80% → 0.8）；
   * - `percent`：存储 0..100，界面原样输入（例：80 → 80）。
   */
  percentageScale?: "ratio" | "percent";
  /** KN-PRINT-001：是否允许进入打印投影。默认按类型判断（敏感字段、审计字段、structured/attachment 默认 false）。 */
  printable?: boolean;
  /** KN-PRINT-001：打印列标题（缺省使用 label）。 */
  printLabel?: string;
  /** 是否允许作为筛选条件；structured/attachment 默认不可筛选。 */
  filterable?: boolean;
  filterBinding?: TableFilterBinding;
  options?: Array<{ value: string; label: string }>;
}

/**
 * KN-MPS-UI-001 辅助计算字段（support projection）：
 * 只用于解释派生指标（例如生产进度 Tooltip 的「累计报工」），**不是业务字段**。
 * 它们不进入主表列、打印、Excel 导出/模板与字段权限编辑器；只在行投影中按需返回给界面做说明。
 * 判断口径：辅助字段绝不允许出现在 `tablePermissionFieldsFor(resource)` 里。
 */
export interface TableSupportFieldDefinition {
  key: string;
  label: string;
  type: TablePermissionFieldType;
  format?: TableFieldFormat;
}

const auditPermissionFields: TablePermissionFieldDefinition[] = [
  { key: "createdBy", label: "创建人", type: "member", editable: false },
  { key: "createdAt", label: "创建时间", type: "datetime", editable: false, format: "plain" },
  /* updated_by 在多数正式表是 varchar，可能存放 system / migration / 同步任务标识，不能强制按成员解析。 */
  { key: "updatedBy", label: "更新人", type: "text", editable: false },
  { key: "updatedAt", label: "更新时间", type: "datetime", editable: false, format: "plain" }
];
type FieldExtra = Pick<TablePermissionFieldDefinition, "multiple" | "format" | "percentageScale" | "filterable" | "filterBinding" | "options">;
const fields = (items: Array<[string, string, TablePermissionFieldType?, boolean?, boolean?, FieldExtra?]>) => [
  ...items.map(([key, label, type = "text", editable = true, required = false, extra]) => ({ key, label, type, editable, required, ...(extra ?? {}) })),
  ...auditPermissionFields
];

/** Server-validated field identities used by the per-table permission editor. */
export const tablePermissionFieldRegistry: Partial<Record<TableResourceCode, TablePermissionFieldDefinition[]>> = {
  "sales-summary-dashboard": fields([["customer", "客户", "text", false], ["orderCount", "订单数", "number", false], ["orderQuantity", "订单数量", "number", false], ["completedQuantity", "完成数量", "number", false], ["balanceQuantity", "欠数", "number", false], ["completionRate", "完成比例", "number", false]]),
  /* 数据中心三张表 metadata 必须与实体列/页面列一致（KN-FILTER-001 第四轮校正）。 */
  "sales-orders": fields([
    ["sourceSystem", "来源系统", "text", false], ["sourceDatabase", "来源数据库/账套", "text", false], ["sourceKey", "来源主键", "text", false],
    ["documentDate", "单据日期", "date"], ["orderDate", "订单日期", "date"], ["orderNumber", "订单编号", "text", true, true],
    ["documentName", "单据名称"], ["closeStatus", "关闭状态"], ["customerCode", "客户代码"],
    ["shipToCustomerCode", "送货客户代码"], ["invoiceCustomerCode", "开票客户代码"], ["employeeName", "业务员"],
    ["taxIncluded", "含税标识"], ["currencyCode", "币种"], ["exchangeRate", "汇率", "number", true, false, { format: "decimal" }],
    ["sequenceNumber", "序号", "number", true, false, { format: "integer" }], ["itemNumber", "品项编码", "text", true, true],
    ["itemName", "品项名称"], ["specification", "规格"], ["unitName", "业务单位"],
    ["businessQuantity", "订单数量", "number", true, false, { format: "decimal" }], ["priceQuantity", "计价数量", "number", true, false, { format: "decimal" }],
    ["price", "单价", "number", true, false, { format: "decimal" }], ["rmbPrice", "人民币单价", "number", true, false, { format: "decimal" }],
    ["rmbTaxIncludedAmount", "人民币含税价", "number", true, false, { format: "currency" }],
    ["deliveredBusinessQuantity", "已交数量", "number", true, false, { format: "decimal" }],
    ["plannedDeliveryDate", "计划交期", "date"], ["taxRate", "税率", "number", true, false, { format: "decimal" }],
    ["amountExcludingTaxBc", "本币未税金额", "number", true, false, { format: "currency" }],
    ["taxBc", "本币税额", "number", true, false, { format: "currency" }],
    ["creatorUserId", "制单人编号"], ["creatorUserName", "制单人"], ["adminUnitName", "管理单位"],
    ["ownerDepartment", "责任部门"], ["ownerEmployee", "责任业务"], ["ownerDivision", "责任事业部"],
    ["reviewDueDate", "评审交期", "date"], ["quantity", "数量", "number", true, false, { format: "decimal" }], ["remark", "备注"]
  ]),
  "finished-goods-inbound": fields([
    ["sourceSystem", "来源系统", "text", false], ["sourceDatabase", "来源数据库/账套", "text", false], ["sourceKey", "来源主键", "text", false],
    ["categoryNumber", "分类编号"], ["documentNumber", "入库单单号", "text", true, true], ["documentFullName", "单据全称"],
    ["documentDate", "单据日期", "date"], ["inboundDate", "入库日期", "date"], ["lineNumber", "序号", "number", true, false, { format: "integer" }],
    ["workOrderNumber", "工单单号"], ["salesOrderNumber", "销售单号"], ["inventoryCode", "产品品号", "text", true, true],
    ["quickCode", "快捷码"], ["inventoryName", "品名"], ["specification", "规格"], ["unit", "业务单位"],
    ["receivedQuantity", "允收数量", "number", true, false, { format: "decimal" }], ["warehouseCode", "仓库编码"], ["warehouse", "仓库名称"],
    ["inboundCategory", "入库类别"], ["workshopCode", "车间编码"], ["workshop", "车间"], ["handlerCode", "经手人编码"], ["handler", "经手人"],
    ["businessType", "业务类型"], ["voucherWord", "单据字"], ["category", "类别"], ["creator", "制单人"], ["auditor", "审核人"],
    ["relationInfo", "关联信息"], ["unitPrice", "单价", "number", true, false, { format: "decimal" }],
    ["totalAmount", "金额", "number", true, false, { format: "currency" }], ["remark", "备注"]
  ]),
  "finished-goods-outbound": fields([
    ["sourceSystem", "来源系统", "text", false], ["sourceDatabase", "来源数据库/账套", "text", false], ["sourceKey", "来源主键", "text", false],
    ["documentDate", "单据日期", "date"], ["documentNumber", "出库单号", "text", true, true], ["documentStatus", "单据状态"],
    ["directionValue", "出入库方向值", "number", true, false, { format: "integer" }], ["voucherType", "单据类型"], ["businessType", "业务类型"],
    ["customerCode", "客户代码"], ["customerName", "客户名称"], ["salesOrderNumber", "销售订单号"],
    ["itemNumber", "品项编码", "text", true, true], ["itemName", "品项名称"], ["specification", "规格型号"],
    ["quantity", "出库数量", "number", true, false, { format: "decimal" }], ["unit", "计量单位"],
    ["unitPrice", "单价", "number", true, false, { format: "decimal" }], ["totalAmount", "金额", "number", true, false, { format: "currency" }],
    ["warehouseCode", "仓库编码"], ["warehouse", "仓库名称"], ["sourceDocumentNumber", "来源单号"],
    ["creator", "制单人"], ["auditor", "审核人"], ["remark", "备注"]
  ]),
  "supplier-list": fields([
    ["sourceSystem", "来源系统", "text", false], ["sourceDatabase", "来源数据库", "text", false], ["sourceAccountName", "来源账套", "text", false],
    ["sourceId", "来源主键", "text", false], ["code", "供应商编码", "text", false, true], ["name", "供应商名称", "text", false, true],
    ["abbreviation", "供应商简称", "text", false], ["shorthand", "助记码", "text", false], ["categoryCode", "分类编码", "text", false],
    ["categoryName", "供应商分类", "text", false], ["partnerTypeLabel", "往来单位类型", "text", false], ["representative", "法人代表", "text", false],
    ["contact", "联系人", "text", false], ["mobilePhone", "手机", "text", false], ["telephone", "电话", "text", false],
    ["fax", "传真", "text", false], ["email", "邮箱", "text", false], ["address", "地址", "text", false],
    ["enabled", "状态", "boolean", false], ["sourceUpdatedAt", "T+更新时间", "date", false]
  ]),
  "business-customer-mapping": fields([
    ["departmentId", "部门", "department"], ["department", "部门（文本，历史兼容）", "text", false],
    ["departmentPath", "组织路径", "text", false, false, { filterable: false, filterBinding: { kind: "virtual", note: "由组织架构解析的完整路径，仅展示" } }],
    ["section", "课室"], ["customerCode", "客户"],
    ["salespersonUserIds", "业务员", "member", true, false, { multiple: true }],
    ["salespersonNames", "业务员姓名", "text", false, false, { filterable: false, filterBinding: { kind: "aggregate", note: "由成员姓名解析，仅展示" } }]
  ]),
  /* completion_ratio 在 KDOS 有 CHECK 0..100（导入校验 0..100），因此明确按 percent 尺度声明。 */
  "order-schedule": fields([
    ["customerCode", "客户代码"], ["departmentId", "部门", "department", false], ["department", "部门（文本，历史兼容）", "text", false],
    ["departmentPath", "组织路径", "text", false, false, { filterable: false, filterBinding: { kind: "virtual", note: "由组织架构解析的完整路径，仅展示" } }],
    ["section", "课室", "text", false], ["salespersonUserIds", "业务员", "member", false, false, { multiple: true }], ["orderNumber", "订单编号"], ["itemNumber", "品项编码"], ["itemName", "品项名称"], ["customerDueDate", "客户交期", "date"], ["orderTotalQuantity", "订单总数量", "number"], ["productionUnit", "生产单位"], ["completionRatio", "订单完成比例", "number", true, false, { format: "percentage", percentageScale: "percent" }], ["status", "状态", "dictionary", true, false, { options: [{ value: "NORMAL", label: "正常" }, { value: "VOID", label: "作废" }] }]]),
  "hr-departure-check": fields([["account", "账号"], ["name", "姓名"], ["status", "状态", "dictionary", false]]),
  "equipment-register": fields([["divisionId", "事业部", "department"], ["usageDepartmentId", "使用部门", "department"], ["equipmentCode", "设备编号"], ["equipmentName", "设备名称"], ["purchaseDate", "购买日期", "date"], ["plannedStartupMinutes", "设备计划开机时间", "number", true, false, { format: "durationMinutes" }], ["monitored", "纳入状态填报", "boolean"], ["responsibleUserIds", "责任人", "member", true, false, { multiple: true }]]),
  "equipment-status-report": fields([["equipmentId", "设备（关联台账）", "reference", true, false, { filterBinding: { kind: "column", referenceResource: "equipment-register", valueField: "id", labelField: "equipmentCode" } }], ["equipmentCode", "设备编号", "text", false], ["equipmentName", "设备名称", "text", false], ["divisionId", "事业部", "department", false], ["usageDepartmentId", "使用部门", "department", false], ["responsibleUserIds", "责任人", "member", false, false, { multiple: true }], ["reportDate", "填报日期", "date"], ["runtimeMinutes", "运行时长", "number", true, false, { format: "durationMinutes" }], ["faultMinutes", "故障时长", "number", true, false, { format: "durationMinutes" }], ["faultReason", "故障原因", "dictionary"]]),
  "equipment-dashboard": fields([["divisionId", "事业部", "department", false], ["totalEquipment", "设备总数", "number", false], ["reportedEquipment", "已填报设备", "number", false], ["missingEquipment", "未填报设备", "number", false], ["reportingRate", "录入率", "number", false, false, { format: "percentage" }], ["runtimeMinutes", "运行时长", "number", false, false, { format: "durationMinutes" }], ["faultMinutes", "故障时长", "number", false, false, { format: "durationMinutes" }]]),
  "mps-erp-orders": fields([["sourceAccountName", "来源账套", "text", false], ["salespersonName", "业务员", "text", false], ["customerCode", "客户编码", "text", false], ["orderNumber", "订单编号", "text", false], ["orderType", "订单类型", "text", false], ["orderDate", "下单日期", "date", false], ["customerDueDate", "客户交期", "date", false], ["preproductionReviewDate", "产前评审日期", "date", false], ["expectedShippingDate", "预计出货日期", "date", false], ["itemCode", "品项编码", "text", false], ["itemName", "品项名称", "text", false], ["unit", "单位", "text", false], ["orderQuantity", "订单数量", "number", false], ["taxIncludedUnitPrice", "含税单价", "number", false], ["taxIncludedAmount", "含税金额", "number", false], ["orderStatus", "订单状态", "text", false]]),
  "mps-customer-divisions": fields([["customerCode", "客户编码", "text", true, true], ["primaryDivisionId", "主责事业部", "department", true, true], ["enabled", "启用", "boolean"], ["remark", "备注"]]),
  "mps-order-allocations": fields([["salespersonName", "业务员"], ["customerCode", "客户编码"], ["orderNumber", "订单编号", "text", true, true], ["orderDate", "下单日期", "date"], ["expectedShippingDate", "预计出货日期", "date"], ["itemCode", "品项编码", "text", true, true], ["itemName", "品项名称"], ["unit", "单位"], ["orderQuantity", "订单数量", "number"], ["allocatedQuantity", "分配数量", "number", true, true], ["divisionId", "承接事业部", "department", true, true], ["remark", "备注"]]),
  /* 工序周期列顺序与 canonical registry 完全一致（毛坯位于研磨之后、表面处理之前）。 */
  "mps-process-cycles": fields([["itemCode", "品项编码", "text", true, true], ["itemName", "品项名称"], ["technicalDays", "技术周期", "number"], ...standardProcesses.map((process) => [process.cycleField, `${process.name}周期`, "number"] as [string, string, "number"])]),
  "mps-group-plans": fields([["sourceAccounts", "来源账套", "text", false, false, { filterBinding: { kind: "aggregate", note: "由多个来源账套聚合拼接，按包含匹配筛选" } }], ["orderNumber", "订单编号", "text", false], ["orderType", "订单类型", "text", false], ["customerCode", "客户编码", "text", false], ["orderDate", "下单日期", "date", false], ["customerDueDate", "客户交期", "date", false], ["preproductionReviewDate", "产前评审日期", "date", false], ["orderAmount", "订单金额", "number", false, false, { format: "currency" }], ["requiredQuantity", "需求数量", "number", false], ["primaryDivisionId", "主责事业部", "department", false], ["completedQuantity", "完成数量", "number", false], ["pendingQuantity", "待完成数量", "number", false], ["completionRate", "完成比例", "number", false, false, { format: "percentage" }]]),
  /* KN-MPS-UI-001：月计划基础数量区域固定为 需求数量 → 已下达周计划数量 → 累计入库数量 → 欠数；全表只有一个「已下达周计划数量」。 */
  "mps-monthly-plans": fields([["divisionId", "承接事业部", "department", false], ["customerCode", "客户编码", "text", false], ["orderNumber", "订单编号", "text", false], ["itemCode", "品项编码", "text", false], ["itemName", "品项名称", "text", false], ["orderDate", "下单日期", "date", false], ["customerDueDate", "客户交期", "date", false], ["preproductionReviewDate", "产前评审日期", "date", false], ["latestCustomerDueDate", "最迟客户交期", "date"], ["modelAge", "新旧款", "dictionary"], ["productAttribute", "产品属性"], ["surfaceNature", "表面性质"], ["specialItem", "特殊事项"], ["requiredQuantity", "需求数量", "number", false], ["dispatchedWeeklyQuantity", "已下达周计划数量", "number", false, false, { format: "decimal", filterBinding: { kind: "virtual", note: "当前月计划范围内所有关联周计划 planned_quantity 之和（辅助管理指标，绝不参与生产进度分母）" } }], ["cumulativeInboundQuantity", "累计入库数量", "number", false], ["pendingQuantity", "欠数", "number", false], ["completionRate", "完成比例", "number", false], ["manufacturingMethod", "生产方式", "dictionary"], ["plannedPageCount", "计划页数", "number"], ["orderExceptionInfo", "订单异常信息"], ["inspectionRequired", "是否验货", "boolean"], ["inspectionQuantity", "验货数量", "number"], ["remark", "备注"], ["orderWeekCount", "下单周数", "number", false]]),
  "mps-shipping-plans": fields([["customerCode", "客户编码", "text", true, true], ["orderNumber", "订单编号", "text", true, true], ["itemCode", "品项编码", "text", true, true], ["itemName", "品项名称", "text", true, true], ["deliveryNumber", "交期编码", "number", true, true], ["orderDate", "下单日期", "date"], ["latestCustomerDueDate", "最迟客户交期", "date", true, true], ["plannedQuantity", "计划数量", "number", true, true], ["divisionId", "承接事业部", "department", true, true], ["modelAge", "新旧款", "dictionary", true], ["enteredWeeklyPlan", "已进入周计划", "boolean", false]]),
  /* KN-MPS-WO-001：毛坯完成日期 / 包装完成日期为人工维护、可空、非准入条件的正式字段。 */
  "mps-base-plans": fields([["divisionId", "承接事业部", "department"], ["customerCode", "客户编码"], ["orderNumber", "订单编号", "text", true, true], ["itemCode", "品项编码", "text", true, true], ["itemName", "品项名称"], ["deliveryNumber", "交期编码", "number", true, true], ["orderDate", "下单日期", "date"], ["latestCustomerDueDate", "最迟客户交期", "date", true, true], ["plannedQuantity", "计划数量", "number", true, true], ["latestReviewDueDate", "最迟评审交期", "date", true, true], ["modelAge", "新旧款", "dictionary", true], ["productAttribute", "产品属性", "dictionary", true, true], ["surfaceNature", "表面性质", "dictionary", true, true], ["manufacturingMethod", "生产方式", "dictionary", true, true], ["blankCompletionDate", "毛坯完成日期", "date"], ["packagingCompletionDate", "包装完成日期", "date"], ["weeklyPlanState", "周计划状态", "text", false], ["weeklyPlanMissingFields", "周计划缺少项", "text", false], ["weeklyPlanGenerationIssue", "周计划生成提示", "text", false]]),
  "mps-weekly-plans": fields([["divisionId", "承接事业部", "department"], ["customerCode", "客户编码"], ["orderNumber", "订单编号", "text", true, true], ["itemCode", "品项编码", "text", true, true], ["itemName", "品项名称"], ["deliveryNumber", "交期编码", "number", true, true], ["orderDate", "下单日期", "date"], ["latestCustomerDueDate", "最迟客户交期", "date", true, true], ["latestReviewDueDate", "最迟评审交期", "date", true, true], ["plannedQuantity", "计划数量", "number", true, true], ["allocatedInboundQuantity", "分摊入库数量", "number"], ["pendingQuantity", "欠数", "number", false], ["manufacturingMethod", "生产方式", "dictionary"], ["drawingDueDate", "图纸交期", "date", false], ["hardwareDueDate", "五金交期", "date", false], ["woodDueDate", "木作交期", "date", false], ["blankCompletionDate", "毛坯完成日期", "date", false], ["packagingCompletionDate", "包装完成日期", "date", false], ["orderExceptionInfo", "订单异常信息"], ["inspectionRequired", "是否验货", "boolean"], ["inspectionQuantity", "验货数量", "number"], ["remark", "备注"]]),
  /* KN-MPS-UI-001：工序任务的 exception_text 只是系统/计划提示，不再具有「生产异常事实」语义（异常唯一来源是报工表）。 */
  /*
   * KN-MPS-WO-001：3天生产工单。
   * - 来源字段（source-owned）：同步自事业部周计划，网页/API/Excel 普通写入一律不得修改；
   * - 人工字段（user-owned）：生产开始/结束日期、备注、加工备注，重复同步绝不覆盖；
   * - 业务列顺序按用户确认（客户代码 → … → 加工备注），不含交期编码、不含独立操作列；
   * - productionDateRange 仅用于「生产日期」合并展示/打印，Excel 仍导出两列日期。
   */
  "mps-three-day-work-orders": fields([
    ["customerCode", "客户代码", "text", false], ["orderNumber", "订单编号", "text", false], ["orderDate", "下单日期", "date", false],
    ["modelAge", "新/旧款", "dictionary", false], ["itemCode", "品项编码", "text", false], ["itemName", "品项名称", "text", false],
    ["imageRefs", "简图", "attachment", false], ["requiredQuantity", "需求数量", "number", false, false, { format: "decimal" }],
    ["blankCompletionDate", "毛坯完成日期", "date", false], ["packagingCompletionDate", "包装完成日期", "date", false],
    ["manufacturingMethod", "生产方式", "dictionary", false],
    ["productionStartDate", "生产开始日期", "date", true], ["productionEndDate", "生产结束日期", "date", true],
    ["productionDateRange", "生产日期", "text", false, false, { filterable: false }],
    ["remark", "备注", "text", true], ["processingRemark", "加工备注", "text", true],
    /* 平台一致性：承接事业部（数据范围/字段权限）+ 来源周计划（同步身份 UUID，不导出不打印）。 */
    ["divisionId", "承接事业部", "department", false],
    ["weeklyPlanId", "来源周计划", "reference", false, false, { filterable: false, filterBinding: { kind: "relation", referenceResource: "mps-weekly-plans", valueField: "id" } }]
  ]),
  "mps-weekly-process-plans": fields([["weeklyPlanId", "所属事业部周计划", "reference", true, true, { filterBinding: { kind: "relation", referenceResource: "mps-weekly-plans", valueField: "id" } }], ["processCode", "工序", "dictionary", true, true], ["cycleDays", "周期天数", "number"], ["dueDate", "工序交期", "date"], ["reportDate", "报工日期", "date", true, true], ["dailyReportedQuantity", "当日报工", "number", false], ["status", "状态", "dictionary", false], ["exceptionText", "计划提示"]]),
  "mps-technical-reports": fields([["divisionId", "事业部", "department", false], ["orderNumber", "订单编号", "text", false], ["itemCode", "品项编码", "text", false], ["itemName", "品项名称", "text", false], ["deliveryNumber", "交期编码", "number", false], ["responsibleUserId", "责任人", "member"], ["drawingDueDate", "图纸交期", "date", false], ["status", "状态", "dictionary"], ["exceptionText", "异常"]]),
  "mps-material-reports": fields([["divisionId", "事业部", "department", false], ["weeklyPlanId", "所属事业部周计划", "reference", true, true, { filterBinding: { kind: "relation", referenceResource: "mps-weekly-plans", valueField: "id" } }], ["orderNumber", "订单编号", "text", false], ["itemCode", "品项编码", "text", false], ["itemName", "品项名称", "text", false], ["deliveryNumber", "交期编码", "number", false], ["materialName", "主材", "dictionary", true, true], ["received", "已入库", "boolean"], ["actualInboundDate", "实际入库日期", "date"], ["exceptionText", "异常"]]),
  "mps-outsourcing-reports": fields([["divisionId", "事业部", "department", false], ["orderNumber", "订单编号", "text", false], ["itemCode", "品项编码", "text", false], ["itemName", "品项名称", "text", false], ["deliveryNumber", "交期编码", "number", false], ["purchaseOrderNumber", "采购单号"], ["supplierId", "供应商", "reference", true, false, { filterBinding: { kind: "relation", referenceResource: "supplier-list", valueField: "id", labelField: "code,name" } }], ["outsourcingMethod", "外协方式", "dictionary"], ["outsourcingDueDate", "外协交期", "date"], ["cycleDays", "周期天数", "number"], ["received", "已入库", "boolean"], ["actualInboundDate", "实际入库日期", "date"], ["status", "状态", "dictionary", false], ["exceptionText", "异常"]]),
  /* KN-MPS-UI-001：工序报工新增人工「异常」文本（可选），异常事实绑定到每一次报工，不是工序任务。 */
  "mps-process-reports": fields([["divisionId", "事业部", "department", false], ["weeklyPlanId", "所属事业部周计划", "reference", true, true, { filterBinding: { kind: "relation", referenceResource: "mps-weekly-plans", valueField: "id" } }], ["orderNumber", "订单编号", "text", false], ["itemCode", "品项编码", "text", false], ["itemName", "品项名称", "text", false], ["deliveryNumber", "交期编码", "number", false], ["processCode", "工序", "dictionary", true, true], ["productionDate", "生产日期", "date", true, true], ["plannedQuantity", "计划数量", "number", false], ["productionQuantity", "报工数量", "number", true, true], ["exceptionText", "异常"]]),
  "mps-sync-configs": fields([["syncKey", "同步编码", "text", false], ["name", "同步任务", "text", false], ["enabled", "启用", "boolean"], ["intervalMinutes", "间隔分钟", "number"], ["lastStartedAt", "最近开始", "date", false], ["lastSuccessAt", "最近成功", "date", false], ["lastFailureAt", "最近失败", "date", false], ["lastSyncCount", "最近同步数量", "number", false], ["status", "状态", "dictionary", false], ["errorMessage", "错误信息", "text", false], ["watermarkAt", "增量水位", "datetime"]]),
  /* KN-MPS-LIVE-002：metrics 复用同步日志记录扫描/准入/阻断计数（不改第二套日志体系），只读展示。 */
  "mps-sync-logs": fields([["syncKey", "同步编码", "text", false], ["runType", "运行类型", "dictionary", false], ["status", "状态", "dictionary", false], ["startedAt", "开始时间", "datetime", false], ["completedAt", "完成时间", "datetime", false], ["syncCount", "同步数量", "number", false], ["metrics", "同步计数", "structured", false, false, { filterable: false, filterBinding: { kind: "custom", note: "jsonb 同步计数，仅原样展示" } }], ["errorMessage", "错误信息", "text", false], ["idempotencyKey", "幂等标识", "text", false]]),
  "mps-data-exceptions": fields([["resource", "来源表", "text", false], ["businessKey", "业务键", "text", false], ["exceptionType", "异常类型", "dictionary", false], ["severity", "级别", "dictionary", false], ["message", "异常说明", "text", false], ["active", "未解决", "boolean", false], ["resolvedAt", "解决时间", "date", false]]),
  "mps-system-settings": fields([["settingKey", "参数编码", "text", false], ["name", "参数名称", "text", false], ["valueJson", "参数值", "structured", true, false, { filterable: false, filterBinding: { kind: "custom", note: "jsonb 参数值只按原样展示/写入，不参与结构化筛选" } }], ["description", "说明", "text", false]]),
  "development-requests": fields([["requestNumber", "需求编号", "text", false], ["title", "标题"], ["category", "类别", "dictionary"], ["description", "需求说明"], ["businessValue", "业务价值"], ["urgency", "紧急程度", "dictionary"], ["desiredDate", "期望完成日期", "date"], ["status", "状态", "dictionary", false], ["requesterId", "申请人", "member", false], ["requesterManagerId", "申请主管", "member", false], ["handlerId", "处理人", "member", false], ["handlerManagerId", "处理主管", "member", false], ["estimatedWorkdays", "预计工作日", "number", true, false, { format: "decimal" }], ["plannedCompletionDate", "计划完成日期", "date", false]]),
  "approval-flow-configs": fields([
    ["flowKey", "流程编码", "text", false], ["name", "流程名称"], ["enabled", "启用", "boolean"],
    ["allowDraft", "允许保存草稿", "boolean"], ["allowWithdraw", "允许撤回", "boolean"],
    ["returnMode", "退回方式", "dictionary", true, false, { options: [{ value: "ANY_PREVIOUS", label: "可退回任一前序环节" }, { value: "PREVIOUS_ONLY", label: "只能退回紧邻上一环节" }] }],
    ["rejectTargetMode", "拒绝后去向", "dictionary", true, false, { options: [{ value: "DRAFT", label: "拒绝后回到创建草稿" }, { value: "PREVIOUS", label: "拒绝后回到紧邻上一环节" }] }],
    ["approvalCommentRequired", "审批意见必填", "boolean"],
    /* 角色名快照/节点文案为 jsonb，没有确定的结构化筛选语义：显式 filterable=false，禁止 CAST JSON 万能筛选。 */
    ["adminRoleNames", "管理角色", "structured", false, false, { filterable: false, filterBinding: { kind: "custom", note: "jsonb 角色名数组，仅原样展示" } }],
    ["nodeLabels", "节点文案", "structured", false, false, { filterable: false, filterBinding: { kind: "custom", note: "jsonb 节点文案映射，仅原样展示" } }]
  ]),
  /* dictionary_values 只有 value（中文选项即显示文本，没有独立 label 列），因此按真实 schema 登记。 */
  "dictionaries": fields([["typeCode", "字典类型编码"], ["typeName", "字典类型"], ["value", "字典值"], ["sortOrder", "排序", "number"], ["enabled", "启用", "boolean"]]),
  "processes": fields([["code", "工序编码"], ["name", "工序名称"], ["sortOrder", "排序", "number"], ["enableRequiredDays", "所需天数", "boolean"], ["enableDueDate", "交期", "boolean"], ["enableStatus", "状态", "boolean"], ["enableException", "异常", "boolean"], ["enabled", "启用", "boolean"]]),
  "users": fields([
    ["username", "账号"], ["displayName", "姓名"], ["employeeNo", "工号"], ["wechatUserId", "企业微信成员 ID", "text", false],
    ["position", "职位"], ["alias", "别名"], ["gender", "性别"], ["mobile", "手机"], ["email", "邮箱"],
    ["division", "部门"], ["enabled", "状态", "boolean"], ["lastLoginAt", "最近登录", "datetime", false],
    /* 用户与角色是真实关系：按角色 ID 的数组包含语义筛选（user_roles），不做角色名字符串匹配。 */
    ["roleIds", "角色", "dictionary", false, false, { multiple: true, filterBinding: { kind: "relation", note: "user_roles 真实关系（jsonb 数组），按角色 ID 包含匹配" } }],
    ["roles", "角色名称", "text", false, false, { filterable: false, filterBinding: { kind: "aggregate", note: "由角色关系解析的展示用名称，仅展示" } }],
    /* 多路径 jsonb（企业微信多部门）：没有可靠的单值筛选语义，显式 filterable=false，不影响 users 其它字段筛选。 */
    ["departmentPaths", "所属部门路径", "structured", false, false, { filterable: false, filterBinding: { kind: "custom", note: "多路径 jsonb 数组，仅展示；部门条件使用页面上下文（选中部门）在服务端过滤" } }]
  ]),
  "roles": fields([["name", "角色名称"], ["description", "角色描述"], ["roleGroupId", "角色组", "dictionary"]]),
  "organization": fields([
    ["name", "部门名称"], ["parentId", "上级部门", "department"],
    ["pathLabel", "组织路径", "text", false, false, { filterBinding: { kind: "virtual", note: "按组织树拼出的完整路径（只读计算列）" } }],
    ["wechatDepartmentId", "企业微信部门 ID", "text", false],
    ["level", "层级", "number", false], ["division", "所属事业部", "text", false],
    ["leaderUserIds", "部门负责人", "member", false, false, { multiple: true }],
    ["leaderNames", "部门负责人姓名", "text", false, false, { filterBinding: { kind: "aggregate", note: "由负责人成员姓名聚合拼接，按包含匹配筛选" } }],
    ["memberCount", "直属在职成员数", "number", false, false, { format: "integer", filterBinding: { kind: "aggregate", note: "按在职成员统计的聚合值（虚拟列）" } }],
    ["enabled", "状态", "boolean"]
  ]),
  "contacts": fields([
    ["employeeNo", "工号"], ["name", "姓名"], ["position", "职位"], ["telephone", "电话"],
    ["wechatUserId", "企业微信成员 ID", "text", false],
    /* 多路径 jsonb 结构：不做模糊 CAST 筛选，显式 filterable=false（不影响整表其他字段筛选）。 */
    ["departmentPaths", "部门路径", "structured", false, false, { filterable: false, filterBinding: { kind: "custom", note: "企业微信多路径 jsonb 数组，仅原样展示" } }],
    ["directLeaders", "直属上级", "structured", false, false, { filterable: false, filterBinding: { kind: "custom", note: "企业微信直属上级 jsonb 数组，仅原样展示" } }],
    ["importedAt", "同步时间", "datetime", false],
    ["enabled", "状态", "boolean", false]
  ]),
  "imports": fields([["fileName", "文件名"], ["resource", "导入表单"], ["status", "状态", "dictionary", false], ["successCount", "成功数", "number", false], ["failureCount", "失败数", "number", false]]),
  /* 审计日志的 actorName 是写入时的操作者快照文本，不是可解析成员关系，按真实语义登记为 text。 */
  "audit-logs": fields([["actorName", "操作人", "text", false], ["resource", "表单", "text", false], ["action", "操作", "text", false], ["recordId", "记录 ID", "text", false], ["source", "来源", "text", false], ["requestId", "请求ID", "text", false]]),
  /* scopes 是 jsonb 权限范围数组，只按原样展示/写入，不参与结构化筛选（禁止 CAST JSON 模糊匹配）。 */
  "api-keys": fields([
    ["name", "名称"],
    ["userId", "绑定用户 ID", "text", false], ["roleId", "绑定角色 ID", "text", false],
    ["scopes", "权限范围", "structured", true, false, { filterable: false, filterBinding: { kind: "custom", note: "API Key 权限范围为 jsonb 数组，只按原样展示" } }],
    ["enabled", "启用", "boolean"], ["expiresAt", "到期时间", "datetime"], ["lastUsedAt", "最近使用", "datetime", false]
  ]),
  "tplus-sales-orders": fields([["source", "数据源", "dictionary", false], ["customerCode", "客户代码", "text", false], ["orderNumber", "订单编号", "text", false], ["orderDate", "订单日期", "date", false]]),
  "customer-data-import": fields([["source", "数据源", "dictionary"], ["customerCode", "客户代码"], ["status", "状态", "dictionary", false]])
};

/* 工序定义唯一来源：@tracker/shared 的 canonical registry（KN-PROC-001），本文件不再维护第二份名单。 */
const standardMpsProcesses = standardProcesses.map((process) => [process.code, process.name] as const);

const mpsProcessPermissionFields: TablePermissionFieldDefinition[] = standardMpsProcesses.flatMap(([code, label]) => [
  { key: `${code}CycleDays`, label: `${label}·所需周期`, type: "number" as const, editable: false },
  { key: `${code}DueDate`, label: `${label}·交期`, type: "date" as const, editable: false },
  { key: `${code}Status`, label: `${label}·状态`, type: "dictionary" as const, editable: false }
]);

/**
 * KN-MPS-EXEC-001：每个标准工序的「生产进度」只读派生字段（唯一事实来源 mps_process_reports 累计报工）。
 * 内部按 ratio 存储（0.8=80%、1.05=105%），与平台 percentage 规范一致；需求为 0/NULL 时为 NULL（界面显示 —）。
 * KN-MPS-UI-001：每个工序的主表列固定为「周期 | 交期 | 状态 | 生产进度」；本任务只为生产进度注册正式字段，
 * 累计报工改为 support projection、报工次数与每工序已下达数量直接删除，都不再是业务字段。
 */
const mpsProcessProgressFields: TablePermissionFieldDefinition[] = standardMpsProcesses.flatMap(([code, label]) => [
  { key: `${code}ProductionProgress`, label: `${label}·生产进度`, type: "number" as const, editable: false, format: "percentage" as const }
]);

/**
 * KN-MPS-UI-001 辅助计算字段（support projection，不是业务字段）：
 * 累计报工只用于解释生产进度（Tooltip），绝不进入主表列、打印、导出、Excel 模板与字段权限编辑器。
 * 报工次数已按业务确认彻底删除；每工序「已下达周计划数量」重复设计已收敛为月计划唯一的 dispatchedWeeklyQuantity。
 */
const mpsProcessReportedSupportFields: TableSupportFieldDefinition[] = standardMpsProcesses.flatMap(([code, label]) => [
  { key: `${code}ReportedQuantity`, label: `${label}·累计报工`, type: "number" as const, format: "decimal" as const }
]);

/** 辅助计算字段登记表：只有明确登记在这里的字段才允许作为行投影辅助值返回，且永远不会成为业务字段。 */
const tableSupportFieldRegistry: Partial<Record<TableResourceCode, TableSupportFieldDefinition[]>> = {
  "mps-weekly-plans": mpsProcessReportedSupportFields,
  "mps-monthly-plans": mpsProcessReportedSupportFields
};

export const tableSupportFieldsFor = (resource: TableResourceCode) => tableSupportFieldRegistry[resource] ?? [];

/** 周/月计划整表唯一异常列：汇总所有正式执行异常来源（含来源标签、去重、稳定顺序）。 */
const mpsExceptionSummaryField: TablePermissionFieldDefinition[] = [
  { key: "exceptionSummary", label: "异常", type: "text" as const, editable: false }
];
const weeklyAuxiliaryPermissionFields: TablePermissionFieldDefinition[] = [
  { key: "technicalCycleDays", label: "技术/图纸计划·所需周期", type: "number", editable: false },
  { key: "technicalStatus", label: "技术/图纸计划·状态", type: "dictionary", editable: false },
  { key: "hardwareCycleDays", label: "五金主材计划·所需周期", type: "number", editable: false },
  { key: "hardwareStatus", label: "五金主材计划·状态", type: "dictionary", editable: false },
  { key: "woodCycleDays", label: "木作主材计划·所需周期", type: "number", editable: false },
  { key: "woodStatus", label: "木作主材计划·状态", type: "dictionary", editable: false },
  { key: "outsourcingCycleDays", label: "外协计划·所需周期", type: "number", editable: false },
  { key: "outsourcingDueDate", label: "外协计划·交期", type: "date", editable: false },
  { key: "outsourcingStatus", label: "外协计划·状态", type: "dictionary", editable: false },
  { key: "outsourcingActualInboundDate", label: "外协计划·实际入库日期", type: "date", editable: false }
];
const monthlyAuxiliaryPermissionFields: TablePermissionFieldDefinition[] = [
  { key: "technicalCycleDays", label: "技术/图纸计划·所需周期", type: "number", editable: false },
  { key: "drawingDueDate", label: "技术/图纸计划·图纸交期", type: "date", editable: false },
  { key: "technicalStatus", label: "技术/图纸计划·状态", type: "dictionary", editable: false },
  { key: "hardwareCycleDays", label: "五金主材计划·所需周期", type: "number", editable: false },
  { key: "hardwareDueDate", label: "五金主材计划·交期", type: "date", editable: false },
  { key: "hardwareStatus", label: "五金主材计划·状态", type: "dictionary", editable: false },
  { key: "woodCycleDays", label: "木作主材计划·所需周期", type: "number", editable: false },
  { key: "woodDueDate", label: "木作主材计划·交期", type: "date", editable: false },
  { key: "woodStatus", label: "木作主材计划·状态", type: "dictionary", editable: false },
  ...weeklyAuxiliaryPermissionFields.filter((field) => field.key.startsWith("outsourcing"))
];
for (const resource of ["mps-monthly-plans", "mps-weekly-plans"] as const) {
  const current = tablePermissionFieldRegistry[resource] ?? auditPermissionFields;
  tablePermissionFieldRegistry[resource] = [
    ...current.slice(0, -auditPermissionFields.length),
    ...(resource === "mps-weekly-plans" ? weeklyAuxiliaryPermissionFields : monthlyAuxiliaryPermissionFields),
    ...mpsProcessPermissionFields,
    ...mpsProcessProgressFields,
    ...mpsExceptionSummaryField,
    ...auditPermissionFields
  ];
}

export const tablePermissionFieldsFor = (resource: TableResourceCode) => tablePermissionFieldRegistry[resource] ?? auditPermissionFields;

/*
 * KN-MPS-WO-001：3天生产工单的打印/导出投影。
 * - 打印只输出合并的「生产日期」范围列（productionDateRange），不再拆成两个难读的业务列；
 * - 来源周计划 UUID（weeklyPlanId）是系统技术身份，不打印（Excel 侧另有导出排除）。
 */
for (const field of tablePermissionFieldRegistry["mps-three-day-work-orders"] ?? []) {
  if (field.key === "productionStartDate" || field.key === "productionEndDate" || field.key === "weeklyPlanId") field.printable = false;
}

/**
 * KN-FILTER-001：全项目唯一筛选操作符 registry。
 * 服务端编译器与前端高级筛选 UI 共用这一份定义；客户端只能提交 field + operator + operand，
 * 字段类型永远由服务端 metadata 决定，不得由客户端声明或按名称猜测。
 */
export type TableFilterOperator =
  | "eq" | "neq" | "in" | "not_in" | "contains" | "not_contains" | "starts_with"
  | "is_empty" | "is_not_empty" | "gt" | "gte" | "lt" | "lte" | "between"
  | "dynamic"
  | "contains_any" | "contains_all" | "not_contains_any" | "count_eq" | "count_gte" | "count_lte"
  | "is_true" | "is_false" | "has_attachment" | "has_no_attachment";

export interface TableFilterOperatorDefinition {
  operator: TableFilterOperator;
  label: string;
  operand: "none" | "single" | "list" | "range" | "dynamic";
}

const TEXT_OPERATORS: TableFilterOperatorDefinition[] = [
  { operator: "eq", label: "等于", operand: "single" },
  { operator: "neq", label: "不等于", operand: "single" },
  { operator: "in", label: "等于任意一个", operand: "list" },
  { operator: "not_in", label: "不等于任意一个", operand: "list" },
  { operator: "contains", label: "包含", operand: "single" },
  { operator: "not_contains", label: "不包含", operand: "single" },
  { operator: "starts_with", label: "开头是", operand: "single" },
  { operator: "is_empty", label: "为空", operand: "none" },
  { operator: "is_not_empty", label: "不为空", operand: "none" }
];
const CHOICE_OPERATORS: TableFilterOperatorDefinition[] = [
  { operator: "eq", label: "等于", operand: "single" },
  { operator: "neq", label: "不等于", operand: "single" },
  { operator: "in", label: "等于任意一个", operand: "list" },
  { operator: "not_in", label: "不等于任意一个", operand: "list" },
  { operator: "is_empty", label: "为空", operand: "none" },
  { operator: "is_not_empty", label: "不为空", operand: "none" }
];
const NUMBER_OPERATORS: TableFilterOperatorDefinition[] = [
  { operator: "eq", label: "等于", operand: "single" },
  { operator: "neq", label: "不等于", operand: "single" },
  { operator: "gt", label: "大于", operand: "single" },
  { operator: "gte", label: "大于等于", operand: "single" },
  { operator: "lt", label: "小于", operand: "single" },
  { operator: "lte", label: "小于等于", operand: "single" },
  { operator: "between", label: "介于", operand: "range" },
  { operator: "in", label: "等于任意一个", operand: "list" },
  { operator: "not_in", label: "不等于任意一个", operand: "list" },
  { operator: "is_empty", label: "为空", operand: "none" },
  { operator: "is_not_empty", label: "不为空", operand: "none" }
];
const DATE_OPERATORS: TableFilterOperatorDefinition[] = [
  { operator: "eq", label: "等于", operand: "single" },
  { operator: "neq", label: "不等于", operand: "single" },
  { operator: "gt", label: "大于", operand: "single" },
  { operator: "lt", label: "小于", operand: "single" },
  { operator: "gte", label: "大于等于", operand: "single" },
  { operator: "lte", label: "小于等于", operand: "single" },
  { operator: "between", label: "选择范围", operand: "range" },
  { operator: "dynamic", label: "动态筛选", operand: "dynamic" },
  { operator: "is_empty", label: "为空", operand: "none" },
  { operator: "is_not_empty", label: "不为空", operand: "none" }
];
const BOOLEAN_OPERATORS: TableFilterOperatorDefinition[] = [
  { operator: "is_true", label: "是", operand: "none" },
  { operator: "is_false", label: "否", operand: "none" },
  { operator: "is_empty", label: "为空", operand: "none" },
  { operator: "is_not_empty", label: "不为空", operand: "none" }
];
const MULTIPLE_OPERATORS: TableFilterOperatorDefinition[] = [
  { operator: "contains_any", label: "包含任意一个", operand: "list" },
  { operator: "contains_all", label: "包含全部", operand: "list" },
  { operator: "not_contains_any", label: "不包含任何", operand: "list" },
  { operator: "count_eq", label: "数量等于", operand: "single" },
  { operator: "count_gte", label: "数量大于等于", operand: "single" },
  { operator: "count_lte", label: "数量小于等于", operand: "single" },
  { operator: "is_empty", label: "为空", operand: "none" },
  { operator: "is_not_empty", label: "不为空", operand: "none" }
];
const ATTACHMENT_OPERATORS: TableFilterOperatorDefinition[] = [
  { operator: "has_attachment", label: "有附件", operand: "none" },
  { operator: "has_no_attachment", label: "无附件", operand: "none" }
];

/**
 * 动态日期关键字（用户最终确认集合，唯一正式定义）：服务端按 Asia/Shanghai 计算区间，
 * 客户端只提交关键字，不得下发具体日期范围。
 */
export const tableFilterDynamicDateOptions = [
  { value: "YESTERDAY", label: "昨天" },
  { value: "TODAY", label: "今天" },
  { value: "TOMORROW", label: "明天" },
  { value: "NEXT_1_WEEK", label: "未来1周" },
  { value: "NEXT_2_WEEKS", label: "未来2周" },
  { value: "LAST_MONTH", label: "上月" },
  { value: "THIS_MONTH", label: "本月" },
  { value: "NEXT_MONTH", label: "下月" },
  { value: "LAST_YEAR", label: "去年" },
  { value: "THIS_YEAR", label: "今年" },
  { value: "NEXT_YEAR", label: "明年" }
] as const;
export const tableFilterDynamicDateKeys = tableFilterDynamicDateOptions.map((option) => option.value);
export type TableFilterDynamicDateKey = typeof tableFilterDynamicDateKeys[number];

export function tableFilterOperatorsFor(field: Pick<TablePermissionFieldDefinition, "type" | "multiple">): TableFilterOperatorDefinition[] {
  if (field.type === "attachment") return ATTACHMENT_OPERATORS;
  if (field.type === "structured") return [];
  if (field.multiple) return MULTIPLE_OPERATORS;
  switch (field.type) {
    case "number": return NUMBER_OPERATORS;
    case "date":
    case "datetime": return DATE_OPERATORS;
    case "boolean": return BOOLEAN_OPERATORS;
    case "dictionary":
    case "member":
    case "department":
    case "reference": return CHOICE_OPERATORS;
    default: return TEXT_OPERATORS;
  }
}

export function isTableFieldFilterable(field: TablePermissionFieldDefinition) {
  if (field.type === "structured") return field.filterable === true;
  if (field.type === "attachment") return true;
  return field.filterable !== false && tableFilterOperatorsFor(field).length > 0;
}

const DATE_UI_OPERATORS: TableFilterOperator[] = ["eq", "neq", "gt", "lt", "gte", "lte", "between", "dynamic", "is_empty", "is_not_empty"];
const CHOICE_UI_OPERATORS: TableFilterOperator[] = ["eq", "neq", "in", "not_in", "is_empty", "is_not_empty"];

/**
 * KN-FILTER-001 第四轮：正式高级筛选 UI 的操作符白名单。
 * 内部编译器保留更强能力（供后续/服务端使用），但正式界面严格只暴露已确认的操作符：
 * 不暴露 starts_with、count_eq/count_gte/count_lte、数值 in/not_in 等未确认项；日期时间共用一套。
 */
export function tableFilterUiOperatorsFor(field: TablePermissionFieldDefinition): TableFilterOperatorDefinition[] {
  const operators = tableFilterOperatorsFor(field);
  if (!operators.length) return operators;
  const allowed = field.multiple
    ? ["contains_any", "contains_all", "not_contains_any", "is_empty", "is_not_empty"]
    : {
      text: ["eq", "neq", "in", "not_in", "contains", "not_contains", "is_empty", "is_not_empty"],
      number: ["eq", "neq", "gte", "lte", "between", "is_empty", "is_not_empty"],
      date: DATE_UI_OPERATORS, datetime: DATE_UI_OPERATORS,
      boolean: ["is_true", "is_false", "is_empty", "is_not_empty"],
      dictionary: CHOICE_UI_OPERATORS, member: CHOICE_UI_OPERATORS, department: CHOICE_UI_OPERATORS, reference: CHOICE_UI_OPERATORS,
      /* 附件字段的“有/无附件”即正式的空/非空语义（编译器按 jsonb 数组长度判定）。 */
      attachment: ["has_attachment", "has_no_attachment"],
      structured: []
    }[field.type as Exclude<TablePermissionFieldType, "structured">] ?? [];
  const whitelist = new Set<TableFilterOperator>(allowed as TableFilterOperator[]);
  return operators.filter((definition) => whitelist.has(definition.operator));
}

/**
 * 关联候选标签的唯一来源：按目标资源声明标签列（逗号分隔可多列）。
 * 关联字段必须显式声明 labelField 或命中此表，缺失时 metadata 审计直接失败，禁止猜测字段。
 */
export const tableReferenceLabelFields: Record<string, string> = {
  "mps-weekly-plans": "order_number,item_code,delivery_number",
  "supplier-list": "code,name",
  "equipment-register": "equipment_code,equipment_name"
};

export function referenceLabelFieldsFor(referenceResource: string, labelField?: string) {
  return (labelField ?? tableReferenceLabelFields[referenceResource] ?? "").split(",").map((column) => column.trim()).filter(Boolean);
}

/**
 * KN-FILTER-001 第四轮：44 个正式 resource 的类型化筛选能力登记。
 * 这是“筛选能力”的唯一声明来源，供审计与启动闸门使用；不得出现 UNKNOWN / 未处理。
 *
 * - REGISTERED_AND_FILTERABLE：已注册进平台 `TableFilterRegistry`，服务端 list 真正接收 FilterGroup；
 * - REGISTERED_NOT_FILTERABLE：已注册候选/数据源，但业务上没有任何可筛选字段（当前为空集）；
 * - NOT_APPLICABLE：不是可查询的业务记录表（聚合大屏、上传即算即走、纯任务表），不提供类型化筛选；
 * - BLOCKED：本轮尚未接入，必须写明真实原因，属于未完成项而非不明状态。
 */
export type TableFilterResourceStatus = "REGISTERED_AND_FILTERABLE" | "REGISTERED_NOT_FILTERABLE" | "NOT_APPLICABLE" | "BLOCKED";

export interface TableFilterResourceCapability {
  status: TableFilterResourceStatus;
  /** BLOCKED / NOT_APPLICABLE 必须写明原因，禁止留空。 */
  reason?: string;
}

const mpsFilterCapabilities = Object.fromEntries(
  [
    "mps-erp-orders", "mps-customer-divisions", "mps-order-allocations", "mps-process-cycles", "mps-group-plans",
    "mps-monthly-plans", "mps-shipping-plans", "mps-base-plans", "mps-weekly-plans", "mps-weekly-process-plans",
    "mps-technical-reports", "mps-material-reports", "mps-outsourcing-reports", "mps-process-reports",
    "mps-three-day-work-orders",
    "mps-sync-configs", "mps-sync-logs", "mps-data-exceptions", "mps-system-settings"
  ].map((code) => [code, { status: "REGISTERED_AND_FILTERABLE" as const }])
);

export const tableFilterResourceCapabilities: Record<string, TableFilterResourceCapability> = {
  ...mpsFilterCapabilities,
  /* 数据中心：订单、成品入库/出库为真实业务记录表，本轮接入平台 FilterCompiler。 */
  "sales-orders": { status: "REGISTERED_AND_FILTERABLE" },
  "finished-goods-inbound": { status: "REGISTERED_AND_FILTERABLE" },
  "finished-goods-outbound": { status: "REGISTERED_AND_FILTERABLE" },
  /* 设备：台账与状态填报为真实业务记录表，本轮接入平台 FilterCompiler。 */
  "equipment-register": { status: "REGISTERED_AND_FILTERABLE" },
  "equipment-status-report": { status: "REGISTERED_AND_FILTERABLE" },
  /* 系统管理：审计日志是真实记录表，本轮接入平台 FilterCompiler。 */
  "audit-logs": { status: "REGISTERED_AND_FILTERABLE" },
  /* 数据中心：供应商清单为 T+ 同步投影，本轮接入平台 FilterCompiler。 */
  "supplier-list": { status: "REGISTERED_AND_FILTERABLE" },
  /* 聚合大屏：只读聚合视图，没有可筛选的业务记录行。 */
  "sales-summary-dashboard": { status: "NOT_APPLICABLE", reason: "销售接单汇总大屏为按周期聚合的只读大屏，没有独立业务记录行，筛选语义不适用。" },
  "equipment-dashboard": { status: "NOT_APPLICABLE", reason: "集团设备大屏为按事业部/周期聚合的只读指标视图，没有独立业务记录行。" },
  /* 上传即算即走 / 纯任务型资源：没有可持久化查询的业务记录表。 */
  "hr-departure-check": { status: "NOT_APPLICABLE", reason: "离职人员检查是上传花名册后即时比对的工具页，结果不落业务表，没有可筛选的持久记录集。" },
  imports: { status: "NOT_APPLICABLE", reason: "导入记录是后台任务表，页面用于追溯同步任务状态，不是业务记录表。" },
  "tplus-sales-orders": { status: "NOT_APPLICABLE", reason: "T+ 销售订单同步为集成任务视图，源数据语义由集成适配器维护，不作为可筛选业务记录表。" },
  "customer-data-import": { status: "NOT_APPLICABLE", reason: "客户数据导入为一次性导入任务，结果写入客户主数据，没有独立可筛选记录表。" },
  /* 本轮尚未接入：真实业务表，但需要按资源核实数据范围语义后再接入平台编译器。 */
    "business-customer-mapping": { status: "REGISTERED_AND_FILTERABLE" },
    "order-schedule": { status: "REGISTERED_AND_FILTERABLE" },
    "development-requests": { status: "REGISTERED_AND_FILTERABLE" },
    "approval-flow-configs": { status: "REGISTERED_AND_FILTERABLE" },
  dictionaries: { status: "REGISTERED_AND_FILTERABLE" },
  processes: { status: "REGISTERED_AND_FILTERABLE" },
  users: { status: "REGISTERED_AND_FILTERABLE" },
  roles: { status: "NOT_APPLICABLE", reason: "角色管理采用角色树配置模式（左侧角色组+角色树），不存在以角色记录为行的标准 KdosDataTable；页面右侧表格展示的是所选角色的用户成员（users 上下文视图），不是 role records。因此角色 resource 不适用标准表格高级筛选，其成员视图按 users 资源接入。" },
  organization: { status: "REGISTERED_AND_FILTERABLE" },
  contacts: { status: "REGISTERED_AND_FILTERABLE" },
  "api-keys": { status: "REGISTERED_AND_FILTERABLE" }
};

/**
 * KN-PRINT-001 打印能力登记：每个正式 resource 必须有明确的打印状态（不允许 UNKNOWN / BLOCKED）。
 * PRINTABLE：存在标准记录型 KdosDataTable 且打印有真实业务意义；
 * NOT_APPLICABLE：聚合大屏、树形配置、一次性导入、纯任务型等非记录型页面（必须写明中文产品理由）。
 */
export type TablePrintResourceStatus = "PRINTABLE" | "NOT_APPLICABLE";
export interface TablePrintResourceCapability { status: TablePrintResourceStatus; reason?: string }

const printNotApplicable: Record<string, string> = {
  "sales-summary-dashboard": "销售接单汇总大屏是按周期聚合的只读指标大屏，不是记录列表，没有可打印的业务记录行。",
  "equipment-dashboard": "集团设备大屏是聚合指标视图，不是记录列表，打印无业务意义。",
  "hr-departure-check": "离职人员检查是上传花名册后即时比对的结果页，数据不落库，没有可打印的持久记录集合。",
  imports: "导入记录是后台任务追溯页面，不是业务记录表，打印无业务意义。",
  "tplus-sales-orders": "T+ 销售订单同步是集成任务视图，业务数据以正式订单表为准，本页不单独打印。",
  "customer-data-import": "客户数据导入是一次性导入任务，结果写入客户主数据，本页不单独打印。",
  roles: "角色管理是角色树配置模式，右侧列表展示的是所选角色的用户成员（users 上下文视图），角色 resource 自身没有记录型表格可打印。",
  "api-keys": "API Key 管理是安全配置页面（密钥/hash 属敏感信息，不得进入任何打印内容），无业务打印需求。",
  "mps-sync-configs": "同步配置是系统运维参数表，属于技术配置而非业务记录，不提供业务打印。",
  "mps-system-settings": "系统参数是技术配置项（含 jsonb 参数值），不提供业务打印。"
};

export const tablePrintResourceCapabilities: Record<string, TablePrintResourceCapability> = Object.fromEntries(
  tableResourceRegistry.map((resource) => [
    resource.code,
    printNotApplicable[resource.code]
      ? { status: "NOT_APPLICABLE" as const, reason: printNotApplicable[resource.code] }
      : { status: "PRINTABLE" as const }
  ])
);

export function tablePrintResourceCapabilityOf(code: string): TablePrintResourceCapability {
  return tablePrintResourceCapabilities[code] ?? { status: "NOT_APPLICABLE", reason: `未登记的打印能力：${code}` };
}

export function auditTablePrintCapabilities(): { total: number; printable: number; notApplicable: number; errors: string[] } {
  const errors: string[] = [];
  const known = new Set(tableResourceRegistry.map((resource) => resource.code as string));
  let printable = 0; let notApplicable = 0;
  for (const resource of tableResourceRegistry) {
    const capability = tablePrintResourceCapabilities[resource.code];
    if (!capability) { errors.push(`未声明打印能力：${resource.code}`); continue; }
    if (capability.status === "PRINTABLE") printable += 1;
    else {
      notApplicable += 1;
      if (!capability.reason || capability.reason.length < 10) errors.push(`NOT_APPLICABLE 缺少真实产品理由：${resource.code}`);
    }
  }
  for (const code of Object.keys(tablePrintResourceCapabilities)) {
    if (!known.has(code)) errors.push(`打印能力登记了未知 resource：${code}`);
  }
  return { total: tableResourceRegistry.length, printable, notApplicable, errors };
}

/** 敏感字段绝对禁止进入打印投影（即使 metadata 或客户端要求）。 */
export const tablePrintForbiddenFieldKeywords = ["password", "passwd", "secret", "token", "keyhash", "key_hash", "privatekey", "credential", "apikey", "api_key"];

export function isTablePrintFieldSafe(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return !tablePrintForbiddenFieldKeywords.some((keyword) => normalized.includes(keyword.replace(/[^a-z0-9]/g, "")));
}

/** 审计字段默认不打印（除非 resource 显式声明 printable: true）。 */
export const tablePrintAuditFieldKeys = ["createdBy", "createdAt", "updatedBy", "updatedAt"];

export function isTablePrintFieldPrintable(field: TablePermissionFieldDefinition) {
  if (!isTablePrintFieldSafe(field.key)) return false;
  if (field.printable === false) return false;
  if (field.printable === true) return true;
  if (field.type === "structured" || field.type === "attachment") return false;
  if (tablePrintAuditFieldKeys.includes(field.key)) return false;
  return true;
}

export function tableFilterResourceCapabilityOf(code: string): TableFilterResourceCapability {
  return tableFilterResourceCapabilities[code] ?? { status: "BLOCKED", reason: `未登记筛选能力：${code}` };
}

/**
 * Phase 0 审计闸门：每个正式字段都必须声明可判定的语义类型；reference 必须给出候选来源；
 * structured 必须显式声明筛选策略。新增字段遗漏 metadata 时模块加载即失败，避免未来按名称猜类型。
 */
export function auditTableFieldMetadata(): { resources: number; fields: number; errors: string[] } {
  const errors: string[] = [];
  const knownResources = new Set(tableResourceRegistry.map((resource) => resource.code as string));
  const seenResources = new Set<string>();
  let fields = 0;
  for (const resource of tableResourceRegistry) {
    if (seenResources.has(resource.code)) errors.push(`重复 resource code：${resource.code}`);
    seenResources.add(resource.code);
    const definitions = tablePermissionFieldRegistry[resource.code as TableResourceCode] ?? auditPermissionFields;
    const seenKeys = new Set<string>();
    for (const field of definitions) {
      fields += 1;
      const where = `${resource.code}.${field.key}`;
      if (seenKeys.has(field.key)) errors.push(`重复字段：${where}`);
      seenKeys.add(field.key);
      if (!field.label) errors.push(`缺少显示名：${where}`);
      if (field.type === "reference" && !field.filterBinding?.referenceResource) errors.push(`reference 缺少候选来源：${where}`);
      if (field.filterBinding?.referenceResource && !knownResources.has(field.filterBinding.referenceResource)) errors.push(`reference 指向未知资源：${where} → ${field.filterBinding.referenceResource}`);
      /* 关联候选必须能确定标签：显式 labelField 或按目标资源声明的标签定义，禁止按资源猜字段。 */
      if (field.type === "reference" && field.filterBinding?.referenceResource && !referenceLabelFieldsFor(field.filterBinding.referenceResource, field.filterBinding.labelField).length) {
        errors.push(`reference 缺少标签定义：${where} → ${field.filterBinding.referenceResource}`);
      }
      if (field.type === "structured" && field.filterable === undefined) errors.push(`structured 必须声明 filterable：${where}`);
      if (field.multiple !== undefined && typeof field.multiple !== "boolean") errors.push(`multiple 必须为布尔：${where}`);
    }
    /* KN-MPS-UI-001：辅助计算字段（support projection）绝不能同时登记为业务字段，否则会重新泄露到主表/打印/导出/字段权限。 */
    for (const support of tableSupportFieldsFor(resource.code as TableResourceCode)) {
      if (seenKeys.has(support.key)) errors.push(`辅助计算字段不得作为业务字段登记：${resource.code}.${support.key}`);
      if (!support.label) errors.push(`辅助计算字段缺少显示名：${resource.code}.${support.key}`);
    }
  }
  return { resources: seenResources.size, fields, errors };
}

/**
 * KN-FILTER-001 第四轮闸门：每个正式 resource 必须声明确定状态（不允许 UNKNOWN / 未处理），
 * 且 BLOCKED / NOT_APPLICABLE 必须写明原因；不得登记未知 resource。
 */
export function auditTableFilterCapabilities(): { total: number; errors: string[] } {
  const errors: string[] = [];
  const knownResources = new Set(tableResourceRegistry.map((resource) => resource.code as string));
  for (const resource of tableResourceRegistry) {
    const capability = tableFilterResourceCapabilities[resource.code];
    if (!capability) { errors.push(`未声明筛选能力：${resource.code}`); continue; }
    if (!["REGISTERED_AND_FILTERABLE", "REGISTERED_NOT_FILTERABLE", "NOT_APPLICABLE", "BLOCKED"].includes(capability.status)) {
      errors.push(`筛选能力状态非法：${resource.code} → ${capability.status}`);
    }
    if (capability.status !== "REGISTERED_AND_FILTERABLE" && !capability.reason) errors.push(`缺少筛选能力原因：${resource.code}`);
  }
  for (const code of Object.keys(tableFilterResourceCapabilities)) {
    if (!knownResources.has(code)) errors.push(`筛选能力登记了未知 resource：${code}`);
  }
  return { total: tableResourceRegistry.length, errors };
}

const tableFieldAudit = auditTableFieldMetadata();
if (tableFieldAudit.errors.length) {
  throw new Error(`KDOS 正式字段 metadata 审计失败（KN-FILTER-001 Phase 0）：\n${tableFieldAudit.errors.slice(0, 20).join("\n")}`);
}

const tablePrintAudit = auditTablePrintCapabilities();
if (tablePrintAudit.errors.length) {
  throw new Error(`KDOS 打印能力登记审计失败（KN-PRINT-001）：\n${tablePrintAudit.errors.slice(0, 20).join("\n")}`);
}

const tableCapabilityAudit = auditTableFilterCapabilities();
if (tableCapabilityAudit.errors.length) {
  throw new Error(`KDOS 筛选能力登记审计失败（KN-FILTER-001 Round 4）：\n${tableCapabilityAudit.errors.slice(0, 20).join("\n")}`);
}
