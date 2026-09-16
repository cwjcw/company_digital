/**
 * KN-PRINT-001 统一打印 DTO（平台级）。
 * rows 已经过 权限 → 租户 → 数据范围 → 页面上下文 → 搜索 → FilterGroup → 排序 → 投影 → 格式化 → label 解析，
 * 前端只需要渲染，不需要理解数据库 schema。
 */
export type TablePrintOrientation = "portrait" | "landscape";

export type TablePrintColumn = {
  key: string;
  label: string;
  align: "left" | "center" | "right";
  /** 相对宽度权重（平台统一计算，避免各页面自己猜）。 */
  width: number;
};

export type TablePrintHeaderGroup = { label: string; columns: string[] };

export type TablePrintMeta = {
  resource: string;
  title: string;
  rangeType: "FILTERED" | "SELECTED";
  total: number;
  requestedCount?: number;
  printedCount: number;
  orientation: TablePrintOrientation;
  filtered: boolean;
  searched: boolean;
  printedAt: string;
  printedBy: string;
  batchSize: number;
  batches: number;
};

export type TablePrintDto = {
  title: string;
  resource: string;
  columns: TablePrintColumn[];
  headerGroups: TablePrintHeaderGroup[];
  rows: Array<Record<string, string>>;
  meta: TablePrintMeta;
};

export type TablePrintManifest = {
  resource: string;
  title: string;
  printable: boolean;
  reason?: string;
  total: number;
  columns: TablePrintColumn[];
  headerGroups: TablePrintHeaderGroup[];
  orientation: TablePrintOrientation;
  batchSize: number;
  /** 前端确认阈值（不是硬上限）。 */
  confirmThreshold: number;
  largeWarningThreshold: number;
};
