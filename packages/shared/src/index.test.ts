import { describe, expect, it } from "vitest";
import { dictionarySeeds, monthlyPlanColumns } from "./index";

describe("monthly plan column definitions", () => {
  it("uses four standard columns for the requested process groups", () => {
    for (const group of ["前道配件", "机加", "焊接/点焊", "研磨", "木作", "油漆", "亚克力", "后道包材&配件"]) {
      expect(monthlyPlanColumns.filter((column) => column.group === group).map((column) => column.header))
        .toEqual(["所需天数", "交期", "状态", "异常"]);
    }
  });

  it("uses the renamed fields and outsourcing order", () => {
    expect(monthlyPlanColumns.find((column) => column.key === "productionQuantity")?.header).toBe("订单需求数量");
    expect(monthlyPlanColumns.find((column) => column.key === "handlingMethod")?.header).toBe("制作方式");
    expect(monthlyPlanColumns.filter((column) => column.group === "外协相关").map((column) => column.header))
      .toEqual(["外协方式", "外协供应商", "外协交期", "外协实际交期"]);
  });

  it("uses the new production and outsourcing dictionaries", () => {
    expect(dictionarySeeds.handlingMethod).toEqual(["自制", "中心外购", "外协", "自制+外协"]);
    expect(dictionarySeeds.outsourcingMethod).toEqual(["成品", "毛坯", "部件"]);
  });
});
