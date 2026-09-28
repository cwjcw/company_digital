import dayjs from "dayjs";

export const DUE_DATE_DISPLAY_FORMAT = "M月D日";

export function formatDueDate(value: unknown) {
  if (!value) return "";
  const date = dayjs(String(value));
  return date.isValid() ? date.format(DUE_DATE_DISPLAY_FORMAT) : String(value);
}

export function isDueDateLabel(label: string) {
  return label.includes("交期");
}

/** Calendar dates from APIs are displayed without timezone conversion or time-of-day noise. */
export function formatDateOnly(value: unknown) {
  if (value == null || value === "") return "";
  const raw = String(value);
  const isoDate = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T|$)/)?.[1];
  if (isoDate) return isoDate;
  const date = dayjs(raw);
  return date.isValid() ? date.format("YYYY-MM-DD") : raw;
}

export function formatDateRange(start: unknown, end: unknown) {
  const left = formatDateOnly(start);
  const right = formatDateOnly(end);
  return left && right ? `${left} → ${right}` : left || right;
}
