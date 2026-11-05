type FinanceDashboardRow = { category: string; amount: string | number | null };

/** 固定采用色觉友好且在白色图表背景上清晰可辨的分类色。 */
export const financeDashboardChannelColors: Readonly<Record<string, string>> = {
  国内: "#0072B2",
  外销: "#D55E00",
  待分类: "#CC79A7"
};

export const financeDashboardDepartmentColors: Readonly<Record<string, string>> = {
  业务一部: "#0072B2",
  业务二部: "#E69F00",
  业务三部: "#009E73",
  业务四部: "#CC79A7",
  待分类: "#D55E00"
};

const unlistedCategoryColor = "#4B5563";

/**
 * Donut 图的 legend、扇区和 tooltip 标识都从同一数据项颜色读取。
 * 分类名映射保证数据排序、筛选和缺少某分类时颜色不发生位移。
 */
export function financeDashboardPieOption(
  rows: FinanceDashboardRow[] | undefined,
  dimension: "channel" | "department"
) {
  const colors = dimension === "channel" ? financeDashboardChannelColors : financeDashboardDepartmentColors;
  const data = (rows ?? []).map((row) => {
    const name = dimension === "channel" && row.category === "内销" ? "国内" : row.category;
    return {
      name,
      value: Number(row.amount),
      itemStyle: { color: colors[name] ?? unlistedCategoryColor }
    };
  });

  return {
    tooltip: { trigger: "item" as const },
    legend: { data: data.map(({ name }) => name) },
    series: [{ type: "pie" as const, radius: ["35%", "65%"], data }]
  };
}
