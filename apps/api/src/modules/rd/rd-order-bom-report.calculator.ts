/** BOM report date parsing is deliberately local to this report. The E10 value
 * 1900-01-01 is a real stored value and must not be erased by a shared parser. */
export type E10BomItem = { item_id: string; item_code: string; item_name?: string | null };
export type E10BomHead = { bom_id: string; item_id: string; item_code?: string | null; version_times: string | null; approve_status: string | null; approved_at: string | null; created_at?: string | null; modified_at?: string | null; last_modified_at?: string | null };
export type E10BomBundle = { items: E10BomItem[]; sourceSnapshotAt: string };
export type LocalBomHead = E10BomHead;
export type BomReportState = { status: "HAS_BOM" | "NO_BOM" | null; approvalDate: string | null };
const normalizeItemId = (value: string) => value.trim().toLowerCase();

export function dateOnly(value: unknown): string | null {
  if (value == null || value === "") return null;
  const match = String(value).trim().replace("T", " ").match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}
export function dateTime(value: unknown): string | null {
  if (value == null || value === "") return null;
  const text = String(value).trim().replace("T", " ");
  if (!/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(text)) return null;
  return text.length === 10 ? `${text} 00:00:00` : text.length === 16 ? `${text}:00` : text;
}
export function reliableApprovalDate(value: unknown): string | null {
  const parsed = dateTime(value);
  // E10 uses these sentinel values for an unset approval timestamp. Keep them
  // in the source index but do not claim a historical approval day.
  if (!parsed || /^(1900-01-01|1900-01-02)(?: |$)/.test(parsed)) return null;
  return parsed;
}
export function naturalDayDifference(from: unknown, to: unknown): number | null {
  const start = dateOnly(from), end = dateOnly(to);
  if (!start || !end) return null;
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(days) ? Math.max(0, Math.floor(days)) : null;
}

/** The only matching condition is exact E10 ITEM identity plus any approved BOM head. */
export function matchE10Bom(itemCode: string, snapshot: E10BomBundle, approvedHeads: LocalBomHead[]): BomReportState {
  return createBomMatcher(snapshot, approvedHeads)(itemCode);
}
export function createBomMatcher(snapshot: E10BomBundle, approvedHeads: LocalBomHead[]) {
  const itemIdsByCode = new Map<string, Set<string>>();
  for (const row of snapshot.items) {
    const ids = itemIdsByCode.get(row.item_code) ?? new Set<string>(); ids.add(normalizeItemId(row.item_id)); itemIdsByCode.set(row.item_code, ids);
  }
  const headsByItem = new Map<string, LocalBomHead[]>();
  for (const head of approvedHeads) if (head.approve_status?.trim().toUpperCase() === "Y") {
    const itemId = normalizeItemId(head.item_id);
    const rows = headsByItem.get(itemId) ?? []; rows.push(head); headsByItem.set(itemId, rows);
  }
  return (itemCode: string): BomReportState => {
  const itemIds = itemIdsByCode.get(itemCode);
  if (!itemIds?.size) return { status: null, approvalDate: null };
  const heads = [...itemIds].flatMap(id => headsByItem.get(id) ?? []);
  if (!heads.length) return { status: "NO_BOM", approvalDate: null };
  const dates = heads.map(row => reliableApprovalDate(row.approved_at)).filter((value): value is string => value != null).sort();
  return { status: "HAS_BOM", approvalDate: dates[0] ?? null };
  };
}

export function waitingDays(orderDate: unknown, approvalDate: unknown, today: string, status: BomReportState["status"]): { bom: number | null; current: number | null } {
  if (status == null) return { bom: null, current: null };
  if (status === "NO_BOM") return { bom: null, current: naturalDayDifference(orderDate, today) };
  if (!dateOnly(orderDate) || !dateOnly(approvalDate)) return { bom: null, current: null };
  return { bom: naturalDayDifference(orderDate, approvalDate), current: null };
}

export function orderBomStatus(rows: Array<{ bomStatus: string | null }>): string | null {
  if (!rows.length || rows.every(row => row.bomStatus == null)) return null;
  if (rows.some(row => row.bomStatus === "NO_BOM")) return "未全部完成";
  if (rows.every(row => row.bomStatus === "HAS_BOM")) return "全部完成";
  return "待核实";
}
