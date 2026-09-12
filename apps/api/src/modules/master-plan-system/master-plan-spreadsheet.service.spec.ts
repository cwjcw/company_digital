import { BadRequestException } from "@nestjs/common";
import ExcelJS from "exceljs";
import { ENCRYPTED_SPREADSHEET_MESSAGE } from "../../spreadsheet-upload";
import { MasterPlanSpreadsheetService } from "./master-plan-spreadsheet.service";

const actor = { tenantId: "KAINAN", userId: "11111111-1111-4111-8111-111111111111", username: "tester", permissions: ["*"], isSystemAdmin: true, moduleAdminCodes: [], tableDataScopes: [], requestId: "request-1", source: "web" as const };

describe("MasterPlanSpreadsheetService", () => {
  const queries = { exportRows: jest.fn() };
  const application = { validateImportUpdates: jest.fn(), importUpdates: jest.fn() };
  const service = new MasterPlanSpreadsheetService(queries as never, application as never);

  beforeEach(() => { jest.clearAllMocks(); process.env.JWT_ACCESS_SECRET = "test-secret"; });

  it("rejects encrypted workbooks with the unified message before parsing", async () => {
    const file = { originalname: "encrypted.xlsx", buffer: Buffer.from([0x88, 0x7d, 0x1c, 0x00]) } as Express.Multer.File;
    await expect(service.preview("mps-shipping-plans", file, actor)).rejects.toEqual(expect.objectContaining<Partial<BadRequestException>>({ message: ENCRYPTED_SPREADSHEET_MESSAGE }));
  });

  it("exports stable record identity, version and authorized fields", async () => {
    queries.exportRows.mockResolvedValue({ visibleFields: ["orderNumber", "itemCode"], rows: [{ id: "row-1", version: 3, orderNumber: "000123", itemCode: "0009" }] });
    const buffer = await service.export("mps-monthly-plans", {}, actor);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getRow(1).values).toEqual([undefined, "记录ID", "版本", "订单编号", "品号"]);
    expect(sheet.getRow(2).getCell(3).text).toBe("000123");
  });
});
