/** Shared by the formal plan tables and the overview; no second auxiliary taxonomy. */
export const auxiliaryPlanGroups: Array<{ key: string; title: string; fields: string[] }> = [
  { key: "technical", title: "技术/图纸计划", fields: ["technicalCycleDays", "drawingDueDate", "technicalStatus"] },
  { key: "hardware", title: "五金主材计划", fields: ["hardwareCycleDays", "hardwareDueDate", "hardwareStatus"] },
  { key: "wood", title: "木作主材计划", fields: ["woodCycleDays", "woodDueDate", "woodStatus"] },
  { key: "outsourcing", title: "外协计划", fields: ["outsourcingCycleDays", "outsourcingDueDate", "outsourcingStatus", "outsourcingActualInboundDate"] }
];
export const mpsDashboardResource = "mps-overview-dashboard" as const;
export type MpsDashboardFilters = { divisionId?: string; customerCode?: string; orderNumber?: string; item?: string };
export type MpsDashboardRow = Record<string, string | number | null>;
export type MpsDashboardData = {
  visibleFields: string[]; generatedAt: string; trendStart: string; trendEnd: string;
  orders: MpsDashboardRow; plans: MpsDashboardRow;
  readiness: MpsDashboardRow[]; auxiliary: Array<{ key: string; states: MpsDashboardRow[] }>;
  processes: Array<{ code: string; name: string; order: number; values: MpsDashboardRow; states: MpsDashboardRow[] }>;
  trend: MpsDashboardRow[]; divisions: MpsDashboardRow[];
  risks: { rows: MpsDashboardRow[]; total: number; page: number; pageSize: number };
};
export const mpsDashboardOrderMetrics = [
  ["orderCount", "订单数"], ["unfinishedOrderCount", "未完成订单数"], ["orderRequiredQuantity", "需求数量"],
  ["orderCompletedQuantity", "完成数量"], ["orderPendingQuantity", "待完成数量"], ["orderCompletionRate", "整体完成率"]
] as const;
export const mpsDashboardPlanMetrics = [
  ["requiredQuantity", "月计划需求数量"], ["dispatchedWeeklyQuantity", "已下达周计划数量"], ["dispatchRate", "周计划下达率"],
  ["cumulativeInboundQuantity", "累计入库数量"], ["pendingQuantity", "欠数"], ["inboundRate", "入库完成率"],
  ["overdueCount", "延期月计划条数"], ["exceptionCount", "生产异常月计划条数"]
] as const;
export const mpsDashboardRiskColumns = [
  ["divisionId", "事业部"], ["orderNumber", "订单号"], ["itemCode", "品号"], ["itemName", "品名"],
  ["latestCustomerDueDate", "最迟客户交期"], ["requiredQuantity", "需求数量"], ["dispatchedWeeklyQuantity", "已下达周计划数量"],
  ["cumulativeInboundQuantity", "累计入库"], ["pendingQuantity", "欠数"], ["riskType", "风险类型"],
  ["exceptionSummary", "异常"], ["weeklyPlanMissingFields", "周计划缺少项"], ["weeklyPlanGenerationIssue", "周计划生成提示"]
] as const;
