import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TablePermissionFieldDefinition } from "@kdos/contracts";
import { DurationInput, KdosAdvancedFilter, PercentageInput, emptyFilterGroup, visibleOperators } from "./advanced-filter";

vi.mock("../api", () => ({ api: vi.fn(async () => []) }));

const text = { key: "orderNumber", label: "订单编号", type: "text", editable: true } as TablePermissionFieldDefinition;
const dictionary = { key: "processCode", label: "工序", type: "dictionary", editable: true, options: [{ value: "blank", label: "毛坯" }, { value: "bending", label: "折弯" }] } as TablePermissionFieldDefinition;
const date = { key: "productionDate", label: "生产日期", type: "date", editable: true } as TablePermissionFieldDefinition;
const number = { key: "plannedQuantity", label: "计划数量", type: "number", editable: true, format: "decimal" } as TablePermissionFieldDefinition;
const percentage = { key: "completionRate", label: "完成比例", type: "number", editable: true, format: "percentage" } as TablePermissionFieldDefinition;
const duration = { key: "runtimeMinutes", label: "运行时长", type: "number", editable: true, format: "durationMinutes" } as TablePermissionFieldDefinition;

describe("KdosAdvancedFilter", () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
  afterEach(() => cleanup());

  const open = () => fireEvent.click(screen.getByRole("button", { name: /高级筛选|条条件/ }));

  it("renders the confirmed layout with 所有/任一 and 添加过滤条件/清空/筛选", async () => {
    render(<KdosAdvancedFilter resource="mps-process-reports" fields={[text, dictionary, date, number]} value={emptyFilterGroup()} onApply={vi.fn()} />);
    open();
    expect(await screen.findByText("筛选出符合以下")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /添加过滤条件/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /清\s*空/ })).toBeInTheDocument();
    /* 面板内的“筛 选”按钮（antd 会插入空格）；触发器按钮名为“高级筛选”。 */
    expect(screen.getAllByRole("button", { name: /筛\s*选/ }).length).toBeGreaterThan(0);
  });

  it("derives operators from the field type registry (no local type list)", () => {
    expect(visibleOperators(text).map((entry) => entry.operator)).toEqual(expect.arrayContaining(["eq", "contains", "is_empty"]));
    expect(visibleOperators(dictionary).map((entry) => entry.operator)).toEqual(["eq", "neq", "in", "not_in", "is_empty", "is_not_empty"]);
    expect(visibleOperators(date).map((entry) => entry.operator)).toEqual(["eq", "neq", "gt", "lt", "gte", "lte", "between", "dynamic", "is_empty", "is_not_empty"]);
    /* 正式 UI 白名单：数值只暴露 eq/neq/gte/lte/between/is_empty/is_not_empty（隐藏 gt/lt/in/not_in）。 */
    expect(visibleOperators(number).map((entry) => entry.operator)).toEqual(["eq", "neq", "gte", "lte", "between", "is_empty", "is_not_empty"]);
    expect(visibleOperators(text).map((entry) => entry.operator)).not.toContain("starts_with");
    expect(visibleOperators(percentage).map((entry) => entry.operator)).toContain("between");
    expect(visibleOperators(duration).map((entry) => entry.operator)).toContain("between");
  });

  it("时长字段按小时+分钟输入并转换为分钟（10小时30分钟 → 630）", async () => {
    const onChange = vi.fn();
    render(<DurationInput value={undefined} onChange={onChange} />);
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    const hours = inputs[0]!;
    const minutes = inputs[1]!;
    fireEvent.change(hours, { target: { value: "10" } });
    expect(onChange).toHaveBeenLastCalledWith(600);
    onChange.mockClear();
    fireEvent.change(minutes, { target: { value: "30" } });
    expect(onChange).toHaveBeenLastCalledWith(30);
  });

  it("时长字段回显已存分钟值（630 → 10 小时 30 分钟）", () => {
    render(<DurationInput value={630} onChange={vi.fn()} />);
    const inputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(inputs[0]!.value).toBe("10");
    expect(inputs[1]!.value).toBe("30");
  });

  it("百分比字段界面显示 0..100，提交换算为存储值（80% → 0.8）", () => {
    const onChange = vi.fn();
    render(<PercentageInput value={undefined} onChange={onChange} />);
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "80" } });
    expect(onChange).toHaveBeenLastCalledWith(0.8);
  });

  it("百分比字段回显存储值 0.6 为 60%", () => {
    render(<PercentageInput value={0.6} onChange={vi.fn()} />);
    expect(Number((screen.getByRole("spinbutton") as HTMLInputElement).value)).toBe(60);
  });

  it("keeps draft separate from applied state and only applies on 筛选", async () => {
    const onApply = vi.fn();
    render(<KdosAdvancedFilter resource="mps-process-reports" fields={[text, dictionary]} value={emptyFilterGroup()} onApply={onApply} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /添加过滤条件/ }));
    /* 选择字段：默认使用该字段第一个合法操作符并使用字典候选（不发正式列表请求）。 */
    fireEvent.mouseDown(screen.getAllByText("选择字段")[0]!);
    fireEvent.click(await screen.findByTitle("工序"));
    expect(onApply).not.toHaveBeenCalled();
    const applyButtons = screen.getAllByRole("button", { name: /筛\s*选/ });
    fireEvent.click(applyButtons.at(-1)!);
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ logic: "AND", rules: [expect.objectContaining({ field: "processCode", operator: "eq" })] }));
  });

  it("clears incompatible operator and operand when the field changes", async () => {
    const onApply = vi.fn();
    render(<KdosAdvancedFilter resource="mps-process-reports" fields={[text, date]} value={{ logic: "AND", rules: [{ field: "orderNumber", operator: "contains", value: "ABC" }] }} onApply={onApply} />);
    open();
    fireEvent.mouseDown(screen.getByTitle("订单编号"));
    fireEvent.click(await screen.findByTitle("生产日期"));
    fireEvent.click(screen.getAllByRole("button", { name: /筛\s*选/ }).at(-1)!);
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ logic: "AND", rules: [expect.objectContaining({ field: "productionDate", operator: "eq", value: undefined })] }));
    const applied = onApply.mock.calls.at(-1)![0];
    expect(applied.rules[0].value).toBeUndefined();
  });

  it("clears draft and applied state on 清空", async () => {
    const onApply = vi.fn();
    render(<KdosAdvancedFilter resource="mps-process-reports" fields={[text]} value={{ logic: "OR", rules: [{ field: "orderNumber", operator: "eq", value: "SO-1" }] }} onApply={onApply} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /清\s*空/ }));
    expect(onApply).toHaveBeenCalledWith({ logic: "AND", rules: [] });
  });
});
