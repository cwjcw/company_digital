import { tablePermissionFieldsFor } from "@kdos/contracts";
import { hasFieldPermission, hasResourcePermission, hasSessionResourcePermission } from "../../shared/KdosDataTable";
import { hasFilterGroup, type AdvancedFilterGroup } from "../../shared/advanced-filter";
import type { PlatformTableQuery } from "../../shared/platform-table";

export const resource = "pmc-rd-progress";
export const reportPath = "/pmc/reports/rd-progress";
export const fields = tablePermissionFieldsFor(resource);
export const readable = (key: string) => hasFieldPermission(resource, key, "read");
export const canOpenOrder = () => ["sourceOrderId", "orderNo", "rdStatus"].every(readable);
export const reportNavigation = (session?: Parameters<typeof hasSessionResourcePermission>[0]) => (session ? hasSessionResourcePermission(session, resource, "read") : hasResourcePermission(resource, "read"))
  ? [{ key: "pmc-reports", label: "报表", children: [{ key: reportPath, label: "研发进度" }] }] : [];
export type ProgressRow = Record<string, string | number | boolean | null | undefined> & { id: string };
export type Summary = {
  orderCount: number; itemCount: number; completeItemCount?: number; incompleteItemCount?: number;
  abnormalItemCount?: number; notApplicableItemCount?: number; overallCompletionRate?: string | null;
  designBomCompletionRate?: string | null; routingCompletionRate?: string | null; statusCounts?: Record<string, number>;
};
export type OrderProgress = {
  sourceOrderId: string; orderNo: string; customerName?: string; customerCode?: string;
  totalItemCount: number; applicableItemCount: number; completeItemCount: number;
  incompleteItemCount: number; abnormalItemCount: number; completionRate: string | null; orderRdStatus: string;
};
export type SyncStatus = { latestSync: null | { mode: string; status: string; sourceSnapshotAt: string | null; completedAt: string | null; startedAt: string } };
export type ReportFilters = Record<string, string>;
const filterFields: Record<string, string> = {
  orderNo: "orderNo", customer: "customerName", division: "divisionId", itemCode: "itemCode", itemName: "itemName",
  rdStatus: "rdStatus", designBomStatus: "designBomStatus", routingStatus: "routingStatus",
  orderDateFrom: "orderDate", orderDateTo: "orderDate", onlyIncomplete: "rdStatus"
};
export function parseFilters(params: URLSearchParams): ReportFilters {
  return Object.fromEntries(Object.entries(filterFields).flatMap(([key, field]) => {
    const value = params.get(key)?.trim();
    if (!readable(field) || !value || (key === "onlyIncomplete" && value !== "true")) return [];
    return [[key, value]];
  }));
}
export function reportUrl(endpoint: "items" | "summary" | "orders", filters: ReportFilters, query?: PlatformTableQuery, group?: AdvancedFilterGroup) {
  const params = new URLSearchParams(filters);
  if (query?.search.trim()) params.set("search", query.search.trim());
  const filterGroup = group ?? query?.filterGroup;
  if (hasFilterGroup(filterGroup)) params.set("filterGroup", JSON.stringify(filterGroup));
  if (endpoint !== "summary") {
    params.set("page", String(query?.page ?? 1)); params.set("pageSize", String(query?.pageSize ?? 100));
    if (query?.sortField) params.set("sortField", query.sortField);
    if (query?.sortOrder) params.set("sortOrder", query.sortOrder);
  }
  return `/pmc/reports/rd-progress/${endpoint}?${params}`;
}
export const orderFilter = (sourceOrderId: string): AdvancedFilterGroup => ({ logic: "AND", rules: [{ field: "sourceOrderId", operator: "eq", value: sourceOrderId }] });
/** E10 timestamps are wall-clock values; only timezone-bearing sync instants are converted. */
export function businessTime(value: unknown) {
  if (!value) return "—";
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) return raw.replace("T", " ").slice(0, 19);
  const date = new Date(raw);
  return Number.isNaN(date.valueOf()) ? raw : new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}
export const percentText = (value: string | null | undefined) => value == null ? "—" : `${value}%`;

export function sessionCacheScope() {
  const session = JSON.parse(localStorage.getItem("sessionUser") ?? "{}");
  return JSON.stringify([session.tenantId ?? session.tenantCode ?? "KAINAN", session.sub ?? "anonymous", session.isSystemAdmin, session.moduleAdminCodes, session.permissions, session.tableDataScopes]);
}
