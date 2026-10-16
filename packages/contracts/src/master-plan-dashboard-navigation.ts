import { mpsDashboardDateRange, mpsDashboardGapKeys, type MpsDashboardFilters, type MpsDashboardGapKey } from "./master-plan-dashboard";

const keys = ["divisionId", "customerCode", "orderNumbers", "itemCodes", "dateType", "datePeriod", "dateValue", "dateFrom", "dateTo"] as const;
export const mpsDashboardDestinations = ["/master-plan-gaps", "/master-plan-order-progress", "/master-plan-reports"] as const;
/** An explicit source marker separates carried scope from a destination's direct-open defaults.
 * URL scope can only narrow the target's own backend authorization; it grants nothing.
 */
export function readMpsDashboardNavigation(search: string): { filters: MpsDashboardFilters; gap?: MpsDashboardGapKey } | null {
  const params = new URLSearchParams(search);
  if (params.get("from") !== "pmc-cockpit") return null;
  const filters: MpsDashboardFilters = { dateType: "NONE" };
  for (const key of keys) {
    if (params.getAll(key).length > 1) throw new Error("筛选参数不能重复");
    const value = params.get(key); if (!value) continue;
    if (key === "orderNumbers" || key === "itemCodes") {
      if (value.length > 22000) throw new Error("多选筛选过长");
      let values: unknown; try { values = JSON.parse(value); } catch { throw new Error("多选筛选必须为数组"); }
      if (!Array.isArray(values) || values.length > 100 || values.some(v => typeof v !== "string" || !v.trim() || v.length > 200)) throw new Error("多选筛选无效，最多100项");
      filters[key] = [...new Set(values as string[])];
    } else {
      if (value.length > (key.startsWith("date") ? 10 : 200)) throw new Error("筛选值过长");
      Object.assign(filters, { [key]: value });
    }
  }
  if (filters.divisionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(filters.divisionId)) throw new Error("事业部必须使用组织ID");
  if (filters.dateType && !["NONE", "ORDER", "DELIVERY"].includes(filters.dateType)) throw new Error("日期类型无效");
  if (filters.datePeriod && !["DAY", "MONTH", "YEAR", "CUSTOM"].includes(filters.datePeriod)) throw new Error("日期周期无效");
  mpsDashboardDateRange(filters);
  const gap = params.get("gap");
  if (gap && !mpsDashboardGapKeys.includes(gap as MpsDashboardGapKey)) throw new Error("待处理事项无效");
  return { filters, ...(gap ? { gap: gap as MpsDashboardGapKey } : {}) };
}
export function mpsDashboardNavigationUrl(path: typeof mpsDashboardDestinations[number], filters: MpsDashboardFilters, gap?: MpsDashboardGapKey): string {
  if (!mpsDashboardDestinations.includes(path)) throw new Error("目标页面无效");
  const params = new URLSearchParams({ from: "pmc-cockpit", dateType: filters.dateType ?? "NONE" });
  for (const key of keys) {
    const value = filters[key];
    if (value != null && value !== "" && (!Array.isArray(value) || value.length)) params.set(key, Array.isArray(value) ? JSON.stringify(value) : value);
  }
  if (gap) params.set("gap", gap);
  return `${path}?${params}`;
}
