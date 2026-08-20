import { PlanningImportService } from "./planning-import.service";
import type { PlanningActor } from "./planning.types";
import ExcelJS from "exceljs";

describe("PlanningImportService", () => {
  const actor: PlanningActor = { tenantCode: "KAINAN", userId: null, permissions: ["*"], roles: [], requestId: "import-test", source: "IMPORT" };
  it("parses, normalizes, warns and previews CSV without writing rows directly", async () => {
    const commands = { previewImport: jest.fn().mockResolvedValue({ jobId: "job-1", summary: { total: 1, warnings: 2 }, warnings: [] }) } as any;
    const service = new PlanningImportService(commands);
    const csv = ["订单号,品号,品名,订单需求数量,客户要求交期", "SO-1,I-1,产品,10.5000,2026-09-20", "SO-1,I-1,产品新,12,2026-09-21", ",I-2,缺订单,1,2026-09-20"].join("\n");
    const file = { originalname: "plan.csv", buffer: Buffer.from(csv), mimetype: "text/csv" } as Express.Multer.File;
    await expect(service.preview("version-1", file, actor)).resolves.toMatchObject({ jobId: "job-1" });
    expect(commands.previewImport).toHaveBeenCalledWith("version-1", "plan.csv", expect.stringMatching(/^[a-f0-9]{64}$/), [expect.objectContaining({ orderNumber: "SO-1", itemNumber: "I-1", itemName: "产品新", productionQuantity: 12 })], expect.arrayContaining([expect.stringContaining("重复"), expect.stringContaining("缺少")]), actor);
  });
  it("uses both header levels so repeated process labels never cross process groups", async () => {
    const commands = { previewImport: jest.fn().mockResolvedValue({ jobId: "job-2", summary: { total: 1, warnings: 0 }, warnings: [] }) } as any;
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("主计划");
    sheet.addRow(["计划信息", "计划信息", "计划信息", "计划信息", "计划信息", "前道配件", "前道配件", "机加", "机加"]);
    sheet.addRow(["订单号", "品号", "品名", "订单需求数量", "客户要求交期", "所需天数", "交期", "所需天数", "交期"]);
    sheet.addRow(["SO-X", "I-X", "测试", 12, "2026-09-20", 1.5, "2026-09-10", 2.5, "2026-09-12"]);
    const file = { originalname: "plan.xlsx", buffer: Buffer.from(await workbook.xlsx.writeBuffer()), mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } as Express.Multer.File;
    await new PlanningImportService(commands).preview("version-1", file, actor);
    const row = commands.previewImport.mock.calls[0][3][0];
    expect(row.legacyData.processes).toMatchObject({ frontParts: { requiredDays: 1.5, dueDate: "2026-09-10" }, machining: { requiredDays: 2.5, dueDate: "2026-09-12" } });
  });
});
