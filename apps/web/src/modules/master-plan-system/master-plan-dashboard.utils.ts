import type { MpsDashboardFilters } from "@kdos/contracts";
const endpoint = "/master-plan-system/dashboard";
export function mpsDashboardUrl(filters: MpsDashboardFilters, suffix = "", extra: Record<string, string> = {}) {
  const params = new URLSearchParams(extra);
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return `${endpoint}${suffix}?${params}`;
}
export function mpsMetric(value: unknown, key = "") {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return /Rate$|Progress$/.test(key) ? `${(n * 100).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}%` : n.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}
