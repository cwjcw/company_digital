/** Shared by the formal plan tables and the overview; no second auxiliary taxonomy. */
export const auxiliaryPlanGroups: Array<{ key: string; title: string; fields: string[] }> = [
  { key: "technical", title: "技术/图纸计划", fields: ["technicalCycleDays", "drawingDueDate", "technicalStatus"] },
  { key: "hardware", title: "五金主材计划", fields: ["hardwareCycleDays", "hardwareDueDate", "hardwareStatus"] },
  { key: "wood", title: "木作主材计划", fields: ["woodCycleDays", "woodDueDate", "woodStatus"] },
  { key: "outsourcing", title: "外协计划", fields: ["outsourcingCycleDays", "outsourcingDueDate", "outsourcingStatus", "outsourcingActualInboundDate"] }
];
export const mpsDashboardResource = "mps-overview-dashboard" as const;
export type MpsDashboardFilters = {
  divisionId?: string; customerCode?: string; orderNumbers?: string[]; itemCodes?: string[];
  dateType?: "NONE" | "ORDER" | "DELIVERY"; datePeriod?: "DAY" | "MONTH" | "YEAR" | "CUSTOM";
  dateValue?: string; dateFrom?: string; dateTo?: string;
};
/** Shanghai business calendar dates, inclusive UI end date -> exclusive SQL upper bound. */
export function mpsDashboardDateRange(input: MpsDashboardFilters): { start: string; end: string } | null {
  if (!input.dateType || input.dateType === "NONE") return null;
  if (!["ORDER", "DELIVERY"].includes(input.dateType)) throw new Error("日期类型无效");
  const valid = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
  const next = (v: string) => new Date(Date.parse(v) + 86400000).toISOString().slice(0, 10);
  const value = input.dateValue ?? "";
  let start: string, end: string;
  switch (input.datePeriod) {
    case "DAY": if (!valid(value)) throw new Error("请选择有效日期"); start = value; end = next(value); break;
    case "MONTH": if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error("请选择有效月份"); start = value + "-01"; end = next(new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5)), 0)).toISOString().slice(0, 10)); break;
    case "YEAR": if (!/^[1-9]\d{3}$/.test(value) || value === "9999") throw new Error("请选择有效年份"); start = value + "-01-01"; end = String(Number(value) + 1) + "-01-01"; break;
    case "CUSTOM": if (!valid(input.dateFrom ?? "") || !valid(input.dateTo ?? "") || input.dateFrom! > input.dateTo!) throw new Error("请选择有效日期范围"); start = input.dateFrom!; end = next(input.dateTo!); break;
    default: throw new Error("日期周期无效");
  }
  return { start, end };
}
/** Reliable, read-only gaps; the three-day-window gap has no authoritative rule. */
export const mpsDashboardGaps = [
  { key: "missing-shipping-plan", title: "未进入出货计划", metric: "missingShippingCount", dependencies: ["requiredQuantity"] },
  { key: "missing-base-plan", title: "未进入基础计划", metric: "missingBaseCount", dependencies: ["plannedQuantity"] },
  { key: "missing-weekly-plan", title: "未进入周计划（已具备条件）", metric: "missingWeeklyCount", dependencies: ["weeklyPlanState"] },
  { key: "plan-not-ready", title: "计划待完善", metric: "planNotReadyCount", dependencies: ["weeklyPlanState"] },
  { key: "not-started-production", title: "未开始报工", metric: "notStartedProductionCount", dependencies: ["plannedQuantity", "reportedQuantity"] },
  { key: "no-inbound", title: "未入库", metric: "noInboundCount", dependencies: ["requiredQuantity", "cumulativeInboundQuantity"] },
  { key: "incomplete-inbound", title: "未完成入库", metric: "incompleteInboundCount", dependencies: ["cumulativeInboundQuantity", "pendingQuantity"] },
  { key: "overdue", title: "延期未完成", metric: "overdueGapCount", dependencies: ["pendingQuantity", "latestCustomerDueDate"] },
  { key: "production-exception", title: "生产异常", metric: "productionExceptionGapCount", dependencies: ["exceptionSummary"] }
] as const;
export type MpsDashboardGapKey = typeof mpsDashboardGaps[number]["key"];
export const mpsDashboardGapKeys = mpsDashboardGaps.map(g => g.key);
export const mpsDashboardTableKeys = ["division-summary", "plan-readiness", "process-execution", "risk-exception", "process-summary", ...mpsDashboardGapKeys] as const;
export type MpsDashboardTableKey = typeof mpsDashboardTableKeys[number];
const identityColumns = [["divisionId", "事业部"], ["customerCode", "客户"], ["orderNumber", "订单号"], ["itemCode", "品号"], ["itemName", "品名"], ["orderDate", "订单日期"], ["deliveryDate", "交付日期"]] as const;
export const mpsDashboardReadinessColumns = [...identityColumns, ["deliveryNumber", "交期编码"], ["plannedQuantity", "计划数量"], ["weeklyPlanState", "周计划状态"], ["weeklyPlanMissingFields", "周计划缺少项"], ["weeklyPlanGenerationIssue", "周计划生成提示"]] as const;
export const mpsDashboardExecutionColumns = [...identityColumns, ["processName", "工序"], ["requiredQuantity", "需求数量"], ["reportedQuantity", "累计实际报工"], ["productionProgress", "生产进度"], ["status", "状态"], ["productionDate", "最近报工日期"]] as const;
export function mpsDashboardGapColumns(key: MpsDashboardGapKey): ReadonlyArray<readonly [string, string]> {
  const columns: Array<readonly [string, string]> = [...identityColumns];
  if (["missing-base-plan", "missing-weekly-plan", "plan-not-ready", "not-started-production"].includes(key)) columns.push(["deliveryNumber", "交期编码"], ["plannedQuantity", "计划数量"]);
  else columns.push(["requiredQuantity", "需求数量"]);
  if (["missing-weekly-plan", "plan-not-ready"].includes(key)) columns.push(["weeklyPlanState", "周计划状态"], ["weeklyPlanMissingFields", "周计划缺少项"], ["weeklyPlanGenerationIssue", "周计划生成提示"]);
  if (key === "not-started-production") columns.push(["reportedQuantity", "累计实际报工"]);
  if (["no-inbound", "incomplete-inbound", "overdue"].includes(key)) columns.push(["cumulativeInboundQuantity", "累计入库"], ["pendingQuantity", "欠数"]);
  if (key === "production-exception") columns.push(["exceptionSummary", "异常"]);
  return [...columns, ["currentNode", "当前节点"], ["currentStatus", "当前状态"]];
}
export type MpsDashboardTableData = { rows: MpsDashboardRow[]; total: number; page: number; pageSize: number; visibleFields: string[] };
export type MpsDashboardRow = Record<string, string | number | null>;
export type MpsDashboardData = {
  visibleFields: string[]; generatedAt: string; trendStart: string; trendEnd: string;
  orders: MpsDashboardRow; plans: MpsDashboardRow;
  gaps: Partial<Record<MpsDashboardGapKey, number>>;
  readiness: MpsDashboardRow[]; auxiliary: Array<{ key: string; states: MpsDashboardRow[] }>;
  processes: Array<{ code: string; name: string; order: number; values: MpsDashboardRow; states: MpsDashboardRow[] }>;
  trend: MpsDashboardRow[]; divisions: MpsDashboardRow[];
  risks: { rows: MpsDashboardRow[]; total: number; page: number; pageSize: number };
};
export type MpsDashboardSummary = Omit<MpsDashboardData, "risks">;
export type MpsDashboardGapCounts = Pick<MpsDashboardData, "gaps" | "visibleFields" | "generatedAt">;
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
  ["divisionId", "事业部"], ["customerCode", "客户"], ["orderNumber", "订单号"], ["itemCode", "品号"], ["itemName", "品名"], ["orderDate", "订单日期"], ["deliveryDate", "交付日期"],
  ["requiredQuantity", "需求数量"], ["dispatchedWeeklyQuantity", "已下达周计划数量"],
  ["cumulativeInboundQuantity", "累计入库"], ["pendingQuantity", "欠数"], ["riskType", "风险类型"],
  ["exceptionSummary", "异常"]
] as const;
