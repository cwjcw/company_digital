import { describe, expect, it } from "vitest";
import {
  financeDashboardChannelColors,
  financeDashboardDepartmentColors,
  financeDashboardPieOption
} from "./finance-dashboard-chart-colors";

describe("财务统计大屏圆环图分类颜色", () => {
  it("为国内/外销及待分类使用固定高对比颜色，并让 legend 与扇区共用分类颜色", () => {
    const option = financeDashboardPieOption([
      { category: "外销", amount: "20.00" },
      { category: "待分类", amount: "5.00" },
      { category: "内销", amount: "75.00" }
    ], "channel");
    const series = option.series[0]!;

    expect(option.legend.data).toEqual(["外销", "待分类", "国内"]);
    expect(series.data.map(({ name, itemStyle }) => [name, itemStyle.color])).toEqual([
      ["外销", financeDashboardChannelColors["外销"]],
      ["待分类", financeDashboardChannelColors["待分类"]],
      ["国内", financeDashboardChannelColors["国内"]]
    ]);
    expect(new Set(Object.values(financeDashboardChannelColors)).size).toBe(3);
    expect(series.data.map(({ value }) => value)).toEqual([20, 5, 75]);
  });

  it("事业部颜色由分类名决定，数据顺序和暂缺分类不影响其余映射", () => {
    const rows = [
      { category: "业务四部", amount: "40" },
      { category: "业务二部", amount: "20" },
      { category: "待分类", amount: "5" },
      { category: "业务一部", amount: "10" },
      { category: "业务三部", amount: "30" }
    ];
    const option = financeDashboardPieOption(rows, "department");
    const reversed = financeDashboardPieOption([...rows].reverse(), "department");
    const colorsByName = (value: typeof option) => Object.fromEntries(value.series[0]!.data.map(({ name, itemStyle }) => [name, itemStyle.color]));

    expect(colorsByName(option)).toEqual(colorsByName(reversed));
    expect(colorsByName(option)).toEqual(financeDashboardDepartmentColors);
    expect(new Set(Object.values(financeDashboardDepartmentColors)).size).toBe(5);
    expect(option.legend.data).toEqual(rows.map(({ category }) => category));
    expect(financeDashboardPieOption(rows.filter(({ category }) => category !== "业务二部"), "department").series[0]!.data.find(({ name }) => name === "业务四部")?.itemStyle.color).toBe(financeDashboardDepartmentColors["业务四部"]);
  });

  it("未列入正式分类映射的值使用固定安全兜底色", () => {
    const option = financeDashboardPieOption([{ category: "其他", amount: 1 }], "department");
    expect(option.series[0]!.data[0]!.itemStyle.color).toBe("#4B5563");
  });
});
