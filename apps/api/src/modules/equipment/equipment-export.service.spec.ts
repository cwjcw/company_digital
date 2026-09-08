import ExcelJS from "exceljs";
import { EquipmentExportService } from "./equipment-export.service";
import type { EquipmentActor } from "./equipment.types";
const service = new EquipmentExportService({} as any, {} as any);
const actor = (permission: string) => ({ permissions: [permission] }) as EquipmentActor;
it.each(["create", "import", "export"])("allows %s users to download a blank template with instructions", async (action) => {
  const buffer = await service.statusTemplate(actor(`equipment-status-report:*:${action}`));
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as any);
  const sheet = workbook.getWorksheet("设备状态填报")!;
  expect(sheet.rowCount).toBe(1); expect(sheet.getRow(1).values).toContain("设备编号");
  expect(sheet.getColumn(2).numFmt).toBe("@"); expect(workbook.getWorksheet("填写说明")).toBeDefined();
  expect(workbook.getWorksheet("填写说明")!.getColumn(1).values.some((value) => String(value).includes("运行时长、故障时长支持“10小时”“10小时10分钟”“10分钟”和空值"))).toBe(true);
});
it("rejects read-only users and permissions for another table", async () => {
  await expect(service.statusTemplate(actor("equipment-status-report:*:read"))).rejects.toThrow("权限");
  await expect(service.statusTemplate(actor("equipment-register:*:create"))).rejects.toThrow("权限");
});
