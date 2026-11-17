export const mpsDivisionOrderProgressResource = "mps-division-order-progress" as const;
export const mpsDivisionOrderProgressPath = "/pmc/division-order-progress/fourth";
export const mpsDivisionOrderProgressEndpoint = "/master-plan-system/division-order-progress/fourth";

export const mpsDivisionOrderProgressColumns = [
  ["customerCode", "客户代码"], ["orderNumber", "订单单号"], ["itemCode", "品号"], ["itemName", "品名"],
  ["orderDate", "下单日期"], ["expectedShippingDate", "预计发货日期"], ["orderQuantity", "订单数量"],
  ["reviewDueDate", "生管评审交期"], ["drawing", "图纸"], ["materialReady", "物料齐套"], ["cutting", "下料"],
  ["weldingQuantity", "焊接"], ["blankQuantity", "毛坯"], ["surfaceTreatmentQuantity", "表面处理"],
  ["packagingQuantity", "包装"], ["inboundQuantity", "入库"], ["productionStatus", "生产状态"]
] as const;

export const mpsDivisionOrderProgressFieldKeys = mpsDivisionOrderProgressColumns.map(([key]) => key);
export type MpsDivisionOrderProgressField = typeof mpsDivisionOrderProgressColumns[number][0];
export type MpsDivisionOrderProgressRow = Record<MpsDivisionOrderProgressField, string | null> & {
  id: string;
  bomStatus?: "HAS_BOM" | "NO_BOM";
  weldingComplete?: boolean;
  blankComplete?: boolean;
  surfaceTreatmentComplete?: boolean;
  packagingComplete?: boolean;
  inboundComplete?: boolean | null;
  materialReadyHint?: string;
  cuttingHint?: string;
  inboundVerified?: boolean;
  reviewDueTooltip?: string | null;
};
export type MpsDivisionOrderProgressPage = {
  rows: MpsDivisionOrderProgressRow[];
  total: number;
  page: number;
  pageSize: number;
  diagnostics: { basePlanUnlinked: number; baseDueDateMissing: number; processUnlinked: number; inboundUnverified: number };
};
