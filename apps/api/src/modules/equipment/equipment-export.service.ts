import { ForbiddenException, Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import { EquipmentApplicationService } from "./equipment.application.service";
import { EquipmentQueryService } from "./equipment.query.service";
import { EquipmentActor, hasEquipmentPermission } from "./equipment.types";

@Injectable()
export class EquipmentExportService {
  constructor(private readonly queries: EquipmentQueryService, private readonly application: EquipmentApplicationService) {}

  async statusTemplate(actor: EquipmentActor) {
    if (!["create", "import", "export"].some((action) => hasEquipmentPermission(actor, "equipment-status-report", action))) throw new ForbiddenException("下载模板需要设备状态表的填报、导入或导出权限");
    return this.workbook([], true);
  }

  async statusExport(input: Record<string, unknown>, actor: EquipmentActor) {
    const rows = await this.queries.exportStatus(input, actor);
    await this.application.recordStatusExport(rows.length, actor);
    return this.workbook(rows);
  }

  private async workbook(rows: any[], template = false) {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("设备状态填报");
    sheet.columns = [
      { header: "事业部", key: "divisionName", width: 16 }, { header: "使用部门", key: "usageDepartmentName", width: 20 },
      { header: "设备编号", key: "equipmentCode", width: 20 }, { header: "设备名称", key: "equipmentName", width: 28 },
      { header: "填报日期", key: "reportDate", width: 15 }, { header: "计划运行时间", key: "plannedRuntimeMinutes", width: 18 },
      { header: "实际运行时长", key: "runtimeMinutes", width: 16 },
      ...(!template ? [{ header: "稼动率", key: "utilizationRate", width: 14 }] : []),
      { header: "故障时长", key: "faultMinutes", width: 16 }, { header: "故障原因", key: "faultReason", width: 22 }
    ];
    sheet.getColumn("equipmentCode").numFmt = "@";
    if (template) {
      const notes = workbook.addWorksheet("填写说明");
      notes.getColumn(1).width = 110;
      notes.addRows([
        ["请在“设备状态填报”工作表填写数据，保留原表头。设备编号按文本填写，保留前导零。"],
        ["事业部、设备编号、填报日期必填；事业部与设备编号须匹配设备总台账。设备名称和使用部门由系统关联，不作为匹配键。"],
        ["填报日期格式为 YYYY-MM-DD，仅允许今天及之前6天（北京时间）。"],
        ["计划运行时间为必填项，格式与实际运行时长一致，支持“0小时0分钟”“10小时”“10小时30分钟”“30分钟”和“10:30”，允许填写0小时0分钟。"],
        ["实际运行时长、故障时长支持“10小时”“10小时10分钟”“10分钟”和空值，空值按0分钟处理；故障时长大于0时必须填写有效故障原因。"],
        ["稼动率 = 实际运行时长 ÷ 计划运行时间 × 100%；计划运行时间有效时允许超过100%，没有计划运行时间时显示为“—”。"],
        ["相同事业部、设备编号、填报日期按已有记录更新。上传后先检查预览，再确认导入；导入需要单独的导入权限。"]
      ]);
    }
    const duration = (minutes: unknown) => `${Math.floor(Number(minutes ?? 0) / 60)}小时${Number(minutes ?? 0) % 60}分钟`;
    for (const row of rows) sheet.addRow({ ...row, plannedRuntimeMinutes: duration(row.plannedRuntimeMinutes), runtimeMinutes: duration(row.runtimeMinutes), utilizationRate: row.utilizationRate == null ? "—" : `${Number(row.utilizationRate).toFixed(1)}%`, faultMinutes: duration(row.faultMinutes) });
    const header = sheet.getRow(1); header.font = { name: "微软雅黑", bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4B70" } }; header.alignment = { horizontal: "center" };
    sheet.views = [{ state: "frozen", ySplit: 1 }]; sheet.autoFilter = { from: "A1", to: template ? "I1" : "J1" };
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
