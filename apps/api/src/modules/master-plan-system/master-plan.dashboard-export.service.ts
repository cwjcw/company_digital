import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { mpsDashboardPlanMetrics, mpsDashboardRiskColumns, mpsDashboardReadinessColumns, mpsDashboardExecutionColumns, mpsDashboardTableKeys, mpsDashboardGaps, mpsDashboardGapColumns, type MpsDashboardRow, type MpsDashboardTableKey } from "@kdos/contracts";
import { MasterPlanDashboardService, type DashboardQuery } from "./master-plan.dashboard.service";
import type { MasterPlanActor } from "./master-plan.types";

@Injectable()
export class MasterPlanDashboardExportService {
  constructor(private readonly dashboard: MasterPlanDashboardService, private readonly application: MasterPlanApplicationService) {}
  async export(input: DashboardQuery, actor: MasterPlanActor) {
    this.dashboard.querySql(input, actor, "export");
    if (!mpsDashboardTableKeys.includes(input.tableKey as MpsDashboardTableKey)) throw new BadRequestException("请选择有效的导出表");
    const tableKey = input.tableKey as MpsDashboardTableKey;
    const gap = mpsDashboardGaps.find(g => g.key === tableKey);
    const { tableKey: _table, sortField: _sort, sortOrder: _order, ...filters } = input;
    void _table; void _sort; void _order;
    let rows: MpsDashboardRow[], fields: string[], definitions: ReadonlyArray<readonly [string,string]>;
    if (tableKey === "division-summary" || tableKey === "process-summary") {
      const data = await this.dashboard.dashboard(filters, actor, "export"); fields = data.visibleFields;
      rows = tableKey === "division-summary" ? data.divisions : data.processes.map(p => ({ processName:p.name, ...p.values, ...(fields.includes(p.code+"Status") ? {status:p.states.map(s=>`${s.status} ${s.count}`).join("、") || null} : {}) }));
      definitions = tableKey === "division-summary" ? [["divisionId","事业部"],...mpsDashboardPlanMetrics] : mpsDashboardExecutionColumns.filter(([k])=>["processName","requiredQuantity","reportedQuantity","productionProgress","status"].includes(k));
    } else {
      const data = await this.dashboard.table(input, actor, "export", true); rows = data.rows; fields = data.visibleFields;
      definitions = gap ? mpsDashboardGapColumns(gap.key) : tableKey === "plan-readiness" ? mpsDashboardReadinessColumns : tableKey === "process-execution" ? mpsDashboardExecutionColumns : mpsDashboardRiskColumns;
    }
    const processTable = tableKey.startsWith("process-");
    const columns = definitions.filter(([key]) => {
      if (processTable && ["processName","requiredQuantity","reportedQuantity","productionProgress","status"].includes(key)) return key === "processName" || rows.some(r => key in r);
      if (key === "issueCategory") return fields.includes("weeklyPlanState");
      if (["currentNode", "currentStatus"].includes(key)) return Boolean(gap && fields.includes(gap.metric));
      return fields.includes(key);
    });
    if (!columns.length) throw new ForbiddenException("没有可导出的可见字段");
    const titles: Record<string,string> = {"division-summary":"事业部计划与执行汇总","plan-readiness":"计划待完善明细","process-execution":"工序执行明细","risk-exception":"风险与异常","process-summary":"工序执行汇总"};
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet(gap?.title ?? titles[tableKey]!);
    sheet.columns = columns.map(([key,label])=>({key,header:label,width:["exceptionSummary","weeklyPlanMissingFields","weeklyPlanGenerationIssue"].includes(key)?45:22}));
    sheet.views=[{state:"frozen",ySplit:1}]; sheet.getRow(1).font={bold:true}; sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:columns.length}};
    const numeric = new Set([...mpsDashboardPlanMetrics.map(([k])=>String(k)),"plannedQuantity","reportedQuantity","productionProgress"]);
    for(const [key] of columns)if(numeric.has(key))sheet.getColumn(key).numFmt=/Rate$|Progress$/.test(key)?"0.0%":"0.####";
    for(const row of rows)sheet.addRow(Object.fromEntries(columns.map(([key])=>{
      const value=key==="divisionId"?row.divisionName??"—":row[key];
      if(value==null)return [key,null];
      if(!numeric.has(key))return [key,String(value)];
      const decimal=new Decimal(value);return [key,/Rate$|Progress$/.test(key)||decimal.sd()<=15?decimal.toNumber():decimal.toFixed()];
    })));
    const buffer=Buffer.from(await book.xlsx.writeBuffer());
    await this.application.recordDashboardExport({tableKey,rowCount:rows.length,fields:columns.map(([key])=>key)},actor);
    return buffer;
  }
}
