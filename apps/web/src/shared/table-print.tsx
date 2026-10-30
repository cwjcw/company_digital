/* eslint-disable react-refresh/only-export-components -- shared print helpers are intentionally co-located with the print document component */
import { createRoot, type Root } from "react-dom/client";
import { api } from "../api";
import { useQuery } from "@tanstack/react-query";
import type { AdvancedFilterGroup } from "./advanced-filter";
import { PrintSettingsPreview } from "./table-print-settings";
export { KdosPrintDocument, formatPrintDateTime } from "./table-print-document";

/**
 * KN-PRINT-001 平台统一打印（前端侧）：所有标准表格共用这一份实现。
 * 数据来自后端 Print DTO（已做权限裁剪、投影、格式化与 label 解析），前端只负责渲染专门的打印 DOM 并调用浏览器打印。
 */
export type TablePrintColumn = { key: string; label: string; align: "left" | "center" | "right"; width: number };
export type TablePrintHeaderGroup = { label: string; columns: string[] };
export type TablePrintManifest = {
  resource: string; title: string; printable: boolean; reason?: string; total: number;
  columns: TablePrintColumn[]; headerGroups: TablePrintHeaderGroup[];
  orientation: "portrait" | "landscape"; batchSize: number; confirmThreshold: number; largeWarningThreshold: number;
};
export type TablePrintDto = {
  title: string; resource: string; columns: TablePrintColumn[]; headerGroups: TablePrintHeaderGroup[];
  rows: Array<Record<string, string>>;
  meta: {
    rangeType: "FILTERED" | "SELECTED"; total: number; requestedCount?: number; printedCount: number;
    orientation: "portrait" | "landscape"; filtered: boolean; searched: boolean; printedAt: string; printedBy: string;
  };
};

export type TablePrintRangeType = "FILTERED" | "SELECTED";

export type TablePrintRequest = {
  resource: string;
  /** 显式打印模式：禁止用 selectedIds 是否为空猜模式。 */
  rangeType: TablePrintRangeType;
  search?: string;
  filterGroup?: AdvancedFilterGroup | null;
  sortField?: string;
  sortOrder?: "asc" | "desc";
  /** 页面业务上下文（部门/状态/角色/视图），后端强制 AND。 */
  context?: Record<string, unknown>;
  /** 打印已选：稳定记录 ID；后端会重新取数并做权限过滤。 */
  selectedIds?: string[];
  /** Initial visible business keys; settings may add other server-authorized printable fields. */
  columnKeys?: string[];
  titleHint?: string;
  /** Independent business view and preference identity; never used as authorization. */
  viewKey?: string;
  preferenceScope?: { tenantKey: string; userKey: string };
};

/** 打印能力（后端为唯一真相，前端只用于显示/隐藏入口）。 */
export function useTablePrintCapabilities() {
  return useQuery({
    queryKey: ["table-print-capabilities"],
    queryFn: () => api<Array<{ code: string; label: string; print: { status: string; reason?: string }; allowed: boolean }>>("/table-prints/capabilities"),
    staleTime: 300_000
  });
}

export function tablePrintAllowed(capabilities: Array<{ code: string; print: { status: string }; allowed: boolean }> | undefined, resource: string) {
  /* 后端未返回（加载中/异常）或返回非数组时一律视为不可打印，避免出现“假打印入口”。 */
  if (!Array.isArray(capabilities)) return false;
  const entry = capabilities.find((candidate) => candidate.code === resource);
  return Boolean(entry && entry.print.status === "PRINTABLE" && entry.allowed);
}

const printBody = (request: TablePrintRequest) => ({
  resource: request.resource,
  rangeType: request.rangeType,
  search: request.search ?? "",
  filterGroup: request.filterGroup ?? undefined,
  sortField: request.sortField,
  sortOrder: request.sortOrder,
  context: request.context ?? {},
  selectedIds: request.selectedIds ?? [],
  columnKeys: request.columnKeys
});

/**
 * 打开打印预览（Dedicated Print DOM）：用户可以在打印前看到标题/字段/数据/方向，并可切换纵向/横向。
 * 点“打印”后才调用浏览器打印；打印时只输出打印文档，业务页面不会进入打印内容。
 */
function openPrintPreview(dto: TablePrintDto, request: TablePrintRequest) {
  const portal = document.createElement("div");
  portal.className = "kdos-print-portal";
  document.body.appendChild(portal);
  const root: Root = createRoot(portal);
  const cleanup = () => { root.unmount(); portal.remove(); };
  root.render(<PrintSettingsPreview dto={dto} request={request} onClose={cleanup} />);
  return cleanup;
}

/**
 * 打印两阶段 API（便于页面用自身 Modal 做确认，避免静态 Modal 在不同构建下不渲染）：
 * 1) planPrint 只计算真实条数（不加载数据），返回是否需要用户确认；
 * 2) renderPrint 真正生成 Print DTO 并打开打印预览。
 * 后端每次都重新校验 batch_print / read / tenant / data scope / 字段权限。
 */
export function printConfirmMessage(manifest: TablePrintManifest) {
  if (manifest.total > manifest.largeWarningThreshold) {
    return `当前结果 ${manifest.total.toLocaleString("zh-CN")} 条，浏览器生成打印内容可能耗时较长，建议进一步筛选后再打印。是否仍然继续？`;
  }
  return `当前筛选结果共 ${manifest.total.toLocaleString("zh-CN")} 条，打印内容较多，是否继续？`;
}

export async function planPrint(request: TablePrintRequest) {
  const manifest = await api<TablePrintManifest>(
    `/table-prints/manifest?resource=${encodeURIComponent(request.resource)}&rangeType=${request.rangeType}${request.search ? `&search=${encodeURIComponent(request.search)}` : ""}${request.sortField ? `&sortField=${encodeURIComponent(request.sortField)}` : ""}${request.sortOrder ? `&sortOrder=${encodeURIComponent(request.sortOrder)}` : ""}${request.filterGroup && (request.filterGroup.rules.length || request.filterGroup.groups?.length) ? `&filterGroup=${encodeURIComponent(JSON.stringify(request.filterGroup))}` : ""}${request.context && Object.keys(request.context).length ? `&context=${encodeURIComponent(JSON.stringify(request.context))}` : ""}${request.selectedIds?.length ? `&selectedIds=${encodeURIComponent(request.selectedIds.join(","))}` : ""}`
  );
  return { manifest, requiresConfirm: manifest.total > manifest.confirmThreshold };
}

export async function fetchPrintDto(request: TablePrintRequest) {
  return api<TablePrintDto>("/table-prints/render", { method: "POST", body: JSON.stringify(printBody(request)) });
}

export async function renderPrint(request: TablePrintRequest) {
  // Load all server-authorized printable business fields so hidden fields can be added in settings.
  const dto = await fetchPrintDto({ ...request, columnKeys: undefined });
  if (!dto.rows.length) return { printed: false as const, reason: "empty" as const, dto };
  const cleanup = openPrintPreview(dto, request);
  return { printed: true as const, reason: "printed" as const, dto, cleanup };
}

/** 兼容便捷入口：内部走两阶段 API，可用 confirm 回调做确认。 */
export async function printTable(request: TablePrintRequest & { confirm?: (content: string) => Promise<boolean> }) {
  const { manifest, requiresConfirm } = await planPrint(request);
  if (manifest.total === 0) return { printed: false as const, reason: "empty" as const, manifest };
  if (requiresConfirm) {
    const confirmed = await request.confirm?.(printConfirmMessage(manifest));
    if (!confirmed) return { printed: false as const, reason: "cancelled" as const, manifest };
  }
  const result = await renderPrint(request);
  return { ...result, manifest };
}
