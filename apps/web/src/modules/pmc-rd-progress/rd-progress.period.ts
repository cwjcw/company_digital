import dayjs from "dayjs";

export type ReportPeriod = { mode: "day" | "month" | "year" | "custom"; value: string };
export const periodOptions = [{ value: "day", label: "按日" }, { value: "month", label: "按月" }, { value: "year", label: "按年" }, { value: "custom", label: "自定义" }];

/** Capture the Shanghai calendar date first. Picker values are calendar strings, never UTC instants. */
export function defaultPeriod(now = new Date()): ReportPeriod {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(entry => entry.type === type)!.value;
  return { mode: "day", value: dayjs(`${part("year")}-${part("month")}-${part("day")}`).subtract(1, "day").format("YYYY-MM-DD") };
}
const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && dayjs(value).isValid() && dayjs(value).format("YYYY-MM-DD") === value;
export function periodBounds(period: ReportPeriod): { orderDateFrom: string; orderDateTo: string } | undefined {
  const { mode, value } = period;
  if (mode === "day" && validDay(value)) return { orderDateFrom: value, orderDateTo: value };
  if (mode === "month" && /^\d{4}-\d{2}$/.test(value) && validDay(`${value}-01`)) return { orderDateFrom: `${value}-01`, orderDateTo: dayjs(`${value}-01`).endOf("month").format("YYYY-MM-DD") };
  if (mode === "year" && /^\d{4}$/.test(value) && validDay(`${value}-01-01`)) return { orderDateFrom: `${value}-01-01`, orderDateTo: `${value}-12-31` };
  if (mode === "custom") {
    const [from, to, extra] = value.split(",");
    if (!extra && from && to && validDay(from) && validDay(to) && from <= to) return { orderDateFrom: from, orderDateTo: to };
  }
  return undefined;
}
export function readReportPeriod(params: URLSearchParams, now = new Date()): ReportPeriod {
  const period = { mode: params.get("period"), value: params.get("periodValue") ?? "" } as ReportPeriod;
  if (periodBounds(period)) return period;
  // Restore legacy Phase 5 links without reinterpreting the business date field.
  if (!params.has("period")) {
    const from = params.get("orderDateFrom"), to = params.get("orderDateTo");
    if (from && to) {
      const legacy: ReportPeriod = { mode: from === to ? "day" : "custom", value: from === to ? from : `${from},${to}` };
      if (periodBounds(legacy)) return legacy;
    }
  }
  return defaultPeriod(now);
}
export function periodParams(period: ReportPeriod) {
  return { period: period.mode, periodValue: period.value, ...periodBounds(period)! };
}
export function periodForMode(mode: ReportPeriod["mode"], previous: ReportPeriod): ReportPeriod {
  const date = dayjs(periodBounds(previous)!.orderDateFrom);
  return { mode, value: mode === "custom" ? `${date.startOf("month").format("YYYY-MM-DD")},${date.format("YYYY-MM-DD")}` : date.format(mode === "day" ? "YYYY-MM-DD" : mode === "month" ? "YYYY-MM" : "YYYY") };
}
