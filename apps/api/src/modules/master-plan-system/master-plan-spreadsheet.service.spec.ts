import { BadRequestException } from "@nestjs/common";
import ExcelJS from "exceljs";
import { ENCRYPTED_SPREADSHEET_MESSAGE } from "../../spreadsheet-upload";
import { MasterPlanSpreadsheetService } from "./master-plan-spreadsheet.service";

const actor = { tenantId: "KAINAN", userId: "11111111-1111-4111-8111-111111111111", username: "tester", permissions: ["*"], isSystemAdmin: true, moduleAdminCodes: [], tableDataScopes: [], requestId: "request-1", source: "web" as const };

describe("MasterPlanSpreadsheetService", () => {
  const queries = { exportRows: jest.fn() };
  const application = { validateImportUpdates: jest.fn(), importUpdates: jest.fn(), importBlockedReason: jest.fn().mockResolvedValue(null) };
  const directory = { listEnabled: jest.fn().mockResolvedValue([]), resolve: jest.fn() };
  const service = new MasterPlanSpreadsheetService(queries as never, application as never, directory as never);

  beforeEach(() => { jest.clearAllMocks(); application.importBlockedReason.mockResolvedValue(null); process.env.JWT_ACCESS_SECRET = "test-secret"; });

  async function workbookFile(headers: string[], rows: unknown[][]) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("mps-process-cycles");
    sheet.addRow(headers);
    rows.forEach((row) => sheet.addRow(row));
    return { originalname: "import.xlsx", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) } as Express.Multer.File;
  }

  it("rejects encrypted workbooks with the unified message before parsing", async () => {
    const file = { originalname: "encrypted.xlsx", buffer: Buffer.from([0x88, 0x7d, 0x1c, 0xd6, 0x56, 0x02]) } as Express.Multer.File;
    await expect(service.preview("mps-shipping-plans", file, actor)).rejects.toEqual(expect.objectContaining<Partial<BadRequestException>>({ message: ENCRYPTED_SPREADSHEET_MESSAGE }));
  });

  it("checks import permission before attempting to parse the workbook", async () => {
    const denied = { ...actor, isSystemAdmin: false, permissions: [] };
    await expect(service.preview("mps-shipping-plans", { originalname: "broken.xlsx", buffer: Buffer.from("broken") } as Express.Multer.File, denied)).rejects.toThrow("当前权限组没有该表导入权限");
  });

  it("returns the unified message for unreadable non-encrypted workbooks", async () => {
    await expect(service.preview("mps-shipping-plans", { originalname: "broken.xlsx", buffer: Buffer.from("not-an-excel-file") } as Express.Multer.File, actor)).rejects.toThrow("Excel 未解密或文件损坏，请解密或检查确保文件正确后导入。");
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

  it("writes stable field keys and authoritative dropdowns into new templates", async () => {
    directory.listEnabled.mockResolvedValue([{ id: "22222222-2222-4222-8222-222222222222", name: "事业一部", pathLabel: "凯南 / 事业一部", path: ["凯南", "事业一部"] }]);
    const buffer = await service.template("mps-shipping-plans", actor);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never);
    const schema = workbook.getWorksheet("_字段定义")!; const options = workbook.getWorksheet("_选项")!;
    expect(schema.state).toBe("veryHidden"); expect(options.state).toBe("veryHidden");
    expect(schema.getColumn(1).values).toEqual(expect.arrayContaining(["id", "version", "divisionId", "modelAge"]));
    const sheet = workbook.getWorksheet("mps-shipping-plans")!;
    const divisionColumn = (sheet.getRow(1).values as unknown[]).findIndex((value) => value === "承接事业部");
    const modelAgeColumn = (sheet.getRow(1).values as unknown[]).findIndex((value) => value === "新旧款");
    expect(sheet.getCell(2, divisionColumn).dataValidation.type).toBe("list");
    expect(sheet.getCell(2, modelAgeColumn).dataValidation.type).toBe("list");
    expect(options.getColumn(1).values.flat()).toEqual(expect.arrayContaining(["凯南 / 事业一部"]));
  });

  it.each(["mps-shipping-plans", "mps-base-plans"])("uses 下单日期 in new %s templates", async (resource) => {
    const buffer = await service.template(resource, actor);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never);
    const headers = workbook.getWorksheet(resource)!.getRow(1).values as unknown[];
    expect(headers).toContain("下单日期");
    expect(headers).not.toContain("订单日期");
  });

  it("accepts the historical 订单日期 header as the orderDate alias", async () => {
    application.validateImportUpdates.mockResolvedValue([]);
    const file = await workbookFile(["记录ID", "版本", "品项编码", "订单日期"], [["", "", "ITEM-001", "2026-09-15"]]);
    const result = await service.preview("mps-shipping-plans", file, actor);
    expect(result.errors).toEqual([]);
    expect(application.validateImportUpdates).toHaveBeenCalledWith("mps-shipping-plans", [expect.objectContaining({ values: expect.objectContaining({ orderDate: "2026-09-15" }) })], actor);
  });

  it("blocks shipping confirmation during the closed window after row validation", async () => {
    application.validateImportUpdates.mockResolvedValue([]);
    application.importBlockedReason.mockResolvedValue("数据校验通过，但当前不在出货计划开放修改时间，暂不能确认导入。");
    const file = await workbookFile(["记录ID", "版本", "品项编码"], [["", "", "ITEM-001"]]);
    const result = await service.preview("mps-shipping-plans", file, actor);
    expect(result).toEqual(expect.objectContaining({ token: null, blockedReason: expect.stringContaining("暂不能确认导入") }));
  });

  it("adds boolean and department Excel validation from metadata", async () => {
    directory.listEnabled.mockResolvedValue([{ id: "22222222-2222-4222-8222-222222222222", name: "事业一部", pathLabel: "凯南 / 事业一部", path: ["凯南", "事业一部"] }]);
    const buffer = await service.template("mps-customer-divisions", actor);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("mps-customer-divisions")!;
    const headers = sheet.getRow(1).values as unknown[];
    expect(sheet.getCell(2, headers.findIndex((value) => value === "主责事业部")).dataValidation.type).toBe("list");
    expect(sheet.getCell(2, headers.findIndex((value) => value === "启用")).dataValidation.type).toBe("list");
    expect(workbook.getWorksheet("_选项")!.getRows(1, 10)?.flatMap((row) => row.values as unknown[])).toEqual(expect.arrayContaining(["是", "否", "凯南 / 事业一部"]));
  });

  it("uses hidden field keys after a display label changes and resolves department paths to UUID", async () => {
    const organization = { id: "22222222-2222-4222-8222-222222222222", name: "事业一部", pathLabel: "凯南 / 事业一部", path: ["凯南", "事业一部"] };
    directory.listEnabled.mockResolvedValue([organization]); directory.resolve.mockImplementation((value: unknown) => value === organization.pathLabel ? organization : null);
    application.validateImportUpdates.mockResolvedValue([]);
    const buffer = await service.template("mps-shipping-plans", actor);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never); const sheet = workbook.getWorksheet("mps-shipping-plans")!;
    const schema = workbook.getWorksheet("_字段定义")!; const keyColumns = new Map<string, number>();
    for (let row = 3; row <= schema.rowCount; row++) keyColumns.set(schema.getCell(row, 1).text, Number(schema.getCell(row, 2).value));
    sheet.getCell(1, keyColumns.get("itemCode")!).value = "后来改过的品项标题";
    sheet.getCell(2, keyColumns.get("itemCode")!).value = "ITEM-1"; sheet.getCell(2, keyColumns.get("divisionId")!).value = organization.pathLabel;
    const file = { originalname: "template.xlsx", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) } as Express.Multer.File;
    const result = await service.preview("mps-shipping-plans", file, actor);
    expect(result.errors).toEqual([]);
    expect(application.validateImportUpdates).toHaveBeenCalledWith("mps-shipping-plans", [expect.objectContaining({ values: expect.objectContaining({ itemCode: "ITEM-1", divisionId: organization.id }) })], actor);
  });

  it("exports a department full path that imports back to the same UUID", async () => {
    const organization = { id: "22222222-2222-4222-8222-222222222222", name: "事业一部", pathLabel: "凯南 / 制造中心 / 事业一部", path: ["凯南", "制造中心", "事业一部"] };
    directory.listEnabled.mockResolvedValue([organization]);
    directory.resolve.mockImplementation((value: unknown) => value === organization.pathLabel ? organization : null);
    queries.exportRows.mockResolvedValue({ visibleFields: ["divisionId", "itemName"], rows: [{ id: "11111111-1111-4111-8111-111111111111", version: 3, divisionId: organization.id, itemName: "品项A" }] });
    application.validateImportUpdates.mockResolvedValue([]);
    const buffer = await service.export("mps-shipping-plans", {}, actor);
    const exported = new ExcelJS.Workbook(); await exported.xlsx.load(buffer as never);
    const sheet = exported.getWorksheet("mps-shipping-plans")!;
    const divisionColumn = (sheet.getRow(1).values as unknown[]).findIndex((value) => value === "承接事业部");
    expect(sheet.getRow(2).getCell(divisionColumn).text).toBe(organization.pathLabel);

    const result = await service.preview("mps-shipping-plans", { originalname: "export.xlsx", buffer } as Express.Multer.File, actor);
    expect(result.errors).toEqual([]);
    expect(application.validateImportUpdates).toHaveBeenCalledWith("mps-shipping-plans", [expect.objectContaining({
      id: "11111111-1111-4111-8111-111111111111", expectedVersion: 3,
      values: expect.objectContaining({ divisionId: organization.id })
    })], actor);
  });
});
