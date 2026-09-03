import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import ExcelJS from "exceljs";
import { DataSource } from "typeorm";
import { AppModule } from "../../app.module";
import { PlanningApplicationService } from "./planning.application.service";
import { PlanningImportService } from "./planning-import.service";
import { PlanQueryService } from "./planning.query.service";
import type { PlanningActor } from "./planning.types";

type ImportedRow = { sourceRow: number; values: ExcelJS.CellValue[]; orderNumber: string; itemNumber: string };
type SkippedRow = { sourceRow: number; orderNumber: string; itemNumber: string; error: string };

async function stdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function chunkWorkbook(topHeader: ExcelJS.CellValue[], secondHeader: ExcelJS.CellValue[], rows: ImportedRow[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("主计划");
  sheet.addRow(topHeader); sheet.addRow(secondHeader);
  for (const row of rows) sheet.addRow(row.values);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function run() {
  const input = await stdin();
  if (!input.length) throw new Error("请通过标准输入提供标准化计划 Excel");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(input as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet("主计划") ?? workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 3) throw new Error("标准化计划没有数据行");
  const columnCount = sheet.columnCount;
  const rowValues = (rowNumber: number) => Array.from({ length: columnCount }, (_, index) => sheet.getCell(rowNumber, index + 1).value);
  const topHeader = rowValues(1); const secondHeader = rowValues(2);
  const orderColumn = secondHeader.findIndex((value) => String(value ?? "").trim() === "订单号");
  const itemColumn = secondHeader.findIndex((value) => String(value ?? "").trim() === "品号");
  if (orderColumn < 0 || itemColumn < 0) throw new Error("标准化计划缺少订单号或品号列");
  const rows: ImportedRow[] = [];
  for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber++) {
    const values = rowValues(rowNumber);
    const orderNumber = String(values[orderColumn] ?? "").trim();
    const itemNumber = String(values[itemColumn] ?? "").trim();
    if (!orderNumber || !itemNumber) continue;
    rows.push({ sourceRow: rowNumber, values, orderNumber, itemNumber });
  }

  const application = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const dataSource = application.get(DataSource);
    const imports = application.get(PlanningImportService);
    const commands = application.get(PlanningApplicationService);
    const queries = application.get(PlanQueryService);
    const [admin] = await dataSource.query("SELECT id FROM users WHERE username=$1 AND enabled=true LIMIT 1", [process.env.ADMIN_USERNAME ?? "admin"]);
    const actor: PlanningActor = {
      tenantCode: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN",
      userId: admin?.id ?? null,
      permissions: ["*"], roles: ["SYSTEM_IMPORT"], requestId: `september-plan-import:${randomUUID()}`,
      source: "IMPORT",
    };
    const period = await queries.getPeriodByMonth(2026, 9, actor);
    const draft = period?.versions.find((version) => version.status === "DRAFT");
    if (!draft) throw new Error("2026 年 9 月没有可导入的 DRAFT 版本");

    const skipped: SkippedRow[] = [];
    const batches: Array<{ firstRow: number; lastRow: number; size: number; created: number; updated: number; repeated: boolean; elapsedMs: number }> = [];
    let created = 0; let updated = 0; let repeatedRows = 0;

    const importRows = async (batch: ImportedRow[]): Promise<void> => {
      const startedAt = Date.now();
      try {
        const buffer = await chunkWorkbook(topHeader, secondHeader, batch);
        const file = {
          originalname: `2026-09-plan-${batch[0]!.sourceRow}-${batch.at(-1)!.sourceRow}.xlsx`,
          mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer,
        } as Express.Multer.File;
        const preview = await imports.preview(draft.id, file, actor);
        const result = await commands.confirmImport(preview.jobId, actor);
        created += result.created; updated += result.updated;
        if (result.repeated) repeatedRows += batch.length;
        batches.push({ firstRow: batch[0]!.sourceRow, lastRow: batch.at(-1)!.sourceRow, size: batch.length,
          created: result.created, updated: result.updated, repeated: result.repeated, elapsedMs: Date.now() - startedAt });
      } catch (error) {
        if (batch.length === 1) {
          skipped.push({ sourceRow: batch[0]!.sourceRow, orderNumber: batch[0]!.orderNumber,
            itemNumber: batch[0]!.itemNumber, error: errorText(error) });
          return;
        }
        const middle = Math.ceil(batch.length / 2);
        await importRows(batch.slice(0, middle));
        await importRows(batch.slice(middle));
      }
    };

    const batchSize = 500;
    for (let start = 0; start < rows.length; start += batchSize) await importRows(rows.slice(start, start + batchSize));
    const targetRows = await queries.searchPlanItems({ versionId: draft.id, limit: 10000 }, actor);
    const sourceKeys = new Set(rows.map((row) => `${row.orderNumber}\u0000${row.itemNumber}`));
    const importedTargetRows = targetRows.filter((row) => sourceKeys.has(`${row.orderNumber}\u0000${row.itemNumber}`));
    const report = {
      mode: "CONFIRMED", target: { year: 2026, month: 9, versionId: draft.id },
      sourceRows: rows.length, imported: created + updated, created, updated, repeatedRows,
      skipped: skipped.length, skippedRows: skipped, batches,
      verification: {
        targetTotalRows: targetRows.length, matchedImportedRows: importedTargetRows.length,
        orders: new Set(importedTargetRows.map((row) => row.orderNumber)).size,
        customers: new Set(importedTargetRows.map((row) => row.customer).filter(Boolean)).size,
        missingCustomer: importedTargetRows.filter((row) => !row.customer).length,
        missingRequiredKey: importedTargetRows.filter((row) => !row.orderNumber || !row.itemNumber).length,
      },
      completedAt: new Date().toISOString(),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await application.close();
  }
}

run().catch((error) => {
  process.stderr.write(`${errorText(error)}\n`);
  process.exitCode = 1;
});
