import { ForbiddenException, Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { mpsDashboardPlanMetrics, mpsDashboardRiskColumns, type MpsDashboardRow } from "@kdos/contracts";
import { MasterPlanDashboardService, type DashboardQuery } from "./master-plan.dashboard.service";
import type { MasterPlanActor } from "./master-plan.types";

/** Same scoped projection and ExcelJS pattern as the equipment dashboard; no independent export query. */
@Injectable()
export class MasterPlanDashboardExportService {
  constructor(private readonly dashboard: MasterPlanDashboardService, private readonly application: MasterPlanApplicationService) {}
  async export(input: DashboardQuery, actor: MasterPlanActor) {
    const data = await this.dashboard.dashboard(input, actor, "export", true);
    const book = new ExcelJS.Workbook();
    const add = (name: string, definitions: ReadonlyArray<readonly [string, string]>, rows: MpsDashboardRow[]) => {
      const columns = definitions.filter(([key]) => data.visibleFields.includes(key));
      if (!columns.length) return;
      const sheet = book.addWorksheet(name);
      sheet.columns = columns.map(([key, label]) => ({ key, header: label, width: ["exceptionSummary", "weeklyPlanMissingFields", "weeklyPlanGenerationIssue"].includes(key) ? 45 : 22 }));
      sheet.views = [{ state: "frozen", ySplit: 1 }]; sheet.getRow(1).font = { bold: true };
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
      const numeric = new Set(mpsDashboardPlanMetrics.map(([key]) => String(key)));
      for (const [key] of columns) if (numeric.has(key)) sheet.getColumn(key).numFmt = key.endsWith("Rate") ? "0.0%" : "0.####";
      for (const row of rows) sheet.addRow(Object.fromEntries(columns.map(([key]) => {
        const value = key === "divisionId" ? row.divisionName ?? row.divisionId : row[key];
        if (value == null) return [key, null];
        if (!numeric.has(key)) return [key, String(value)];
        const decimal = new Decimal(value);
        // Ratios are Excel percentage cells. Quantities beyond Excel's 15-digit precision remain exact text.
        return [key, key.endsWith("Rate") || decimal.sd() <= 15 ? decimal.toNumber() : decimal.toFixed()];
      })));
    };
    add("事业部汇总", [["divisionId", "事业部"], ...mpsDashboardPlanMetrics], data.divisions);
    add("风险明细", mpsDashboardRiskColumns, data.risks.rows);
    if (!book.worksheets.length) throw new ForbiddenException("没有可导出的可见字段");
    const buffer = Buffer.from(await book.xlsx.writeBuffer());
    await this.application.recordDashboardExport({ divisionRows: data.divisions.length, riskRows: data.risks.total, fields: data.visibleFields }, actor);
    return buffer;
  }
}
