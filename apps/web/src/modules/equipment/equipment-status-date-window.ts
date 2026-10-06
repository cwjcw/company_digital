import dayjs, { type Dayjs } from "dayjs";
import { EQUIPMENT_STATUS_REPORT_DATE_WINDOW_DAYS } from "@kdos/contracts";

export function equipmentStatusReportDateDisabled(date: Dayjs, today: Dayjs = dayjs()) {
  const candidate = date.startOf("day");
  const current = today.startOf("day");
  return candidate.isAfter(current) || candidate.isBefore(current.subtract(EQUIPMENT_STATUS_REPORT_DATE_WINDOW_DAYS - 1, "day"));
}
