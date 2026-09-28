import { describe, expect, it } from "vitest";
import { DUE_DATE_DISPLAY_FORMAT, formatDateOnly, formatDateRange, formatDueDate, isDueDateLabel } from "./date-format";

describe("due date display format", () => {
  it("formats business due dates as X月X日", () => {
    expect(DUE_DATE_DISPLAY_FORMAT).toBe("M月D日");
    expect(formatDueDate("2026-08-22")).toBe("8月22日");
    expect(formatDueDate(null)).toBe("");
  });

  it("only identifies fields whose label contains 交期", () => {
    expect(isDueDateLabel("客户要求交期")).toBe(true);
    expect(isDueDateLabel("评审交期")).toBe(true);
    expect(isDueDateLabel("下单日期")).toBe(false);
  });

  it("renders API date values as calendar dates without time or timezone noise", () => {
    expect(formatDateOnly("2026-09-21T00:00:00.000Z")).toBe("2026-09-21");
    expect(formatDateRange("2026-09-21T00:00:00.000Z", "2026-09-30T00:00:00.000Z")).toBe("2026-09-21 → 2026-09-30");
  });
});
