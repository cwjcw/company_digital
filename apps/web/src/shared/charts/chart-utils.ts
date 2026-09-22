export function formatChartPercent(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : `${Number(value).toFixed(1)}%`;
}

export function formatChartDuration(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const minutes = Math.max(0, Math.round(Number(value)));
  const hours = Math.floor(minutes / 60);
  const minutePart = minutes % 60;
  return minutePart ? `${hours}小时${minutePart}分钟` : `${hours}小时`;
}

export function formatChartDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return "—";
  const [, month, day] = value.slice(0, 10).split("-");
  return `${Number(month)}月${Number(day)}日`;
}
