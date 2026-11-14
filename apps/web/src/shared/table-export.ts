import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { AdvancedFilterGroup } from "./advanced-filter";

export type TableExportRequest = {
  filename?: string;
  resource: string;
  /** Explicit row range; selected exports never fall back to the current view. */
  rangeType: "FILTERED" | "SELECTED";
  /** Stable record IDs, preserved across server pages and revalidated by the API. */
  selectedIds?: string[];
  search?: string;
  filterGroup?: AdvancedFilterGroup | null;
  sortField?: string;
  sortOrder?: "asc" | "desc";
  context?: Record<string, unknown>;
  columnKeys?: string[];
};

export type TableExportCapability = { code: string; supported: boolean; allowed: boolean };

export function useTableExportCapabilities() {
  return useQuery({
    queryKey: ["table-export-capabilities"],
    queryFn: () => api<TableExportCapability[]>("/table-exports/capabilities"),
    staleTime: 300_000
  });
}

export function tableExportAllowed(capabilities: TableExportCapability[] | undefined, resource: string) {
  if (!Array.isArray(capabilities)) return false;
  const entry = capabilities.find((candidate) => candidate.code === resource);
  return Boolean(entry?.supported && entry.allowed);
}

export async function exportTable(request: TableExportRequest) {
  const rangeType = request.rangeType;
  if (rangeType !== "FILTERED" && rangeType !== "SELECTED") throw new Error("导出模式无效");
  if (rangeType === "SELECTED" && !request.selectedIds?.length) throw new Error("请先选择要导出的记录");
  if (rangeType === "FILTERED" && request.selectedIds?.length) throw new Error("筛选结果导出不能携带选中记录");
  const path = `/table-exports/${encodeURIComponent(request.resource)}`;
  const blob = rangeType === "SELECTED"
    ? await api<Blob>(path, { method: "POST", body: JSON.stringify({
      rangeType, selectedIds: [...new Set(request.selectedIds!.map(String))], sortField: request.sortField,
      sortOrder: request.sortOrder, context: request.context ?? {}, columnKeys: request.columnKeys
    }) })
    : await api<Blob>(`${path}?${new URLSearchParams({
      rangeType,
      ...(request.search?.trim() ? { search: request.search.trim() } : {}),
      ...(request.filterGroup && (request.filterGroup.rules.length || request.filterGroup.groups?.length) ? { filterGroup: JSON.stringify(request.filterGroup) } : {}),
      ...(request.sortField ? { sortField: request.sortField } : {}),
      ...(request.sortOrder ? { sortOrder: request.sortOrder } : {}),
      ...(request.context && Object.keys(request.context).length ? { context: JSON.stringify(request.context) } : {}),
      ...(request.columnKeys ? { columnKeys: request.columnKeys.join(",") } : {})
    })}`);
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error("导出文件为空");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = request.filename ?? `${request.resource}.xlsx`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return blob;
}
