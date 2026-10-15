import type { MpsDashboardFilters } from "@kdos/contracts";
const endpoint = "/master-plan-system/dashboard";
export function mpsDashboardUrl(filters: MpsDashboardFilters, suffix = "", extra: Record<string, string> = {}) {
  const params = new URLSearchParams(extra);
  for (const [key, value] of Object.entries(filters)) if (value && (!Array.isArray(value) || value.length)) params.set(key, Array.isArray(value) ? JSON.stringify(value) : value);
  return `${endpoint}${suffix}?${params}`;
}
export function mpsMetric(value: unknown, key = "") {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return /Rate$|Progress$/.test(key) ? `${(n * 100).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}%` : n.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

// Chart-only hue sequence. The formal planning table process colors remain unchanged.
export const MPS_PROCESS_CHART_PALETTE = ["#176BBD", "#D46B08", "#238636", "#A53BBF", "#C73E45", "#008B8B", "#9A6700", "#5B4CC4", "#C23D8A", "#526777"];
export function mpsTrendTooltip(date:string,rows:Array<{name:string;order:number;quantity:number}>) {
  const ordered=[...rows].sort((a,b)=>a.order-b.order);
  return [date,`总报工数量：${mpsMetric(ordered.reduce((sum,r)=>sum+r.quantity,0))}`,...ordered.filter(r=>r.quantity!==0).map(r=>`${r.name}：${mpsMetric(r.quantity)}`)].join("\n");
}
