/* eslint-disable react-refresh/only-export-components -- shared print helpers are intentionally co-located with the print document component */
import { Modal } from "antd";
import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { api } from "../api";
import { useQuery } from "@tanstack/react-query";
import type { AdvancedFilterGroup } from "./advanced-filter";

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
  /** 客户端只能收窄列集合。 */
  columnKeys?: string[];
  titleHint?: string;
};

/** 打印能力（后端为唯一真相，前端只用于显示/隐藏入口）。 */
export function useTablePrintCapabilities() {
  return useQuery({
    queryKey: ["table-print-capabilities"],
    queryFn: () => api<Array<{ code: string; label: string; print: { status: string; reason?: string }; allowed: boolean }>>("/table-prints/capabilities"),
    staleTime: 300_000
  });
}

/**
 * KN-PRINT-001：打印业务时间统一按 Asia/Shanghai 显示为 `YYYY-MM-DD HH:mm:ss`。
 * 后端始终返回 ISO instant；这里显式指定时区，禁止依赖浏览器本机时区、禁止手工 +8。
 */
export function formatPrintDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
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
  columnKeys: request.columnKeys ?? []
});

/**
 * 打开打印预览（Dedicated Print DOM）：用户可以在打印前看到标题/字段/数据/方向，并可切换纵向/横向。
 * 点“打印”后才调用浏览器打印；打印时只输出打印文档，业务页面不会进入打印内容。
 */
function openPrintPreview(dto: TablePrintDto, initialOrientation: "portrait" | "landscape") {
  const portal = document.createElement("div");
  portal.className = "kdos-print-portal";
  document.body.appendChild(portal);
  const sizeStyle = document.createElement("style");
  document.head.appendChild(sizeStyle);
  const root: Root = createRoot(portal);
  const cleanup = () => { root.unmount(); portal.remove(); sizeStyle.remove(); };
  const applyOrientation = (orientation: "portrait" | "landscape") => {
    sizeStyle.textContent = `@page { size: A4 ${orientation}; margin: ${orientation === "landscape" ? "8mm" : "10mm"}; }`;
  };
  const PrintPreview = () => {
    const [orientation, setOrientation] = useState<"portrait" | "landscape">(initialOrientation);
    useEffect(() => { applyOrientation(orientation); }, [orientation]);
    const current: TablePrintDto = { ...dto, meta: { ...dto.meta, orientation } };
    return <div className="kdos-print-preview" data-testid="kdos-print-preview">
      <div className="kdos-print-preview-bar">
        <span className="kdos-print-preview-hint">打印预览：共 {dto.meta.printedCount} 条 · 方向：{orientation === "landscape" ? "横向 A4" : "纵向 A4"}</span>
        <button type="button" onClick={() => setOrientation(orientation === "landscape" ? "portrait" : "landscape")}>
          切换为{orientation === "landscape" ? "纵向" : "横向"}
        </button>
        <button type="button" onClick={() => window.print()}>打印</button>
        <button type="button" onClick={cleanup}>关闭</button>
      </div>
      <div className={`kdos-print-paper paper-${orientation}`}>
        <KdosPrintDocument dto={current} />
      </div>
    </div>;
  };
  root.render(<PrintPreview />);
  return cleanup;
}

export function KdosPrintDocument({ dto }: { dto: TablePrintDto }) {
  const { meta } = dto;
  const scope = meta.rangeType === "SELECTED"
    ? `打印范围：已选，共 ${meta.printedCount} 条`
    : `打印范围：${meta.filtered || meta.searched ? "筛选结果" : "全部记录"}，共 ${meta.printedCount} 条`;
  return <div className={`kdos-print-root orientation-${meta.orientation}`} data-testid="kdos-print-root">
    <div className="kdos-print-header">
      <div className="kdos-print-platform">凯南数字化工作台</div>
      <div className="kdos-print-title">{dto.title}</div>
      <div className="kdos-print-meta">
        <span>打印时间：{formatPrintDateTime(meta.printedAt)}</span>
        <span>打印人：{meta.printedBy?.trim() || "—"}</span>
      </div>
      <div className="kdos-print-scope">{scope}</div>
    </div>
    {dto.rows.length
      ? <table className="kdos-print-table" data-testid="kdos-print-table">
        <thead>
          {dto.headerGroups.length > 0 && <tr>
            {dto.headerGroups.map((group) => <th key={group.label} colSpan={group.columns.length}>{group.label}</th>)}
          </tr>}
          <tr>{dto.columns.map((column) => <th key={column.key} style={{ width: `${column.width}%` }}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {dto.rows.map((row, index) => <tr key={index}>
            {dto.columns.map((column) => <td key={column.key} className={`kdos-print-align-${column.align}`}>{row[column.key] ?? "—"}</td>)}
          </tr>)}
        </tbody>
      </table>
      : <div className="kdos-print-empty">当前没有可打印数据。</div>}
  </div>;
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
    `/table-prints/manifest?resource=${encodeURIComponent(request.resource)}&rangeType=${request.rangeType}${request.search ? `&search=${encodeURIComponent(request.search)}` : ""}${request.sortField ? `&sortField=${encodeURIComponent(request.sortField)}` : ""}${request.sortOrder ? `&sortOrder=${encodeURIComponent(request.sortOrder)}` : ""}${request.filterGroup?.rules?.length ? `&filterGroup=${encodeURIComponent(JSON.stringify(request.filterGroup))}` : ""}${request.context && Object.keys(request.context).length ? `&context=${encodeURIComponent(JSON.stringify(request.context))}` : ""}${request.selectedIds?.length ? `&selectedIds=${encodeURIComponent(request.selectedIds.join(","))}` : ""}`
  );
  return { manifest, requiresConfirm: manifest.total > manifest.confirmThreshold };
}

export async function renderPrint(request: TablePrintRequest) {
  const dto = await api<TablePrintDto>("/table-prints/render", { method: "POST", body: JSON.stringify(printBody(request)) });
  if (!dto.rows.length) return { printed: false as const, reason: "empty" as const, dto };
  if (dto.meta.requestedCount != null && dto.meta.printedCount < dto.meta.requestedCount) {
    /* 越权/状态变化导致部分记录不可打印时：只提示数量，不泄漏这些记录是否存在或内容。 */
    Modal.info({
      title: "部分记录未包含在打印内容中",
      content: "部分记录因权限或状态变化未包含在打印内容中。",
      okText: "知道了"
    });
  }
  const cleanup = openPrintPreview(dto, dto.meta.orientation);
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
