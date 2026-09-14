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

  async function workbookFile(headers: string[], rows: unknown[][]) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("mps-process-cycles");
    sheet.addRow(headers);
    rows.forEach((row) => sheet.addRow(row));
    return { originalname: "import.xlsx", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) } as Express.Multer.File;
  }

  it("rejects encrypted workbooks with the unified message before parsing", async () => {
    const file = { originalname: "encrypted.xlsx", buffer: Buffer.from([0x88, 0x7d, 0x1c, 0x00]) } as Express.Multer.File;
    await expect(service.preview("mps-shipping-plans", file, actor)).rejects.toEqual(expect.objectContaining<Partial<BadRequestException>>({ message: ENCRYPTED_SPREADSHEET_MESSAGE }));
  });

  it("exports stable record identity, version and authorized fields", async () => {
    queries.exportRows.mockResolvedValue({ visibleFields: ["orderNumber", "itemCode"], rows: [{ id: "row-1", version: 3, orderNumber: "000123", itemCode: "0009" }] });
    const buffer = await service.export("mps-monthly-plans", {}, actor);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getRow(1).values).toEqual([undefined, "记录ID", "版本", "订单编号", "品项编码"]);
    const notes = workbook.getWorksheet("填写说明")!;
    expect(notes.getCell("A1").text).toContain("新增导入时留空");
    expect(notes.getCell("A2").text).toContain("更新导入时必须保留导出时的版本");
    expect(sheet.getRow(2).getCell(3).text).toBe("000123");
  });

  it("treats blank record ID and version as new rows for every shared table importer", async () => {
    application.validateImportUpdates.mockResolvedValue([]);
    const file = await workbookFile(
      ["记录ID", "版本", "品项编码", "技术周期"],
      [["", "", "ITEM-001", 1], ["", "", "ITEM-002", 2], ["", "", "ITEM-003", 3]]
    );

    const result = await service.preview("mps-process-cycles", file, actor);

    expect(result.total).toBe(3);
    expect(result.errors).toEqual([]);
    expect(result.token).toEqual(expect.any(String));
    expect(application.validateImportUpdates).toHaveBeenCalledWith("mps-process-cycles", expect.arrayContaining([
      expect.objectContaining({ row: 2, id: null, expectedVersion: null, values: expect.objectContaining({ itemCode: "ITEM-001" }) })
    ]), actor);
  });

  it("rejects rows that fill only one of record ID and version", async () => {
    application.validateImportUpdates.mockResolvedValue([]);
    const file = await workbookFile(["记录ID", "版本", "品项编码"], [["11111111-1111-4111-8111-111111111111", "", "ITEM-001"]]);

    const result = await service.preview("mps-process-cycles", file, actor);

    expect(result.token).toBeNull();
    expect(result.errors).toContainEqual({ row: 2, reason: "新增时记录ID和版本都应留空；更新时必须同时填写" });
  });

  it("returns separate create and update totals after confirmation", async () => {
    application.validateImportUpdates.mockResolvedValue([]);
    application.importUpdates.mockResolvedValue({ total: 1, created: 1, updated: 0, repeated: false });
    const file = await workbookFile(["记录ID", "版本", "品项编码"], [["", "", "ITEM-001"]]);
    const preview = await service.preview("mps-process-cycles", file, actor);

    await expect(service.confirm("mps-process-cycles", preview.token!, actor)).resolves.toEqual(expect.objectContaining({ created: 1, updated: 0 }));
  });
});
