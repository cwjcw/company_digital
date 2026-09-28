import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { AdvancedFilterGroup } from "./advanced-filter";

export type TableExportRequest = {
  resource: string;
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
  const params = new URLSearchParams();
  if (request.search?.trim()) params.set("search", request.search.trim());
  if (request.filterGroup && (request.filterGroup.rules.length || request.filterGroup.groups?.length)) params.set("filterGroup", JSON.stringify(request.filterGroup));
  if (request.sortField) params.set("sortField", request.sortField);
  if (request.sortOrder) params.set("sortOrder", request.sortOrder);
  if (request.context && Object.keys(request.context).length) params.set("context", JSON.stringify(request.context));
  if (request.columnKeys?.length) params.set("columnKeys", request.columnKeys.join(","));
  const blob = await api<Blob>(`/table-exports/${encodeURIComponent(request.resource)}${params.toString() ? `?${params}` : ""}`);
  if (!(blob instanceof Blob) || blob.size === 0) throw new Error("导出文件为空");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = `${request.resource}.xlsx`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return blob;
}
