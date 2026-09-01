import test from "node:test";
import assert from "node:assert/strict";
import { mapOrder, prepareSql, useReadCommitted } from "./tplus-reader.mjs";

test("prepareSql fixes the begin date and enables diagnostics", () => {
  const source = "DECLARE @BeginDate date = NULL;\nDECLARE @ShowDiagnostics bit = 0;";
  const result = prepareSql(source, "2026-01-01");
  assert.match(result, /@BeginDate date = '20260101'/);
  assert.match(result, /@ShowDiagnostics bit = 1/);
});

test("production source reads explicitly use READ COMMITTED", () => {
  const result = useReadCommitted("SELECT 1;");
  assert.match(result, /^SET TRANSACTION ISOLATION LEVEL READ COMMITTED;/);
  assert.doesNotMatch(result, /READ UNCOMMITTED/i);
});

test("mapOrder maps the Chinese report columns to the API contract", () => {
  assert.deepEqual(mapOrder({
    源数据库: "UFTData741219_000012", 客户代码: "C001", "业务员（姓名）": "张三", 订单号: "SO1",
    下单日期: new Date("2026-01-02T00:00:00.000Z"), 客户要求交期: null,
    产前评审交期: new Date("2026-02-01T00:00:00.000Z"), "订单金额（人民币，元）": 100.25, 订单总数量: 12
  }), {
    sourceDatabase: "UFTData741219_000012", customerCode: "C001", salesperson: "张三", orderNumber: "SO1",
    orderDate: "2026-01-02", customerRequiredDate: null, reviewDueDate: "2026-02-01", orderAmount: "100.25", totalQuantity: "12"
  });
});
