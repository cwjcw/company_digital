import type { TablePermissionFieldDefinition } from "./index";

export const rdOrderBomReportResource = "rd-order-bom-report" as const;
export const rdOrderBomReportPath = "/rd/bom-report";
export const rdOrderBomReportEndpoint = "/rd/reports/order-bom";
export const rdOrderBomViews = ["detail", "orders", "divisions"] as const;
export type RdOrderBomView = typeof rdOrderBomViews[number];

export const rdOrderBomDetailColumns = [
  ["divisionId", "承接事业部"], ["orderNumber", "订单号"], ["itemCode", "品号"], ["itemName", "品名"],
  ["orderDate", "下单日期"], ["customerDueDate", "客户交期"], ["bomStatus", "BOM状态"],
  ["bomApprovalDate", "BOM审核日期"], ["bomWaitingDays", "BOM等待天数"], ["currentWaitingDays", "当前等待天数"]
] as const;

export const rdOrderBomOrderColumns = [
  ["divisionId", "承接事业部"], ["orderNumber", "订单号"], ["orderDate", "下单日期"],
  ["requiredBomItemCount", "需要BOM品号数量"], ["existingBomItemCount", "已有BOM品号数量"],
  ["missingBomItemCount", "无BOM品号数量"], ["completionRate", "BOM完成率"], ["orderBomStatus", "订单BOM状态"]
] as const;

export const rdOrderBomDivisionColumns = [
  ["divisionId", "承接事业部"], ["orderCount", "订单数量"], ["requiredBomItemCount", "需要BOM品号数量"],
  ["existingBomItemCount", "已有BOM品号数量"], ["missingBomItemCount", "无BOM品号数量"],
  ["completionRate", "BOM完成率"], ["averageBomWaitingDays", "平均BOM等待天数"]
] as const;

export const rdOrderBomReportFields: TablePermissionFieldDefinition[] = [
  { key: "divisionId", label: "承接事业部", type: "department", editable: false },
  { key: "orderNumber", label: "订单号", type: "text", editable: false },
  { key: "itemCode", label: "品号", type: "text", editable: false },
  { key: "itemName", label: "品名", type: "text", editable: false },
  { key: "orderDate", label: "下单日期", type: "date", editable: false },
  { key: "customerDueDate", label: "客户交期", type: "date", editable: false },
  { key: "bomStatus", label: "BOM状态", type: "dictionary", editable: false, options: [
    { value: "HAS_BOM", label: "已有BOM" }, { value: "NO_BOM", label: "无BOM" },
    { value: "NOT_REQUIRED", label: "无需BOM" }, { value: "MATCH_ISSUE", label: "待确认" }
  ] },
  { key: "matchIssue", label: "匹配异常说明", type: "text", editable: false },
  { key: "bomApprovalDate", label: "BOM审核日期", type: "datetime", editable: false },
  { key: "bomWaitingDays", label: "BOM等待天数", type: "number", editable: false },
  { key: "currentWaitingDays", label: "当前等待天数", type: "number", editable: false },
  { key: "requiredBomItemCount", label: "需要BOM品号数量", type: "number", editable: false },
  { key: "existingBomItemCount", label: "已有BOM品号数量", type: "number", editable: false },
  { key: "missingBomItemCount", label: "无BOM品号数量", type: "number", editable: false },
  { key: "completionRate", label: "BOM完成率", type: "number", editable: false },
  { key: "orderBomStatus", label: "订单BOM状态", type: "text", editable: false },
  { key: "orderCount", label: "订单数量", type: "number", editable: false },
  { key: "averageBomWaitingDays", label: "平均BOM等待天数", type: "number", editable: false }
];

export type RdOrderBomRow = Record<string, string | number | null> & {
  id: string;
  matchIssue?: string | null;
};
export type RdOrderBomPage = { rows: RdOrderBomRow[]; total: number; page: number; pageSize: number };
