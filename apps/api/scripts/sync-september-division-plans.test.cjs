"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  dateValue, numberValue, reconcileRows, textValue,
} = require("./sync-september-division-plans.cjs");

function row(division, rowNumber, quantity, extra = {}) {
  return {
    orderNumber: "SO-001", itemNumber: "ITEM-001", itemName: "测试品", customer: "C001",
    customerDueDate: "2026-09-30", productionQuantity: quantity,
    remark: `来源：${division}/测试/${rowNumber}`,
    _source: { division, sheet: "测试", rowNumber },
    ...extra,
  };
}

test("基础值转换不会把空白或无缓存公式误判为 0", () => {
  assert.equal(textValue("  A001  "), "A001");
  assert.equal(numberValue(null), null);
  assert.equal(numberValue(""), null);
  assert.equal(numberValue("1,200.5"), 1200.5);
  assert.equal(dateValue(46268), "2026-09-03");
});

test("完全相同的重复行只保留一条且无需人工接受", () => {
  const result = reconcileRows([row("事业一部", 7, 10), row("事业三部", 9, 10)]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.duplicates[0].rule, "EXACT_DUPLICATE_COLLAPSED");
  assert.equal(result.conflicts.length, 0);
});

test("同来源拆分数量会合计，并进入人工接受清单", () => {
  const result = reconcileRows([row("事业一部", 7, 2), row("事业一部", 8, 208)]);
  assert.equal(result.rows[0].productionQuantity, 210);
  assert.equal(result.duplicates[0].rule, "SAME_SOURCE_SPLIT_ROWS_SUM");
  assert.equal(result.conflicts.length, 1);
});

test("同来源存在合计行时采用合计行，不重复相加", () => {
  const result = reconcileRows([row("事业三部", 5, 1100), row("事业三部", 6, 880), row("事业三部", 7, 1980)]);
  assert.equal(result.rows[0].productionQuantity, 1980);
  assert.equal(result.duplicates[0].rule, "SAME_SOURCE_TOTAL_ROW_USE_MAX");
});

test("跨来源不一致时采用信息最完整行，但必须人工接受", () => {
  const result = reconcileRows([row("事业一部", 7, 10), row("事业四部", 9, 12, { unitPrice: 2 })]);
  assert.equal(result.rows[0].productionQuantity, 12);
  assert.equal(result.duplicates[0].rule, "CROSS_SOURCE_CONFLICT_USE_RICHEST_ROW");
  assert.equal(result.conflicts.length, 1);
});
