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
