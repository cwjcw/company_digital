import { SelectQueryBuilder } from "typeorm";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { applyTypedFilterToQueryBuilder } from "./typeorm-filter";

/**
 * KN-FILTER-001 平台 QueryBuilder 适配测试：TypeORM 模块必须与原生 SQL 共用同一编译器，
 * 只把占位符换成 `:filter_n`，不得复制第二套筛选逻辑。
 */
function builder() {
  const applied: Array<{ clause: string; params: Record<string, unknown> }> = [];
  const query = {
    andWhere: (clause: string, params: Record<string, unknown>) => { applied.push({ clause, params }); return query; }
  } as unknown as SelectQueryBuilder<any>;
  return { query, applied };
}

const salesOrderColumns = {
  sourceSystem: "source_system", sourceDatabase: "source_database", sourceKey: "source_key",
  documentDate: "document_date", orderDate: "order_date", orderNumber: "order_number", documentName: "document_name",
  closeStatus: "close_status", customerCode: "customer_code", shipToCustomerCode: "ship_to_customer_code",
  invoiceCustomerCode: "invoice_customer_code", employeeName: "employee_name", taxIncluded: "tax_included",
  currencyCode: "currency_code", exchangeRate: "exchange_rate", sequenceNumber: "sequence_number",
  itemNumber: "item_number", itemName: "item_name", specification: "specification", unitName: "unit_name",
  businessQuantity: "business_quantity", priceQuantity: "price_quantity", price: "price", rmbPrice: "rmb_price",
  rmbTaxIncludedAmount: "rmb_tax_included_amount", deliveredBusinessQuantity: "delivered_business_quantity",
  plannedDeliveryDate: "planned_delivery_date", taxRate: "tax_rate", amountExcludingTaxBc: "amount_excluding_tax_bc",
  taxBc: "tax_bc", creatorUserId: "creator_user_id", creatorUserName: "creator_user_name", adminUnitName: "admin_unit_name",
  ownerDepartment: "owner_department", ownerEmployee: "owner_employee", ownerDivision: "owner_division",
  reviewDueDate: "review_due_date", quantity: "quantity", remark: "remark",
  createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
};

describe("平台 QueryBuilder 类型化筛选", () => {
  it("把 filterGroup 编译成命名参数，且不拼接用户输入", () => {
    const { query, applied } = builder();
    applyTypedFilterToQueryBuilder({
      builder: query, alias: "row", fields: tablePermissionFieldsFor("sales-orders"), columns: salesOrderColumns,
      filterGroup: { logic: "AND", rules: [{ field: "orderNumber", operator: "contains", value: "%' OR 1=1--" }] },
      canFilterField: () => true
    });
    expect(applied).toHaveLength(1);
    expect(applied[0].clause).toContain("row.order_number");
    expect(applied[0].clause).not.toContain("OR 1=1");
    expect(Object.values(applied[0].params)).toEqual(["%%' OR 1=1--%"]);
  });

  it("ANY(OR) 只影响筛选条件本身，不改变租户/范围谓词", () => {
    const { query, applied } = builder();
    applyTypedFilterToQueryBuilder({
      builder: query, alias: "row", fields: tablePermissionFieldsFor("sales-orders"), columns: salesOrderColumns,
      filterGroup: { logic: "OR", rules: [{ field: "customerCode", operator: "eq", value: "C1" }, { field: "itemNumber", operator: "eq", value: "I1" }] },
      canFilterField: () => true
    });
    const clause = applied[0].clause;
    expect(clause.startsWith("(")).toBe(true);
    expect(clause).toContain(" OR ");
    expect(clause).not.toContain("tenant");
  });

  it("字段读权限缺失时拒绝筛选（防隐藏字段侧信道）", () => {
    const { query } = builder();
    expect(() => applyTypedFilterToQueryBuilder({
      builder: query, alias: "row", fields: tablePermissionFieldsFor("sales-orders"), columns: salesOrderColumns,
      filterGroup: { logic: "AND", rules: [{ field: "price", operator: "gte", value: 100 }] },
      canFilterField: (key) => key !== "price"
    })).toThrow(/不能按该字段筛选/);
  });

  it("未知字段与不匹配操作符都被拒绝", () => {
    const { query } = builder();
    expect(() => applyTypedFilterToQueryBuilder({
      builder: query, alias: "row", fields: tablePermissionFieldsFor("sales-orders"), columns: salesOrderColumns,
      filterGroup: { logic: "AND", rules: [{ field: "notExist", operator: "eq", value: 1 }] }, canFilterField: () => true
    })).toThrow(/不允许筛选/);
    expect(() => applyTypedFilterToQueryBuilder({
      builder: query, alias: "row", fields: tablePermissionFieldsFor("sales-orders"), columns: salesOrderColumns,
      filterGroup: { logic: "AND", rules: [{ field: "orderNumber", operator: "between", min: 1, max: 2 }] }, canFilterField: () => true
    })).toThrow(/不支持该筛选方式/);
  });

  it("空 filterGroup 不产生任何条件", () => {
    const { query, applied } = builder();
    applyTypedFilterToQueryBuilder({
      builder: query, alias: "row", fields: tablePermissionFieldsFor("sales-orders"), columns: salesOrderColumns,
      filterGroup: { logic: "AND", rules: [] }, canFilterField: () => true
    });
    expect(applied).toHaveLength(0);
  });
});

describe("平台字典选项解析（静态 options）", () => {
  const { SqlFilterCompiler } = require("./sql-filter.compiler");
  const field = { key: "status", label: "状态", type: "dictionary", editable: true, options: [{ value: "NORMAL", label: "正常" }, { value: "VOID", label: "作废" }] };
  const compile = (value: string) => {
    const params: unknown[] = [];
    const clause = new SqlFilterCompiler([field], { status: "record.status" }, () => true, (column: string) => column).compile({ logic: "AND", rules: [{ field: "status", operator: "eq", value }] }, params);
    return { clause, params };
  };
  it("输入中文 label 会解析成稳定 value", () => {
    expect(compile("正常").params).toEqual([["NORMAL"]]);
    expect(compile("NORMAL").params).toEqual([["NORMAL"]]);
  });
  it("未命中的输入回落为原值（结果为空而不是报错）", () => {
    expect(compile("不存在").params).toEqual([["不存在"]]);
  });
});
