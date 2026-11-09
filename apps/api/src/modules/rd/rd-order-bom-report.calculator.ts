export type E10BomBundle = {
  items: Array<{ item_id: string; item_code: string; item_name?: string | null }>;
  plants: Array<{ item_id: string; owner_org_id: string | null; item_property: string | null; item_routing_control: number | string | null }>;
  boms: Array<{ bom_id: string; item_id: string; owner_org_id: string | null; version_times: string | null; approve_status: string | null; approved_at: string | null; detail_approve_status: string | null; effective_date: string | null; expiry_date: string | null }>;
  sourceSnapshotAt: string;
};
export type BomReportState = { status: "HAS_BOM" | "NO_BOM" | "NOT_REQUIRED" | "MATCH_ISSUE"; approvalDate: string | null; matchIssue: string | null };

const dateOnly = (value: unknown): string | null => {
  if (value == null || value === "") return null;
  const text = String(value).trim().replace("T", " ");
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match || match[1] === "1900-01-01" || match[1] === "1900-01-02") return null;
  return match[1];
};
const dateTime = (value: unknown): string | null => {
  if (value == null || value === '') return null;
  const text = String(value).trim().replace('T',' ');
  if (!/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(text) || /^(1900-01-01|1900-01-02)/.test(text)) return null;
  return text.length === 10 ? `${text} 00:00:00` : text.length === 16 ? `${text}:00` : text;
};
export function naturalDayDifference(from: unknown, to: unknown): number | null {
  const start = dateOnly(from), end = dateOnly(to);
  if (!start || !end) return null;
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(days) ? Math.max(0, Math.floor(days)) : null;
}

export function matchE10Bom(itemCode: string, snapshot: E10BomBundle, today: string): BomReportState {
  const items = snapshot.items.filter(row => row.item_code === itemCode);
  if (items.length !== 1) return { status: "MATCH_ISSUE", approvalDate: null, matchIssue: items.length ? "E10品号主数据不唯一" : "E10未找到该品号" };
  const itemId = items[0].item_id;
  const plants = snapshot.plants.filter(row => row.item_id === itemId);
  if (plants.length !== 1) return { status: "MATCH_ISSUE", approvalDate: null, matchIssue: plants.length ? "E10存在多个生产组织，无法确定适用组织" : "E10缺少生产组织资料" };
  const plant = plants[0];
  if (String(plant.item_property ?? "").trim().toUpperCase() === "P" && Number(plant.item_routing_control) === 0) {
    return { status: "NOT_REQUIRED", approvalDate: null, matchIssue: null };
  }
  const property = String(plant.item_property ?? "").trim().toUpperCase();
  const routingControl = Number(plant.item_routing_control);
  if (property !== "M" || ![1, 2].includes(routingControl)) {
    return { status: "MATCH_ISSUE", approvalDate: null, matchIssue: "E10物料属性/工艺控制组合不在已确认的需BOM规则内" };
  }
  if (!plant.owner_org_id) return { status: "MATCH_ISSUE", approvalDate: null, matchIssue: "E10生产组织标识为空" };
  const candidates = snapshot.boms.filter(row => row.item_id === itemId && row.owner_org_id === plant.owner_org_id);
  const eligible = candidates.filter(row => String(row.approve_status ?? "").trim().toUpperCase() === "Y"
    && String(row.detail_approve_status ?? "").trim().toUpperCase() === "Y"
    && Boolean(dateOnly(row.effective_date)) && String(row.effective_date).slice(0, 10) <= today
    && (!dateOnly(row.expiry_date) || String(row.expiry_date).slice(0, 10) >= today));
  const validHeads = [...new Map(eligible.map(row => [row.bom_id, row])).values()];
  if (validHeads.length > 1) return { status: "MATCH_ISSUE", approvalDate: null, matchIssue: "同一品号及组织存在多个当前有效审核BOM版本" };
  if (!validHeads.length) return { status: "NO_BOM", approvalDate: null, matchIssue: null };
  const approval = dateTime(validHeads[0].approved_at);
  return { status: "HAS_BOM", approvalDate: approval, matchIssue: approval ? null : "BOM已审核，但审核日期缺失或为无效占位值" };
}

export function waitingDays(orderDate: unknown, approvalDate: unknown, today: string, status: BomReportState["status"]): { bom: number | null; current: number | null } {
  if (status === "NOT_REQUIRED" || status === "MATCH_ISSUE") return { bom: null, current: null };
  if (status === "NO_BOM") return { bom: null, current: naturalDayDifference(orderDate, today) };
  if (!dateOnly(orderDate) || !dateOnly(approvalDate)) return { bom: null, current: null };
  return { bom: naturalDayDifference(orderDate, approvalDate), current: null };
}

export function orderBomStatus(rows: Array<{ bomStatus: string }>): string {
  const states = rows.map(row => row.bomStatus);
  if (!states.length || states.every(value => value === "NOT_REQUIRED")) return "无需BOM";
  if (states.includes("MATCH_ISSUE")) return "待确认";
  const required = states.filter(value => value !== "NOT_REQUIRED");
  const complete = required.filter(value => value === "HAS_BOM").length;
  return complete === required.length ? "全部完成" : complete > 0 ? "部分完成" : "尚未完成";
}
