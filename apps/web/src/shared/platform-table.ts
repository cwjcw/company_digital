import { emptyFilterGroup, type AdvancedFilterGroup } from "./advanced-filter";

/**
 * KN-FILTER-001 平台统一读取入口（前端侧）：所有已注册资源都用同一个 `/table-filters/rows`
 * 取得服务端分页结果；筛选状态只来自“高级筛选”的唯一 FilterGroup（KN-FILTER-002）。
 */
export type PlatformTableQuery = {
  page: number;
  pageSize: number;
  search: string;
  filters: Record<string, string>;
  filterGroup?: AdvancedFilterGroup;
  sortField?: string;
  sortOrder?: "asc" | "desc";
};

export type PlatformTablePage<T> = { rows: T[]; total: number; page: number; pageSize: number };

export const blankPlatformQuery = (pageSize = 50): PlatformTableQuery => ({
  page: 1, pageSize, search: "", filters: {}, filterGroup: emptyFilterGroup()
});

export function platformRowsUrl(resource: string, query: PlatformTableQuery) {
  const params = new URLSearchParams({ resource, page: String(query.page), pageSize: String(query.pageSize) });
  if (query.search.trim()) params.set("search", query.search.trim());
  if (query.filterGroup?.rules?.length) params.set("filterGroup", JSON.stringify(query.filterGroup));
  if (query.sortField) params.set("sortField", query.sortField);
  if (query.sortOrder) params.set("sortOrder", query.sortOrder);
  return `/table-filters/rows?${params}`;
}

export function platformRowsKey(resource: string, query: PlatformTableQuery) {
  return [resource, query.page, query.pageSize, query.search, query.sortField ?? "", query.sortOrder ?? "", JSON.stringify(query.filterGroup ?? emptyFilterGroup())] as const;
}
