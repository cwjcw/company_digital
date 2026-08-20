import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import { PlanQueryService } from "./planning.query.service";
import type { PlanningActor } from "./planning.types";

function valueAt(row: any, path: string) { return path.split(".").reduce((value, part) => value?.[part], row); }

@Injectable()
export class PlanningExportService {
  constructor(private readonly queries: PlanQueryService) {}
  async export(versionId: string, actor: PlanningActor) {
    const rows = await this.queries.searchPlanItems({ versionId, limit: 10000 }, actor);
    const fields = this.queries.fields(actor).filter((field) => field.access !== "HIDDEN");
    const workbook = new ExcelJS.Workbook(); workbook.creator = "KDOS Planning Center";
    const sheet = workbook.addWorksheet("主计划");
    sheet.addRow(fields.map((field) => field.groupLabel)); sheet.addRow(fields.map((field) => field.label));
    for (const row of rows) sheet.addRow(fields.map((field) => valueAt(row, field.code) ?? null));
    let start = 1;
    while (start <= fields.length) { let end = start; while (end < fields.length && fields[end].groupLabel === fields[start - 1].groupLabel) end++; if (end > start) sheet.mergeCells(1, start, 1, end); start = end + 1; }
    sheet.views = [{ state: "frozen", ySplit: 2, xSplit: 2 }]; sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: fields.length } };
    fields.forEach((field, index) => { sheet.getColumn(index + 1).width = Math.max(8, Math.min(30, Math.ceil(field.width / 8))); });
    for (const row of [sheet.getRow(1), sheet.getRow(2)]) { row.font = { bold: true }; row.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
