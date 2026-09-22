import type { EChartsOption } from "echarts";

type ChartToken = {
  colorPrimary: string;
  colorSuccess: string;
  colorText: string;
  colorTextSecondary: string;
  colorBorderSecondary: string;
  colorBgElevated: string;
  fontFamily: string;
};

function themedAxis(axis: unknown, token: ChartToken) {
  const apply = (value: Record<string, unknown> = {}) => ({
    ...value,
    axisLine: { lineStyle: { color: token.colorBorderSecondary }, ...(value.axisLine as object) },
    axisTick: { lineStyle: { color: token.colorBorderSecondary }, ...(value.axisTick as object) },
    axisLabel: { color: token.colorTextSecondary, fontFamily: token.fontFamily, ...(value.axisLabel as object) },
    splitLine: { lineStyle: { color: token.colorBorderSecondary, type: "dashed" }, ...(value.splitLine as object) }
  });
  return Array.isArray(axis) ? axis.map((item) => apply(item as Record<string, unknown>)) : apply(axis as Record<string, unknown>);
}

/** KDOS 图表的统一基础视觉，业务模块只提供数据与业务 option。 */
export function applyKdosChartTheme(option: EChartsOption, token: ChartToken): EChartsOption {
  return {
    ...option,
    color: option.color ?? [token.colorPrimary, token.colorSuccess],
    textStyle: { color: token.colorText, fontFamily: token.fontFamily, ...(option.textStyle ?? {}) },
    tooltip: {
      backgroundColor: token.colorBgElevated,
      borderColor: token.colorBorderSecondary,
      borderWidth: 1,
      textStyle: { color: token.colorText, fontFamily: token.fontFamily },
      padding: [10, 12],
      ...(option.tooltip ?? {})
    },
    legend: {
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 8,
      textStyle: { color: token.colorTextSecondary, fontFamily: token.fontFamily },
      ...(option.legend ?? {})
    },
    grid: { left: 44, right: 24, top: 48, bottom: 42, containLabel: true, ...(option.grid ?? {}) },
    xAxis: themedAxis(option.xAxis, token) as EChartsOption["xAxis"],
    yAxis: themedAxis(option.yAxis, token) as EChartsOption["yAxis"]
  };
}
