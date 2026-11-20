import type { TablePermissionFieldDefinition } from "./index";

export const rdOrderBomReportResource = "rd-order-bom-report" as const;
export const rdOrderBomReportPath = "/rd/bom-report";
export const rdOrderBomReportEndpoint = "/rd/reports/order-bom";
export const rdOrderBomViews = ["detail", "orders", "divisions"] as const;
export type RdOrderBomView = typeof rdOrderBomViews[number];

export const rdOrderBomDetailColumns = [
  ["divisionId", "承接事业部"], ["orderNumber", "订单号"], ["itemCode", "品号"], ["itemName", "品名"],
  ["orderDate", "下单日期"], ["customerDueDate", "客户交期"], ["bomStatus", "BOM状态"],
  ["bomSources", "BOM来源系统"], ["sourceModifiedTimes", "来源候选更新时间"], ["sourceSyncStatus", "同步状态"], ["bomSourceNote", "来源说明"],
  ["bomApprovalDate", "BOM审核日期"], ["bomWaitingDays", "BOM等待天数"], ["currentWaitingDays", "当前等待天数"]
] as const;

export const rdOrderBomOrderColumns = [
  ["divisionId", "承接事业部"], ["orderNumber", "订单号"], ["orderDate", "下单日期"],
  ["itemCount", "品号总数"], ["existingBomItemCount", "有BOM品号数"],
  ["missingBomItemCount", "无BOM品号数"], ["unmatchedBomItemCount", "未核验品号数"],
  ["completionRate", "BOM完成率"], ["orderBomStatus", "订单BOM完成情况"], ["sourceSyncStatus", "同步状态"]
] as const;

export const rdOrderBomDivisionColumns = [
  ["divisionId", "承接事业部"], ["orderCount", "订单数量"], ["itemCount", "品号总数"],
  ["existingBomItemCount", "有BOM数量"], ["missingBomItemCount", "无BOM数量"], ["unmatchedBomItemCount", "未核验数量"],
  ["completionRate", "BOM完成率"], ["averageBomWaitingDays", "平均BOM等待天数"], ["sourceSyncStatus", "同步状态"]
] as const;

export const rdOrderBomReportFields: TablePermissionFieldDefinition[] = [
  { key: "divisionId", label: "承接事业部", type: "department", editable: false },
  { key: "orderNumber", label: "订单号", type: "text", editable: false },
  { key: "itemCode", label: "品号", type: "text", editable: false },
  { key: "itemName", label: "品名", type: "text", editable: false },
  { key: "orderDate", label: "下单日期", type: "date", editable: false },
  { key: "customerDueDate", label: "客户交期", type: "date", editable: false },
  { key: "bomStatus", label: "BOM状态", type: "dictionary", editable: false, options: [
    { value: "Y", label: "Y" }, { value: "N", label: "N" }
  ] },
  { key: "bomSources", label: "BOM来源系统", type: "text", editable: false },
  { key: "sourceModifiedTimes", label: "来源候选更新时间", type: "text", editable: false },
  { key: "sourceSyncStatus", label: "同步状态", type: "text", editable: false },
  { key: "bomSourceNote", label: "来源说明", type: "text", editable: false },
  { key: "bomApprovalDate", label: "BOM审核日期", type: "datetime", editable: false },
  { key: "bomWaitingDays", label: "BOM等待天数", type: "number", editable: false },
  { key: "currentWaitingDays", label: "当前等待天数", type: "number", editable: false },
  { key: "itemCount", label: "品号总数", type: "number", editable: false },
  { key: "existingBomItemCount", label: "已有BOM品号数量", type: "number", editable: false },
  { key: "missingBomItemCount", label: "无BOM品号数量", type: "number", editable: false },
  { key: "unmatchedBomItemCount", label: "未核验数量", type: "number", editable: false },
  { key: "completionRate", label: "BOM完成率", type: "number", editable: false },
  { key: "orderBomStatus", label: "订单BOM状态", type: "text", editable: false },
  { key: "orderCount", label: "订单数量", type: "number", editable: false },
  { key: "averageBomWaitingDays", label: "平均BOM等待天数", type: "number", editable: false }
];

export type RdOrderBomRow = Record<string, string | number | null> & {
  id: string;
};
export type RdOrderBomPage = { rows: RdOrderBomRow[]; total: number; page: number; pageSize: number };
