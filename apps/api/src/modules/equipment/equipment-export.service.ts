import { ForbiddenException, Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import { EquipmentApplicationService } from "./equipment.application.service";
import { EquipmentQueryService } from "./equipment.query.service";
import { EquipmentActor, hasEquipmentPermission } from "./equipment.types";

@Injectable()
export class EquipmentExportService {
  constructor(private readonly queries: EquipmentQueryService, private readonly application: EquipmentApplicationService) {}

  async statusTemplate(actor: EquipmentActor) {
    if (!hasEquipmentPermission(actor, "equipment-status-report", "import")) throw new ForbiddenException("当前权限组没有此表的导入权限");
    return this.workbook([]);
  }

  async statusExport(input: Record<string, unknown>, actor: EquipmentActor) {
    const rows = await this.queries.exportStatus(input, actor);
    await this.application.recordStatusExport(rows.length, actor);
    return this.workbook(rows);
  }

  private async workbook(rows: any[]) {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("设备状态填报");
    sheet.columns = [
      { header: "事业部", key: "divisionName", width: 16 }, { header: "设备编号", key: "equipmentCode", width: 20 },
      { header: "设备名称", key: "equipmentName", width: 28 }, { header: "使用部门", key: "usageDepartmentName", width: 20 },
      { header: "填报日期", key: "reportDate", width: 15 }, { header: "运行时长", key: "runtimeMinutes", width: 16 },
      { header: "故障时长", key: "faultMinutes", width: 16 }, { header: "故障原因", key: "faultReason", width: 22 }
    ];
    const duration = (minutes: unknown) => `${Math.floor(Number(minutes ?? 0) / 60)}小时${Number(minutes ?? 0) % 60}分钟`;
    for (const row of rows) sheet.addRow({ ...row, runtimeMinutes: duration(row.runtimeMinutes), faultMinutes: duration(row.faultMinutes) });
    const header = sheet.getRow(1); header.font = { name: "微软雅黑", bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4B70" } }; header.alignment = { horizontal: "center" };
    sheet.views = [{ state: "frozen", ySplit: 1 }]; sheet.autoFilter = { from: "A1", to: "H1" };
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
