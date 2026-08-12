const path = require("node:path");
const ExcelJS = require("exceljs");
const { dictionarySeeds, excelMonthlyPlanColumns } = require("../../../packages/shared/dist/index.js");

const outputDir = path.resolve(__dirname, "../../../docs");
const firstMonthlyRow = 3;
const firstSalesRow = 4;
const rowCount = 5000;
const configuredSuppliers = (() => {
  try { return JSON.parse(process.env.TEMPLATE_SUPPLIERS_JSON || "[]"); }
  catch { throw new Error("TEMPLATE_SUPPLIERS_JSON 必须是供应商名称 JSON 数组"); }
})();
const border = {
  top: { style: "thin", color: { argb: "FFB8C4CE" } }, bottom: { style: "thin", color: { argb: "FFB8C4CE" } },
  left: { style: "thin", color: { argb: "FFB8C4CE" } }, right: { style: "thin", color: { argb: "FFB8C4CE" } }
};

function quotedSheet(name) { return `'${name.replaceAll("'", "''")}'`; }
function listFormula(sheet, column, count) { return `${quotedSheet(sheet.name)}!$${column}$2:$${column}$${count + 1}`; }
function addDictionarySheet(workbook, suppliers = []) {
  const sheet = workbook.addWorksheet("模板字典", { state: "hidden" });
  const entries = { ...dictionarySeeds, supplier: suppliers.length ? suppliers : ["请替换为系统中启用的供应商名称"] };
  Object.entries(entries).forEach(([code, values], index) => {
    const column = sheet.getColumn(index + 1);
    column.values = [code, ...values];
    column.width = 24;
  });
  return { sheet, entries };
}
function headerStyle(cell, dark = true) {
  cell.font = { name: "微软雅黑", size: 10, bold: true, color: { argb: dark ? "FFFFFFFF" : "FF1F2937" } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: dark ? "FF1F4B70" : "FFDCE6F1" } };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.border = border;
}
function addValidation(sheet, address, validation) {
  sheet.dataValidations.add(address, { allowBlank: true, showErrorMessage: true, errorStyle: "stop", ...validation });
}

async function monthlyTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "凯南计划中心";
  const sheet = workbook.addWorksheet("月度计划", { views: [{ state: "frozen", xSplit: 12, ySplit: 2 }] });
  sheet.addRow(excelMonthlyPlanColumns.map((column) => column.group ?? column.header));
  sheet.addRow(excelMonthlyPlanColumns.map((column) => column.group ? column.header : ""));
  let start = 1;
  for (let column = 2; column <= excelMonthlyPlanColumns.length + 1; column++) {
    const previous = excelMonthlyPlanColumns[column - 2]?.group;
    const current = excelMonthlyPlanColumns[column - 1]?.group;
    if (previous !== current) { if (previous && column - start > 1) sheet.mergeCells(1, start, 1, column - 1); start = column; }
  }
  if (excelMonthlyPlanColumns.at(-1)?.group) sheet.mergeCells(1, start, 1, excelMonthlyPlanColumns.length);
  sheet.getRows(1, 2).forEach((row) => row.eachCell((cell) => headerStyle(cell)));
  sheet.getRow(1).height = 28; sheet.getRow(2).height = 36;
  const { sheet: listSheet, entries } = addDictionarySheet(workbook, configuredSuppliers);
  const lastRow = firstMonthlyRow + rowCount - 1;
  excelMonthlyPlanColumns.forEach((definition, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = definition.kind === "date" ? 15 : definition.kind === "decimal" ? 13 : Math.min(28, Math.max(12, definition.header.length * 2 + 4));
    const range = `${column.letter}${firstMonthlyRow}:${column.letter}${lastRow}`;
    if (definition.kind === "date") {
      column.numFmt = "yyyy-mm-dd";
      addValidation(sheet, range, { type: "date", operator: "between", formulae: [new Date("2000-01-01"), new Date("2200-12-31")], errorTitle: "日期格式错误", error: "请输入 2000-01-01 至 2200-12-31 之间的日期。" });
    } else if (definition.kind === "decimal") {
      column.numFmt = "0.####";
      addValidation(sheet, range, { type: "decimal", operator: "between", formulae: [-1e12, 1e12], errorTitle: "数字格式错误", error: "该列只能填写数字。" });
    } else if (definition.dictionaryCode) {
      const entryIndex = Object.keys(entries).indexOf(definition.dictionaryCode) + 1;
      const listColumn = listSheet.getColumn(entryIndex);
      addValidation(sheet, range, { type: "list", formulae: [listFormula(listSheet, listColumn.letter, entries[definition.dictionaryCode].length)], errorTitle: "值不在字典中", error: "只能选择下拉列表中的有效值；供应商须与系统启用供应商完全一致。" });
    }
  });
  const orderColumn = sheet.getColumn(excelMonthlyPlanColumns.findIndex((column) => column.key === "orderNumber") + 1);
  const itemColumn = sheet.getColumn(excelMonthlyPlanColumns.findIndex((column) => column.key === "itemNumber") + 1);
  const lastColumn = sheet.getColumn(excelMonthlyPlanColumns.length).letter;
  addValidation(sheet, `${orderColumn.letter}${firstMonthlyRow}:${orderColumn.letter}${lastRow}`, { type: "custom", allowBlank: false, formulae: [`OR(COUNTA($A${firstMonthlyRow}:$${lastColumn}${firstMonthlyRow})=0,LEN(TRIM(${orderColumn.letter}${firstMonthlyRow}))>0)`], errorTitle: "订单号必填", error: "只要本行填写了数据，订单号就不能为空。" });
  addValidation(sheet, `${itemColumn.letter}${firstMonthlyRow}:${itemColumn.letter}${lastRow}`, { type: "custom", allowBlank: false, formulae: [`OR(COUNTA($A${firstMonthlyRow}:$${lastColumn}${firstMonthlyRow})=0,LEN(TRIM(${itemColumn.letter}${firstMonthlyRow}))>0)`], errorTitle: "品号必填", error: "只要本行填写了数据，品号就不能为空。" });
  sheet.autoFilter = { from: "A2", to: `${lastColumn}2` };
  sheet.properties.defaultRowHeight = 20;
  await workbook.xlsx.writeFile(path.join(outputDir, "月度计划导入模板.xlsx"));
}

async function salesTemplate() {
  const columns = [
    ["customer", "客户", "text"], ["salesperson", "业务员", "text"], ["orderNumber", "订单号", "required"],
    ["orderDate", "下单日期", "date"], ["customerDueDate", "客户要求交期", "date"], ["reviewDueDate", "产前评审交期", "date"],
    ["exceptionDueDate", "异常后二次交期", "date"], ["exceptionDeliveryMethod", "异常交货方式", "deliveryMethod"],
    ["orderAmount", "订单金额", "decimal"], ["division", "承产单位", "division"], ["actualCompletionDate", "订单实际完成日期", "date"],
    ["shippingDate", "出货日期", "date"], ["deliveryScore", "交期评分", "decimal"], ["qualityScore", "品质评分", "decimal"]
  ];
  const workbook = new ExcelJS.Workbook(); workbook.creator = "凯南计划中心";
  const sheet = workbook.addWorksheet("接单汇总", { views: [{ state: "frozen", ySplit: 3 }] });
  sheet.addRow(columns.map(() => "销售接单汇总")); sheet.mergeCells(1, 1, 1, columns.length);
  sheet.addRow(columns.map((column) => column[1]));
  sheet.addRow(columns.map((column) => column[2] === "required" ? "必填；文件内不可重复" : column[2] === "date" ? "YYYY-MM-DD" : column[2] === "decimal" ? "仅数字" : column[2] === "deliveryMethod" || column[2] === "division" ? "从下拉列表选择" : "可选"));
  sheet.getRows(1, 2).forEach((row) => row.eachCell((cell) => headerStyle(cell)));
  sheet.getRow(3).eachCell((cell) => headerStyle(cell, false));
  const { sheet: listSheet, entries } = addDictionarySheet(workbook);
  const lastRow = firstSalesRow + rowCount - 1;
  columns.forEach((column, index) => {
    const excelColumn = sheet.getColumn(index + 1); excelColumn.width = column[2] === "date" ? 18 : Math.max(14, column[1].length * 2 + 6);
    const range = `${excelColumn.letter}${firstSalesRow}:${excelColumn.letter}${lastRow}`;
    if (column[2] === "date") { excelColumn.numFmt = "yyyy-mm-dd"; addValidation(sheet, range, { type: "date", operator: "between", formulae: [new Date("2000-01-01"), new Date("2200-12-31")], errorTitle: "日期格式错误", error: "请输入有效日期 YYYY-MM-DD。" }); }
    if (column[2] === "decimal") { excelColumn.numFmt = "0.####"; addValidation(sheet, range, { type: "decimal", operator: "between", formulae: [-1e12, 1e12], errorTitle: "数字格式错误", error: "该列只能填写数字。" }); }
    if (["deliveryMethod", "division"].includes(column[2])) {
      const entryIndex = Object.keys(entries).indexOf(column[2]) + 1; const listColumn = listSheet.getColumn(entryIndex);
      addValidation(sheet, range, { type: "list", formulae: [listFormula(listSheet, listColumn.letter, entries[column[2]].length)], errorTitle: "值不在字典中", error: "只能选择系统字典中的有效值。" });
    }
  });
  addValidation(sheet, `C${firstSalesRow}:C${lastRow}`, { type: "custom", allowBlank: false, formulae: [`LEN(TRIM(C${firstSalesRow}))>0`], errorTitle: "订单号必填", error: "订单号不能为空。" });
  sheet.autoFilter = { from: "A2", to: `${sheet.getColumn(columns.length).letter}2` };
  await workbook.xlsx.writeFile(path.join(outputDir, "销售订单汇总导入模板.xlsx"));
}

Promise.all([monthlyTemplate(), salesTemplate()]).catch((error) => { console.error(error); process.exitCode = 1; });
