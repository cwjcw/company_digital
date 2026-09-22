import ExcelJS from "exceljs";
import { EquipmentExportService } from "./equipment-export.service";
import type { EquipmentActor } from "./equipment.types";
const service = new EquipmentExportService({} as any, {} as any);
const actor = (permission: string) => ({ permissions: [permission] }) as EquipmentActor;
it.each(["create", "import", "export"])("allows %s users to download a blank template with instructions", async (action) => {
  const buffer = await service.statusTemplate(actor(`equipment-status-report:*:${action}`));
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as any);
  const sheet = workbook.getWorksheet("设备状态填报")!;
  expect(sheet.rowCount).toBe(1);
  const headerValues = sheet.getRow(1).values as unknown[];
  expect(headerValues.slice(1)).toEqual(["事业部", "使用部门", "设备编号", "设备名称", "填报日期", "计划运行时间", "实际运行时长", "故障时长", "故障原因"]);
  expect(sheet.getColumn(3).numFmt).toBe("@"); expect(workbook.getWorksheet("填写说明")).toBeDefined();
  expect(workbook.getWorksheet("填写说明")!.getColumn(1).values.some((value) => String(value).includes("实际运行时长、故障时长支持“10小时”“10小时10分钟”“10分钟”和空值"))).toBe(true);
  expect(workbook.getWorksheet("填写说明")!.getColumn(1).values.some((value) => String(value).includes("计划运行时间为必填项"))).toBe(true);
  expect(workbook.getWorksheet("填写说明")!.getColumn(1).values.some((value) => String(value).includes("稼动率 = 实际运行时长 ÷ 计划运行时间 × 100%"))).toBe(true);
});
it("rejects read-only users and permissions for another table", async () => {
  await expect(service.statusTemplate(actor("equipment-status-report:*:read"))).rejects.toThrow("权限");
  await expect(service.statusTemplate(actor("equipment-register:*:create"))).rejects.toThrow("权限");
});
