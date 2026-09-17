#!/usr/bin/env node
/*
 * KN-MPS-INIT-001 初始化文件标准化（一次性、只读原文件）
 *
 * 背景：原始 xlsx 由生成器写成 `x:` 前缀命名空间且 Excel 表格使用绝对 Target，平台官方读取器（exceljs）无法直接解析。
 * 本工具：
 *   1. 以只读方式读入原文件字节（绝不修改原文件）；
 *   2. 用已审计的内存规范化副本（主命名空间前缀还原 + 移除 Excel 表格对象）交给 ExcelJS 解析；
 *   3. 用 ExcelJS 重新写出一个标准 XLSX（保留 6 个 Sheet、全部业务单元格值/日期/空值/行顺序）；
 *   4. 计算“逻辑内容 hash”（sheetName + rowNumber + columnNumber + normalizedCellValue 的 canonical JSON → SHA256），
 *      逐 Sheet 比对原文件（规范化读取）与标准文件的逻辑内容，任何业务值不同即失败退出。
 *
 * 用法（api 容器内，Node 24）：
 *   node scripts/one-off/kn-mps-init-001-standardize.cjs --source /tmp/original.xlsx --target /tmp/standard.xlsx --report outputs/KN-MPS-INIT-001-standardization.json
 */
const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const JSZip = require("jszip");
const ExcelJS = require("exceljs");

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const source = argOf("--source", "/tmp/original.xlsx");
const target = argOf("--target", "/tmp/standard.xlsx");
const reportPath = argOf("--report", "outputs/KN-MPS-INIT-001-standardization.json");

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** 规范化单个单元格值，用于逻辑内容比对（不改业务语义，只把类型写成稳定文本）。 */
function canonicalValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (typeof value === "number") return `num:${String(value)}`;
  if (typeof value === "string") return `str:${value}`;
  if (typeof value === "boolean") return `bool:${value}`;
  if (typeof value === "object" && value && "text" in value) return `str:${value.text}`;
  if (typeof value === "object" && value && "result" in value) return `formula:${JSON.stringify(value.result)}`;
  if (typeof value === "object" && value && "richText" in value) return `str:${value.richText.map((part) => part.text).join("")}`;
  return `other:${JSON.stringify(value)}`;
}

function logicalContent(workbook) {
  const sheets = workbook.worksheets.map((worksheet) => {
    const cells = [];
    /*
     * 逻辑内容按“完整网格”比对（rowCount × columnCount），而不是按存在哪些 cell 对象：
     * 原文件生成器会写出显式空单元格（`<c r="…"/>`），重写后这些空 cell 对象消失，
     * 但对应坐标的业务值两边都是空 —— 属于格式差异，不是业务值差异。
     */
    const rowCount = worksheet.rowCount;
    const columnCount = worksheet.columnCount;
    for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
        cells.push([rowNumber, columnNumber, canonicalValue(row.getCell(columnNumber).value)]);
      }
    }
    const canonical = JSON.stringify({ sheet: worksheet.name, cells });
    return {
      name: worksheet.name,
      rowCount,
      columnCount,
      cellCount: cells.length,
      sha256: sha256(Buffer.from(canonical, "utf8")),
      cells
    };
  });
  return {
    sheets,
    overall: sha256(Buffer.from(JSON.stringify(sheets.map((sheet) => ({ name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount, sha256: sheet.sha256 }))), "utf8"))
  };
}

/** 只读内存规范化：主命名空间前缀还原为默认命名空间，并移除 Excel 表格对象（单元格数据不变）。 */
async function normalizeForAnalysis(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const steps = [];
  for (const name of Object.keys(zip.files)) {
    if (!/\.(xml|rels)$/i.test(name)) continue;
    const content = await zip.file(name).async("string");
    if (content.includes("<x:") || content.includes('xmlns:x="')) {
      zip.file(name, content
        .replaceAll('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')
        .replaceAll("<x:", "<").replaceAll("</x:", "</"));
      steps.push("namespace-normalized");
    }
  }
  for (const name of Object.keys(zip.files)) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(name)) {
      const content = await zip.file(name).async("string");
      const stripped = content.replace(/<tableParts[\s\S]*?<\/tableParts>/g, "");
      if (stripped !== content) { zip.file(name, stripped); steps.push("tableParts-removed"); }
    }
    if (/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/i.test(name)) { zip.file(name, '<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'); }
    if (/^xl\/tables\/table\d+\.xml$/i.test(name)) zip.remove(name);
  }
  return { buffer: await zip.generateAsync({ type: "nodebuffer" }), steps: [...new Set(steps)] };
}

async function load(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

async function main() {
  const sourceBytes = readFileSync(source);
  const normalized = await normalizeForAnalysis(sourceBytes);
  const originalWorkbook = await load(normalized.buffer);
  const originalLogical = logicalContent(originalWorkbook);

  const standard = new ExcelJS.Workbook();
  standard.creator = "KN-MPS-INIT-001 standardization";
  for (const worksheet of originalWorkbook.worksheets) {
    const copy = standard.addWorksheet(worksheet.name);
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
        const value = cell.value;
        if (value === null || value === undefined) return;
        /* 只搬运业务值（字符串/数值/日期/布尔），不搬运样式与 Excel Table 对象。 */
        copy.getCell(rowNumber, columnNumber).value = value;
      });
    });
  }
  const targetBytes = await standard.xlsx.writeBuffer();
  writeFileSync(target, targetBytes);

  const standardWorkbook = await load(readFileSync(target));
  const standardLogical = logicalContent(standardWorkbook);

  const differences = [];
  const names = new Set([...originalLogical.sheets.map((sheet) => sheet.name), ...standardLogical.sheets.map((sheet) => sheet.name)]);
  for (const name of names) {
    const before = originalLogical.sheets.find((sheet) => sheet.name === name);
    const after = standardLogical.sheets.find((sheet) => sheet.name === name);
    if (!before || !after) { differences.push({ sheet: name, kind: "sheet-missing", before: Boolean(before), after: Boolean(after) }); continue; }
    if (before.rowCount !== after.rowCount) differences.push({ sheet: name, kind: "rowCount", before: before.rowCount, after: after.rowCount });
    if (before.columnCount !== after.columnCount) differences.push({ sheet: name, kind: "columnCount", before: before.columnCount, after: after.columnCount });
    if (before.sha256 !== after.sha256) {
      differences.push({ sheet: name, kind: "logical-hash", before: before.sha256, after: after.sha256 });
      const beforeMap = new Map(before.cells.map(([row, column, value]) => [`${row}:${column}`, value]));
      const afterMap = new Map(after.cells.map(([row, column, value]) => [`${row}:${column}`, value]));
      const cellDiffs = [];
      for (const [key, value] of beforeMap) if (afterMap.get(key) !== value) cellDiffs.push({ cell: key, before: value, after: afterMap.get(key) ?? null });
      for (const [key, value] of afterMap) if (!beforeMap.has(key)) cellDiffs.push({ cell: key, before: null, after: value });
      differences.push({ sheet: name, kind: "cell-differences", count: cellDiffs.length, sample: cellDiffs.slice(0, 10) });
    }
  }

  const report = {
    task: "KN-MPS-INIT-001",
    generatedAt: new Date().toISOString(),
    source: { path: source, bytes: sourceBytes.length, sha256: sha256(sourceBytes) },
    target: { path: target, bytes: targetBytes.length, sha256: sha256(Buffer.from(targetBytes)) },
    normalizationSteps: normalized.steps,
    officialReaderBeforeStandardization: "failed",
    officialReaderAfterStandardization: "ok",
    logicalContent: {
      overallBefore: originalLogical.overall,
      overallAfter: standardLogical.overall,
      equal: originalLogical.overall === standardLogical.overall,
      sheets: originalLogical.sheets.map((sheet) => {
        const after = standardLogical.sheets.find((candidate) => candidate.name === sheet.name);
        return {
          sheet: sheet.name,
          rowCountBefore: sheet.rowCount, rowCountAfter: after ? after.rowCount : null,
          columnCountBefore: sheet.columnCount, columnCountAfter: after ? after.columnCount : null,
          cellsBefore: sheet.cellCount, cellsAfter: after ? after.cellCount : null,
          sha256Before: sheet.sha256, sha256After: after ? after.sha256 : null,
          equal: Boolean(after) && sheet.sha256 === after.sha256
        };
      })
    },
    differences
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log("【KN-MPS-INIT-001 标准化】");
  console.log(`原文件：${source} (${sourceBytes.length} bytes, sha256=${report.source.sha256})`);
  console.log(`标准文件：${target} (${targetBytes.length} bytes, sha256=${report.target.sha256})`);
  for (const sheet of report.logicalContent.sheets) {
    console.log(`  ${sheet.sheet}: rows ${sheet.rowCountBefore}→${sheet.rowCountAfter}, cols ${sheet.columnCountBefore}→${sheet.columnCountAfter}, cells ${sheet.cellsBefore}→${sheet.cellsAfter}, hashEqual=${sheet.equal}`);
  }
  console.log(`逻辑内容总体一致：${report.logicalContent.equal}；差异条目=${differences.length}`);
  console.log(`报告：${reportPath}`);
  if (!report.logicalContent.equal || differences.length) { console.error("标准化失败：逻辑内容不一致，禁止继续初始化。"); process.exit(2); }
}

main().catch((error) => { console.error("standardize failed:", error); process.exit(1); });
