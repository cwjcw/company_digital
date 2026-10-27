import { standardProcesses } from "@tracker/shared";
import type { MpsDashboardFilters } from "./master-plan-dashboard";

export const mpsOrderProgressResource = "mps-order-progress-dashboard" as const;
export const mpsOrderProgressPath = "/master-plan-order-progress";
export const mpsOrderProgressEndpoint = "/master-plan-system/order-progress";
export const mpsOrderProgressExportKeys = ["orders", "items"] as const;
export type MpsOrderProgressExportKey = typeof mpsOrderProgressExportKeys[number];
export type MpsOrderProgressFilters = MpsDashboardFilters & { onlyUnfinishedOrders?: boolean; onlyUnfinishedItems?: boolean };
export type MpsProgressRow = Record<string, string | number | null> & { id: string };
export type MpsProgressPage = { rows: MpsProgressRow[]; total: number; page: number; pageSize: number; visibleFields: string[] };
export const mpsOrderProgressOrderColumns = [
  ["divisionId", "主责事业部"], ["customerCode", "客户"], ["orderNumber", "订单号"], ["orderDate", "订单日期"], ["deliveryDate", "交付日期"],
  ["orderRequiredQuantity", "订单需求数量"], ["orderCompletedQuantity", "订单完成数量"], ["orderPendingQuantity", "订单待完成数量"],
  ["orderProductionProgress", "综合生产进度"], ["orderCompletionRate", "订单入库完成率"], ["unfinishedItemCount", "未完成品项数"], ["coverageStatus", "计划覆盖"], ["exceptionSummary", "人工异常"]
] as const;
export const mpsOrderProgressItemColumns = [
  ["divisionId", "承接事业部"], ["orderNumber", "订单号"], ["itemCode", "品号"], ["itemName", "品名"], ["sourceKind", "需求来源"],
  ["customerCode", "客户"], ["orderDate", "订单日期"], ["deliveryDate", "交付日期"], ["planStatus", "计划状态"],
  ["sourceQuantity", "来源行数量"], ["requiredQuantity", "月计划需求"], ["dispatchedWeeklyQuantity", "已下达周计划"],
  ["itemProductionProgress", "综合生产进度"], ["itemProgressBasis", "有效工序及口径"], ["cumulativeInboundQuantity", "累计入库"], ["pendingQuantity", "欠数"], ["itemCompletionRate", "入库完成率"],
  ["technicalStatus", "图纸"], ["hardwareStatus", "五金主材"], ["woodStatus", "木作主材"], ["outsourcingStatus", "外协"],
  ["exceptionSummary", "人工异常"]
] as const;
/** The same registry drives matrix columns, permissions, tooltips and export. */
export const mpsOrderProgressProcessFields = [...standardProcesses].sort((a,b)=>a.order-b.order).flatMap(p => [
  [`${p.code}RequiredQuantity`, `${p.name}需求数量`, "number"], [`${p.code}ReportedQuantity`, `${p.name}累计实际报工`, "number"],
  [`${p.code}ProductionProgress`, `${p.name}生产进度`, "number"], [`${p.code}Status`, `${p.name}状态`, "text"],
  [`${p.code}LastReportDate`, `${p.name}最近报工日期`, "date"], [`${p.code}TaskCount`, `${p.name}工序任务数`, "number"]
] as Array<[string,string,"number"|"text"|"date"]>);
export const mpsOrderProgressItemExportColumns: ReadonlyArray<readonly [string,string]> = [...mpsOrderProgressItemColumns, ...mpsOrderProgressProcessFields.map(([key,label]) => [key,label] as const)];
