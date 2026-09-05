import { describe, expect, it } from "vitest";
import { dictionarySeeds, legacyMonthlyPlanColumns, monthlyPlanColumns } from "./index";

const ordinaryStart = [
  "序号", "事业部", "订单号", "下单日期", "客户要求交期", "产前评审交期", "异常后二次交期", "异常交期交货方式", "装柜日期",
  "新旧款", "品号", "关联信息", "品名", "简图", "产品属性", "表面性质", "特别项", "订单需求数量", "历史入库数据",
  "当天入库数", "订单欠数", "制作方式"
];
const outsourcing = ["供应商", "外协方式", "外协交期", "外协实际交期", "所需周期", "交期", "状态", "异常"];
const processGroups = ["图纸&BOM", "五金主材", "木作主材", "机加", "焊接", "毛坯", "电镀", "亚克力", "烤漆", "组装&包装", "包装打托"];
const ordinaryEnd = ["对应计划页数", "订单异常信息", "验货", "验货数量", "备注", "订单周数", "月", "单价", "订单入库金额", "订单欠数金额", "客户"];
const expectedQualifiedHeaders = [
  ...ordinaryStart,
  ...outsourcing.map((header) => `外协相关.${header}`),
  ...processGroups.flatMap((group) => ["所需周期", "交期", "状态", "异常"].map((header) => `${group}.${header}`)),
  ...ordinaryEnd
];

describe("monthly plan column definitions", () => {
  it("places the department-backed division field immediately after sequence", () => {
    expect(monthlyPlanColumns.map((column) => column.group ? `${column.group}.${column.header}` : column.header))
      .toEqual(expectedQualifiedHeaders);
    expect(monthlyPlanColumns).toHaveLength(85);
    expect(monthlyPlanColumns[1]).toMatchObject({ key: "responsibleOrgId", header: "事业部", kind: "department" });
  });

  it("keeps the legacy 97-column contract only for historical compatibility", () => {
    expect(legacyMonthlyPlanColumns).toHaveLength(97);
  });

  it("uses the requested production and outsourcing dictionaries", () => {
    expect(dictionarySeeds.handlingMethod).toEqual(["自制", "中心外购", "外协", "自制+外协"]);
    expect(dictionarySeeds.outsourcingMethod).toEqual(["成品", "毛坯", "部件"]);
  });
});
