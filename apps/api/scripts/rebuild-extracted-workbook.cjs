const fs = require("node:fs");
const ExcelJS = require("exceljs");

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error("必须提供提取数据路径和输出 XLSX 路径");
  const extracted = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!Array.isArray(extracted.worksheets) || extracted.worksheets.length === 0) throw new Error("没有可转换的工作表");
  const workbook = new ExcelJS.Workbook();
  for (const sourceSheet of extracted.worksheets) {
    const sheet = workbook.addWorksheet(String(sourceSheet.name).slice(0, 31));
    for (const row of sourceSheet.rows ?? []) sheet.addRow(row);
  }
  await workbook.xlsx.writeFile(outputPath);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
