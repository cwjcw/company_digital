/** KN-PRINT-001: layout widths are millimetres; legacy column.width remains a relative weight. */
export type PrintOrientation = "portrait" | "landscape";
export type PrintPaperSize = "A4" | "A3";
export type PrintWidthMode = "fit" | "custom";
export type PrintPreferences = {
  version: 1;
  columnKeys: string[];
  /** Missing width means automatic allocation. Never store CSS percentages here. */
  widths: Record<string, number>;
  paperSize: PrintPaperSize;
  orientation: PrintOrientation;
  widthMode: PrintWidthMode;
};
export const PRINT_MIN_COLUMN_MM = 8;
export const PRINT_MAX_COLUMN_MM = 1000;
export const PRINT_MARGIN_MM = 10;
export const PRINT_PX_PER_MM = 96 / 25.4;

export function printPaperDimensions(paper: PrintPaperSize, orientation: PrintOrientation) {
  const [short, long] = paper === "A3" ? [297, 420] : [210, 297];
  return { width: orientation === "landscape" ? long : short, height: orientation === "landscape" ? short : long };
}

export function printPreferenceKey(tenant: string, user: string, resource: string, viewKey = "") {
  return `kdos-print-v1:${[tenant, user, resource, viewKey].map(encodeURIComponent).join(":")}`;
}

export function normalizePrintPreferences(value: unknown, allowedKeys: string[], defaults: PrintPreferences): PrintPreferences {
  if (!value || typeof value !== "object" || (value as PrintPreferences).version !== 1) return defaults;
  const saved = value as Partial<PrintPreferences>;
  const allowed = new Set(allowedKeys);
  const keys = Array.isArray(saved.columnKeys) ? [...new Set(saved.columnKeys.filter(key => typeof key === "string" && allowed.has(key)))] : defaults.columnKeys;
  const widths: Record<string, number> = {};
  if (saved.widths && typeof saved.widths === "object") for (const [key, width] of Object.entries(saved.widths)) {
    if (allowed.has(key) && typeof width === "number" && Number.isFinite(width) && width >= PRINT_MIN_COLUMN_MM && width <= PRINT_MAX_COLUMN_MM) widths[key] = width;
  }
  return { version: 1, columnKeys: keys, widths,
    paperSize: saved.paperSize === "A3" ? "A3" : "A4",
    orientation: saved.orientation === "landscape" ? "landscape" : "portrait",
    widthMode: saved.widthMode === "custom" ? "custom" : "fit" };
}

export function computePrintLayout(columns: Array<{ key: string; width: number }>, preferences: PrintPreferences) {
  const paper = printPaperDimensions(preferences.paperSize, preferences.orientation);
  const availableWidth = paper.width - 2 * PRINT_MARGIN_MM;
  const byKey = new Map(columns.map(column => [column.key, column]));
  const keys = preferences.columnKeys.filter(key => byKey.has(key));
  const desired = keys.map(key => preferences.widths[key] ?? Math.max(PRINT_MIN_COLUMN_MM, byKey.get(key)!.width * 2));
  let widths = [...desired];
  if (preferences.widthMode === "fit" && keys.length * PRINT_MIN_COLUMN_MM <= availableWidth) {
    // Allocate the minimum first, then distribute the remaining space by relative weight.
    let remaining = availableWidth;
    const pending = new Set(keys.map((_, i) => i));
    while (pending.size) {
      const weight = [...pending].reduce((sum, i) => sum + desired[i]!, 0);
      const small = [...pending].filter(i => remaining * desired[i]! / weight < PRINT_MIN_COLUMN_MM);
      if (!small.length) { for (const i of pending) widths[i] = remaining * desired[i]! / weight; break; }
      for (const i of small) { widths[i] = PRINT_MIN_COLUMN_MM; remaining -= PRINT_MIN_COLUMN_MM; pending.delete(i); }
    }
  }
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  return { paper, availableWidth, widths: Object.fromEntries(keys.map((key, i) => [key, widths[i]!])), totalWidth,
    overflow: totalWidth > availableWidth + 0.01 };
}

/** Rebuild contiguous groups after selection/reordering, including ungrouped columns. */
export function orderedPrintHeaderGroups(keys: string[], groups: Array<{ label: string; columns: string[] }>) {
  if (!groups.length) return [];
  const result: Array<{ label: string; columns: string[] }> = [];
  for (const key of keys) {
    const label = groups.find(group => group.columns.includes(key))?.label ?? "";
    const last = result[result.length - 1];
    if (last && last.label === label) last.columns.push(key);
    else result.push({ label, columns: [key] });
  }
  return result;
}
