export type PermissionAction = "read" | "create" | "copy" | "update" | "delete" | "batch_print" | "batch_update" | "import" | "export";
export type ResourceKey =
  | "rolling-plan"
  | "monthly-plan"
  | "suppliers"
  | "dictionaries"
  | "processes"
  | "finished-goods-inbound"
  | "finished-goods-outbound"
  | "sales-orders"
  | "sales-summary-dashboard"
  | "organization"
  | "users"
  | "roles"
  | "audit-logs"
  | "imports";

export interface SessionUser {
  sub: string;
  username: string;
  roles: string[];
  divisions: string[] | "*";
  permissions: string[];
}

export interface PlanPeriod {
  id: string;
  year: number;
  month: number;
  status: string;
}

export const dictionarySeeds = {
  modelAge: ["新", "旧"],
  productAttribute: ["五金", "木作", "五金+木作"],
  surfaceNature: ["烤漆", "电镀"],
  specialItem: ["亚克力"],
  handlingMethod: ["自制", "中心外购", "外协", "自制+外协"],
  outsourcingMethod: ["成品", "毛坯", "部件"],
  division: ["事业一部", "事业二部", "事业三部", "事业四部", "贻居", "电镀厂"],
  deliveryMethod: ["空运", "海运", "汽运", "火车", "内河船运", "其他"]
} as const;

export type ProcessDefinition = {
  code: string;
  name: string;
  order: number;
  fields: readonly ("requiredDays" | "dueDate" | "status" | "exception")[];
};

export const processDefinitions: ProcessDefinition[] = [
  ["drawingBom", "图纸&BOM", ["requiredDays", "dueDate", "status", "exception"]],
  ["metalMain", "五金主材", ["requiredDays", "dueDate", "status", "exception"]],
  ["woodMain", "木作主材", ["requiredDays", "dueDate", "status", "exception"]],
  ["frontParts", "前道配件", ["requiredDays", "dueDate", "status", "exception"]],
  ["machining", "机加", ["requiredDays", "dueDate", "status", "exception"]],
  ["welding", "焊接/点焊", ["requiredDays", "dueDate", "status", "exception"]],
  ["grinding", "研磨", ["requiredDays", "dueDate", "status", "exception"]],
  ["blank", "毛坯", ["requiredDays", "dueDate", "status", "exception"]],
  ["woodwork", "木作", ["requiredDays", "dueDate", "status", "exception"]],
  ["painting", "油漆", ["requiredDays", "dueDate", "status", "exception"]],
  ["acrylic", "亚克力", ["requiredDays", "dueDate", "status", "exception"]],
  ["bakingPlating", "烤漆/电镀", ["requiredDays", "dueDate", "status", "exception"]],
  ["rearPackingParts", "后道包材&配件", ["requiredDays", "dueDate", "status", "exception"]],
  ["assemblyPacking", "组装&包装", ["requiredDays", "dueDate", "status", "exception"]]
].map(([code, name, fields], index) => ({
  code: code as string,
  name: name as string,
  order: index + 1,
  fields: fields as ProcessDefinition["fields"]
}));

export type ColumnKind = "text" | "date" | "decimal" | "image" | "dictionary" | "department";
export type ColumnDefinition = {
  key: string;
  header: string;
  group?: string;
  kind: ColumnKind;
  editable?: boolean;
  pinned?: boolean;
  dictionaryCode?: keyof typeof dictionarySeeds | "supplier";
};

const dictionaryColumnCodes: Partial<Record<string, ColumnDefinition["dictionaryCode"]>> = {
  exceptionDeliveryMethod: "deliveryMethod",
  modelAge: "modelAge",
  productAttribute: "productAttribute",
  surfaceNature: "surfaceNature",
  specialItem: "specialItem",
  handlingMethod: "handlingMethod"
};

const ordinaryStartBase: ColumnDefinition[] = [
  ["sequence", "序号", "decimal", false, true],
  ["orderNumber", "订单号", "text", false, true],
  ["orderDate", "下单日期", "date", false],
  ["customerDueDate", "客户要求交期", "date", true],
  ["reviewDueDate", "产前评审交期", "date", true],
  ["exceptionDueDate", "异常后二次交期", "date", true],
  ["exceptionDeliveryMethod", "异常交期交货方式", "dictionary", true],
  ["containerDate", "装柜日期", "date", true],
  ["modelAge", "新旧款", "dictionary", true],
  ["itemNumber", "品号", "text", false, true],
  ["relationKey", "关联信息", "text", false],
  ["itemName", "品名", "text", false, true],
  ["image", "简图", "image", true],
  ["productAttribute", "产品属性", "dictionary", true],
  ["surfaceNature", "表面性质", "dictionary", true],
  ["specialItem", "特别项", "dictionary", true],
  ["productionQuantity", "订单需求数量", "decimal", true],
  ["historicalInboundQuantity", "历史入库数据", "decimal", true],
  ["todayInboundQuantity", "当天入库数", "decimal", true],
  ["balanceQuantity", "订单欠数", "decimal", false],
  ["handlingMethod", "制作方式", "dictionary", true]
].map(([key, header, kind, editable, pinned]) => ({
  key: key as string, header: header as string, kind: kind as ColumnKind,
  editable: Boolean(editable), pinned: Boolean(pinned), dictionaryCode: dictionaryColumnCodes[key as string]
}));

const ordinaryStart: ColumnDefinition[] = [
  ...ordinaryStartBase,
  { key: "itemStatus", header: "品号状态", kind: "text", editable: false }
];

const legacyOutsourcing: ColumnDefinition[] = [
  { key: "outsourcing.method", header: "外协方式", group: "外协相关", kind: "dictionary", editable: true, dictionaryCode: "outsourcingMethod" },
  { key: "outsourcing.supplier", header: "外协供应商", group: "外协相关", kind: "dictionary", editable: true, dictionaryCode: "supplier" },
  { key: "outsourcing.dueDate", header: "外协交期", group: "外协相关", kind: "date", editable: true },
  { key: "outsourcing.exceptionDueDate", header: "外协实际交期", group: "外协相关", kind: "date", editable: true }
];

export const milestoneProcessCodes = ["blank", "bakingPlating", "assemblyPacking"] as const;
const standardizedProcessCodes = ["frontParts", "machining", "welding", "grinding", "woodwork", "painting", "acrylic", "rearPackingParts"];

function processFieldHeader(processCode: string, field: "requiredDays" | "dueDate" | "status" | "exception") {
  if (field === "status" && standardizedProcessCodes.includes(processCode)) return "状态";
  return { requiredDays: "所需天数", dueDate: "交期", status: "状态/数量", exception: "异常" }[field];
}

const sourceProcessColumns: ColumnDefinition[] = processDefinitions.flatMap((process) =>
  process.fields.map((field) => ({
    key: `processes.${process.code}.${field}`,
    header: processFieldHeader(process.code, field),
    group: process.name,
    kind: field === "dueDate" ? "date" : field === "requiredDays" ? "decimal" : "text",
    editable: true
  }))
);

const legacyProcessColumns: ColumnDefinition[] = processDefinitions.flatMap((process) =>
  process.fields.flatMap<ColumnDefinition>((field): ColumnDefinition[] => {
    if (field === "status" && milestoneProcessCodes.includes(process.code as typeof milestoneProcessCodes[number])) {
      return [
        { key: `processes.${process.code}.quantity`, header: "数量", group: process.name, kind: "decimal", editable: true },
        { key: `processes.${process.code}.status`, header: "状态", group: process.name, kind: "text", editable: false }
      ];
    }
    return [{
      key: `processes.${process.code}.${field}`,
      header: processFieldHeader(process.code, field),
      group: process.name,
      kind: field === "dueDate" ? "date" : field === "requiredDays" ? "decimal" : "text",
      editable: true
    }];
  })
);

const ordinaryEndBase: ColumnDefinition[] = [
  ["planPage", "对应计划页数", "decimal"],
  ["orderException", "订单异常信息", "text"],
  ["inspection", "验货", "text"],
  ["inspectionQuantity", "验货数量", "decimal"],
  ["remark", "备注", "text"],
  ["orderWeeks", "订单周数", "decimal"],
  ["month", "月", "decimal"],
  ["unitPrice", "单价", "decimal"],
  ["inboundAmount", "订单入库金额", "decimal", false],
  ["balanceAmount", "订单欠数金额", "decimal", false],
  ["customer", "客户", "text"],
  ["division", "所属事业部", "dictionary"]
].map(([key, header, kind, editable = true]) => ({
  key: key as string, header: header as string, kind: kind as ColumnKind, editable: Boolean(editable),
  dictionaryCode: key === "division" ? "division" : undefined
}));

const legacyOrdinaryEnd: ColumnDefinition[] = ordinaryEndBase.map((column) =>
  column.key === "month"
    ? { ...column, header: "年月", kind: "text", editable: false }
    : column
);

/**
 * Retained for backward compatibility and historical data migration only.
 * The active monthly-plan UI/export contract is maintained independently from the legacy 97-column contract.
 */
export const legacyMonthlyPlanColumns: ColumnDefinition[] = [
  ...ordinaryStart, ...legacyOutsourcing, ...legacyProcessColumns, ...legacyOrdinaryEnd
];

export const legacyExcelMonthlyPlanColumns: ColumnDefinition[] = [
  ...ordinaryStartBase, ...legacyOutsourcing, ...sourceProcessColumns, ...ordinaryEndBase
];

const monthlyOutsourcingColumns: ColumnDefinition[] = [
  { key: "outsourcing.supplier", header: "供应商", group: "外协相关", kind: "dictionary", editable: true, dictionaryCode: "supplier" },
  { key: "outsourcing.method", header: "外协方式", group: "外协相关", kind: "dictionary", editable: true, dictionaryCode: "outsourcingMethod" },
  { key: "outsourcing.dueDate", header: "外协交期", group: "外协相关", kind: "date", editable: true },
  { key: "outsourcing.exceptionDueDate", header: "外协实际交期", group: "外协相关", kind: "date", editable: true },
  { key: "outsourcing.requiredDays", header: "所需周期", group: "外协相关", kind: "decimal", editable: true },
  { key: "outsourcing.processDueDate", header: "交期", group: "外协相关", kind: "date", editable: true },
  { key: "outsourcing.status", header: "状态", group: "外协相关", kind: "text", editable: true },
  { key: "outsourcing.exception", header: "异常", group: "外协相关", kind: "text", editable: true }
];

const monthlyProcessGroups = [
  ["drawingBom", "图纸&BOM"],
  ["metalMain", "五金主材"],
  ["woodMain", "木作主材"],
  ["machining", "机加"],
  ["welding", "焊接"],
  ["blank", "毛坯"],
  ["bakingPlating", "电镀"],
  ["acrylic", "亚克力"],
  ["painting", "烤漆"],
  ["assemblyPacking", "组装&包装"],
  ["rearPackingParts", "包装打托"]
] as const;

const monthlyProcessColumns: ColumnDefinition[] = monthlyProcessGroups.flatMap(([code, group]) => [
  { key: `processes.${code}.requiredDays`, header: "所需周期", group, kind: "decimal", editable: true },
  { key: `processes.${code}.dueDate`, header: "交期", group, kind: "date", editable: true },
  { key: `processes.${code}.status`, header: "状态", group, kind: "text", editable: true },
  { key: `processes.${code}.exception`, header: "异常", group, kind: "text", editable: true }
]);

const monthlyOrdinaryEnd = ordinaryEndBase.filter((column) => column.key !== "division");
const monthlyStartColumns: ColumnDefinition[] = [
  ordinaryStartBase[0]!,
  { key: "responsibleOrgId", header: "事业部", kind: "department", editable: true, pinned: true },
  ...ordinaryStartBase.slice(1)
];

export const monthlyPlanColumns: ColumnDefinition[] = [
  ...monthlyStartColumns,
  ...monthlyOutsourcingColumns,
  ...monthlyProcessColumns,
  ...monthlyOrdinaryEnd
];

export const excelMonthlyPlanColumns: ColumnDefinition[] = monthlyPlanColumns;

if (legacyExcelMonthlyPlanColumns.length !== 93 || legacyMonthlyPlanColumns.length !== 97) {
  throw new Error(`Legacy plan column counts must remain Excel=93 and Web=97, got Excel=${legacyExcelMonthlyPlanColumns.length}, Web=${legacyMonthlyPlanColumns.length}`);
}
if (excelMonthlyPlanColumns.length !== 85 || monthlyPlanColumns.length !== 85) {
  throw new Error(`Active monthly plan must contain exactly 85 columns, got Excel=${excelMonthlyPlanColumns.length}, Web=${monthlyPlanColumns.length}`);
}
