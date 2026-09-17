import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TablePermissionFieldDefinition } from "@kdos/contracts";
import { KdosAdvancedFilter, TemporalInput, serializeTemporalFilterValue, type AdvancedFilterGroup } from "./advanced-filter";

/**
 * KN-FILTER-003：datetime 高级筛选必须保留时分秒（禁止退化成 00:00:00 / YYYY-MM-DD），date 语义不变。
 */
const datetimeField: TablePermissionFieldDefinition = { key: "createdAt", label: "创建时间", type: "datetime", editable: false };
const dateField: TablePermissionFieldDefinition = { key: "productionDate", label: "生产日期", type: "date", editable: true };
const fields = [datetimeField, dateField];

/** antd DatePicker 在 jsdom 里通过输入框文本 + Enter 提交。 */
function pick(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
}

describe("KN-FILTER-003 时间字段序列化", () => {
  afterEach(cleanup);

  it("date → YYYY-MM-DD；datetime → YYYY-MM-DD HH:mm:ss（绝不丢时分秒）", async () => {
    const Dayjs = (await import("dayjs")).default;
    expect(serializeTemporalFilterValue(dateField, Dayjs("2026-09-17 15:36:25"))).toBe("2026-09-17");
    expect(serializeTemporalFilterValue(datetimeField, Dayjs("2026-09-17 15:36:25"))).toBe("2026-09-17 15:36:25");
    expect(serializeTemporalFilterValue(datetimeField, null)).toBeUndefined();
    expect(serializeTemporalFilterValue(datetimeField, undefined)).toBeUndefined();
  });

  it("datetime 选择 2026-09-17 15:36:25 后提交完整值（不是 2026-09-17、不是 00:00:00）", () => {
    const onChange = vi.fn();
    render(<TemporalInput field={datetimeField} value={undefined} onChange={onChange} />);
    pick(screen.getByRole("textbox"), "2026-09-17 15:36:25");
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0]).toBe("2026-09-17 15:36:25");
  });

  it("datetime 回显完整时间：2026-09-17 15:36:25 不显示为 00:00:00", () => {
    render(<TemporalInput field={datetimeField} value="2026-09-17 15:36:25" onChange={() => undefined} />);
    expect(screen.getByDisplayValue("2026-09-17 15:36:25")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("2026-09-17 00:00:00")).not.toBeInTheDocument();
  });

  it("date 保持自然日：回显 YYYY-MM-DD，提交仍是 YYYY-MM-DD", () => {
    const onChange = vi.fn();
    render(<TemporalInput field={dateField} value="2026-09-17" onChange={onChange} />);
    expect(screen.getByDisplayValue("2026-09-17")).toBeInTheDocument();
    pick(screen.getByRole("textbox"), "2026-09-18");
    expect(onChange.mock.calls.at(-1)![0]).toBe("2026-09-18");
  });
});

describe("KN-FILTER-003 高级筛选 datetime 单值与 between", () => {
  afterEach(cleanup);

  it("单值回显 + 重新应用后 applied FilterGroup 仍保留完整时分秒", async () => {
    const applied: AdvancedFilterGroup[] = [];
    const initial: AdvancedFilterGroup = { logic: "AND", rules: [{ field: "createdAt", operator: "gte", value: "2026-09-17 15:36:25" }] };
    const { container } = render(<KdosAdvancedFilter resource="audit-logs" fields={fields} value={initial} onApply={(group) => applied.push(group)} />);
    /* appliedCount>0 时触发器显示“N 条条件”，因此按 Badge 内的按钮定位入口。 */
    fireEvent.click(container.querySelector<HTMLElement>(".ant-badge button")!);
    /* 回显：输入框必须显示完整时间。 */
    const input = await screen.findByDisplayValue("2026-09-17 15:36:25");
    expect(input).toBeInTheDocument();
    expect(screen.queryByDisplayValue("2026-09-17 00:00:00")).not.toBeInTheDocument();
    /* 直接重新应用（不改时间）也必须原样保留。 */
    fireEvent.click(within(document.querySelector('[data-testid="advanced-filter-panel"]') as HTMLElement).getByRole("button", { name: /^筛\s*选$/ }));
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0]!.rules[0]).toMatchObject({ field: "createdAt", operator: "gte", value: "2026-09-17 15:36:25" });
  });

  it("between 的 min/max 都保留完整时间（不会退化成当天 00:00）", async () => {
    const applied: AdvancedFilterGroup[] = [];
    const { container } = render(<KdosAdvancedFilter resource="audit-logs" fields={fields} value={{ logic: "AND", rules: [] }} onApply={(group) => applied.push(group)} />);
    fireEvent.click(container.querySelector<HTMLElement>(".ant-badge button")!);
    fireEvent.click(screen.getByRole("button", { name: /添加过滤条件/ }));
    /* 选择 datetime 字段（默认操作符 eq，再切到 between）。 */
    const panel = document.querySelector('[data-testid="advanced-filter-panel"]') as HTMLElement;
    fireEvent.mouseDown(within(panel).getAllByText("选择字段")[0]!);
    fireEvent.click(await screen.findByTitle("创建时间"));
    /* 选中字段后操作符已有默认值（等于），对显示文本发起 mousedown 打开操作符下拉。 */
    fireEvent.mouseDown(within(panel).getAllByText("等于")[0]!);
    /* between 的正式 UI 文案来自 contracts 操作符 registry：选择范围。 */
    fireEvent.click(await screen.findByText("选择范围"));
    const inputs = await screen.findAllByRole("textbox");
    pick(inputs[0]!, "2026-09-17 08:30:15");
    pick(inputs[1]!, "2026-09-17 17:45:50");
    fireEvent.click(within(panel).getByRole("button", { name: /^筛\s*选$/ }));
    await waitFor(() => expect(applied).toHaveLength(1));
    expect(applied[0]!.rules[0]).toMatchObject({ field: "createdAt", operator: "between", min: "2026-09-17 08:30:15", max: "2026-09-17 17:45:50" });
  });

  it("URL/JSON 往返不截断：JSON.stringify → parse 后仍是完整 datetime", () => {
    const group: AdvancedFilterGroup = { logic: "AND", rules: [{ field: "createdAt", operator: "between", min: "2026-09-17 08:30:15", max: "2026-09-17 17:45:50" }] };
    const roundTrip = JSON.parse(JSON.stringify(group)) as AdvancedFilterGroup;
    expect(roundTrip.rules[0]!.min).toBe("2026-09-17 08:30:15");
    expect(roundTrip.rules[0]!.max).toBe("2026-09-17 17:45:50");
    expect(new URLSearchParams({ filterGroup: JSON.stringify(group) }).get("filterGroup")).toContain("17:45:50");
  });
});
