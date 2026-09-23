import { BadRequestException } from "@nestjs/common";
import ExcelJS from "exceljs";
import { ENCRYPTED_SPREADSHEET_MESSAGE } from "../../spreadsheet-upload";
import { MasterPlanSpreadsheetService } from "./master-plan-spreadsheet.service";

const actor = { tenantId: "KAINAN", userId: "11111111-1111-4111-8111-111111111111", username: "tester", permissions: ["*"], isSystemAdmin: true, moduleAdminCodes: [], tableDataScopes: [], requestId: "request-1", source: "web" as const };

describe("MasterPlanSpreadsheetService", () => {
  const previewId = "22222222-2222-4222-8222-222222222222";
  const previewManager = { query: jest.fn() };
  const dataSourceQuery = jest.fn();
  const dataSource = { query: dataSourceQuery, transaction: jest.fn(async (work: (manager: typeof previewManager) => unknown) => work(previewManager)) };
  const queries = { exportRows: jest.fn(), pendingReportRows: jest.fn(async () => ({ rows: [] as Array<Record<string, unknown>>, visibleFields: [] as string[] })) };
  const application = { validateImportUpdates: jest.fn(), importUpdates: jest.fn(), importBlockedReason: jest.fn().mockResolvedValue(null) };
  const directory = { listEnabled: jest.fn().mockResolvedValue([]), resolve: jest.fn() };
  const service = new MasterPlanSpreadsheetService(dataSource as never, queries as never, application as never, directory as never);

  beforeEach(() => {
    jest.clearAllMocks(); application.importBlockedReason.mockResolvedValue(null);
    previewManager.query.mockImplementation((sql: string) => sql.startsWith("INSERT") ? [{ id: previewId }] : []);
  });

  async function workbookFile(headers: string[], rows: unknown[][]) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("mps-process-cycles");
    sheet.addRow(headers);
    rows.forEach((row) => sheet.addRow(row));
    return { originalname: "import.xlsx", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) } as Express.Multer.File;
  }

  describe("KN-MPS-WO-001 3天生产工单 Excel", () => {
    it("导出：两列日期、无交期编码、无合并范围列、记录ID/版本隐藏且日期为真实日期单元格", async () => {
      queries.exportRows.mockResolvedValue({
        visibleFields: ["customerCode", "orderNumber", "productionStartDate", "productionEndDate", "remark", "processingRemark", "productionDateRange", "weeklyPlanId"],
        rows: [{ id: "row-1", version: 3, customerCode: "0001", orderNumber: "O001", productionStartDate: "2026-09-20", productionEndDate: "2026-09-22", remark: "加急", processingRemark: "先做A面", productionDateRange: "2026-09-20 ～ 2026-09-22", weeklyPlanId: "33333333-3333-4333-8333-333333333333" }]
      });
      const buffer = await service.export("mps-three-day-work-orders", {}, actor);
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never);
      const sheet = workbook.worksheets[0]!;
      const headers = sheet.getRow(1).values as unknown[];
      expect(headers).toContain("生产开始日期");
      expect(headers).toContain("生产结束日期");
      /* 用户确认：Excel 不出现交期编码，也不出现服务端合并的「生产日期」范围列与来源周计划 UUID。 */
      expect(headers).not.toContain("交期编码");
      expect(headers).not.toContain("生产日期");
      expect(headers).not.toContain("来源周计划");
      /* 记录ID/版本保留但隐藏（导入仍按 ID+version 定位）。 */
      expect(sheet.getColumn(1).hidden).toBe(true);
      expect(sheet.getColumn(2).hidden).toBe(true);
      /* 日期按 yyyy-mm-dd 的真实日期单元格导出。 */
      const startCell = sheet.getRow(2).getCell(headers.indexOf("生产开始日期"));
      expect(startCell.value).toBeInstanceOf(Date);
      expect(startCell.numFmt).toBe("yyyy-mm-dd");
      /* 4 个人工列为「可填写区域」，来源列无底纹。 */
      const remarkCell = sheet.getRow(2).getCell(headers.indexOf("备注"));
      expect(remarkCell.fill && (remarkCell.fill as { fgColor?: { argb?: string } }).fgColor?.argb).toBe("FFFFF7E0");
      const orderCell = sheet.getRow(2).getCell(headers.indexOf("订单编号"));
      expect((orderCell.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb).toBeUndefined();
      /* 填写说明写清可填写列与单日/空值规则。 */
      const notes = workbook.getWorksheet("填写说明")!;
      const noteText = notes.getColumn(1).values.join("\n");
      expect(noteText).toContain("Excel 不能新增工单");
      expect(noteText).toContain("浅黄色底色");
      expect(noteText).toContain("填写同一天");
    });

    it("导入：只有 4 个人工列可写，来源列不会写回；空记录ID新增被明确拒绝", async () => {
      application.validateImportUpdates.mockResolvedValue([]);
      const file = await workbookFile(
        ["记录ID", "版本", "生产开始日期", "生产结束日期", "备注", "加工备注", "订单编号", "品项编码", "需求数量"],
        [["", "", "2026-09-20", "2026-09-22", "加急", "先做A面", "O001", "P001", 100]]
      );
      await service.preview("mps-three-day-work-orders", file, actor);
      const called = application.validateImportUpdates.mock.calls.at(-1)!;
      /* 只有人工字段进入待写入值；来源列被忽略（即使 Excel 里有值）。 */
      expect(Object.keys(called[1][0].values).sort()).toEqual(["processingRemark", "productionEndDate", "productionStartDate", "remark"]);
      /* 空身份行按“新增”进入校验（真实 application service 会在 create 闸门拒绝并提示先同步，见 work-order-validation 用例）。 */
      expect(called[1][0]).toMatchObject({ id: null, expectedVersion: null });
    });
  });

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

  it("exports weekly production progress as numeric ratio cells with the frontend percentage format", async () => {
    queries.exportRows.mockResolvedValue({
      visibleFields: ["cuttingProductionProgress", "machiningProductionProgress"],
      rows: [{ id: "row-1", version: 1, cuttingProductionProgress: "0.7143", machiningProductionProgress: 1 }]
    });
    const buffer = await service.export("mps-weekly-plans", {}, actor);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("mps-weekly-plans")!;
    const headers = sheet.getRow(1).values as unknown[];
    const cutting = sheet.getCell(2, headers.indexOf("下料·生产进度"));
    const machining = sheet.getCell(2, headers.indexOf("机加·生产进度"));
    expect(cutting.value).toBe(0.7143);
    expect(typeof cutting.value).toBe("number");
    expect(cutting.numFmt).toBe("0.#%");
    expect(machining.value).toBe(1);
    expect(machining.numFmt).toBe("0.#%");
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
    expect(result.previewId).toBe(previewId);
    expect(application.validateImportUpdates).toHaveBeenCalledWith("mps-process-cycles", expect.arrayContaining([
      expect.objectContaining({ row: 2, id: null, expectedVersion: null, values: expect.objectContaining({ itemCode: "ITEM-001" }) })
    ]), actor);
  });

  it("rejects rows that fill only one of record ID and version", async () => {
    application.validateImportUpdates.mockResolvedValue([]);
    const file = await workbookFile(["记录ID", "版本", "品项编码"], [["11111111-1111-4111-8111-111111111111", "", "ITEM-001"]]);

    const result = await service.preview("mps-process-cycles", file, actor);

    expect(result.previewId).toBeNull();
    expect(result.errors).toContainEqual({ row: 2, reason: "新增时记录ID和版本都应留空；更新时必须同时填写" });
  });

  it("returns separate create and update totals after confirmation", async () => {
    application.validateImportUpdates.mockResolvedValue([]);
    application.importUpdates.mockResolvedValue({ total: 1, created: 1, updated: 0, repeated: false });
    const file = await workbookFile(["记录ID", "版本", "品项编码"], [["", "", "ITEM-001"]]);
    const preview = await service.preview("mps-process-cycles", file, actor);

    previewManager.query.mockImplementation((sql: string) => {
      if (sql.startsWith("SELECT * FROM mps_import_previews")) return [{ id: previewId, file_hash: "hash", payload_json: { rows: [{ id: null, expectedVersion: null, values: { itemCode: "ITEM-001" } }] }, confirmed_at: null }];
      return sql.startsWith("INSERT") ? [{ id: previewId }] : [];
    });
    await expect(service.confirm("mps-process-cycles", preview.previewId!, actor)).resolves.toEqual(expect.objectContaining({ created: 1, updated: 0 }));
  });

  it("binds preview confirmation to its tenant, user and resource", async () => {
    previewManager.query.mockResolvedValue([]);
    await expect(service.confirm("mps-process-cycles", previewId, { ...actor, tenantId: "OTHER" })).rejects.toThrow("导入预览已过期、无权访问或不存在");
    await expect(service.confirm("mps-shipping-plans", previewId, actor)).rejects.toThrow("导入预览已过期、无权访问或不存在");
    await expect(service.confirm("mps-process-cycles", previewId, { ...actor, userId: "33333333-3333-4333-8333-333333333333" })).rejects.toThrow("导入预览已过期、无权访问或不存在");
  });

  it("returns a clear expiry message when the short-lived preview no longer exists", async () => {
    previewManager.query.mockResolvedValue([]);
    await expect(service.confirm("mps-process-cycles", previewId, actor)).rejects.toThrow("导入预览已过期、无权访问或不存在，请重新上传。");
  });

  it("returns the persisted result instead of executing a confirmed preview twice", async () => {
    previewManager.query.mockImplementation((sql: string) => sql.startsWith("SELECT * FROM mps_import_previews")
      ? [{ confirmed_at: new Date(), confirmation_result: { total: 1, created: 1, updated: 0 } }] : []);
    await expect(service.confirm("mps-process-cycles", previewId, actor)).resolves.toEqual({ total: 1, created: 1, updated: 0, repeated: true });
    expect(application.importUpdates).not.toHaveBeenCalled();
  });

  it("keeps a 1255-row preview server-side and returns only a short preview identifier", async () => {
    application.validateImportUpdates.mockResolvedValue([]);
    const file = await workbookFile(["记录ID", "版本", "品项编码"], Array.from({ length: 1255 }, (_, index) => ["", "", `ITEM-${index}`]));
    const result = await service.preview("mps-process-cycles", file, actor);
    expect(result).toEqual(expect.objectContaining({ total: 1255, previewId }));
    expect(JSON.stringify(result)).not.toContain("ITEM-1254");
    expect(application.validateImportUpdates).toHaveBeenCalledWith("mps-process-cycles", expect.arrayContaining([expect.objectContaining({ values: { itemCode: "ITEM-1254" } })]), actor);
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
    expect(result).toEqual(expect.objectContaining({ previewId: null, blockedReason: expect.stringContaining("暂不能确认导入") }));
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

  describe("pending process report import", () => {
    const taskId = "33333333-3333-4333-8333-333333333333";
    const weeklyPlanId = "44444444-4444-4444-8444-444444444444";
    const pendingRow = {
      id: taskId, version: 4, weeklyPlanId, processCode: "bending", processName: "折弯",
      orderNumber: "2026A027192", itemCode: "TGG919BDP-1/1", itemName: "品项", plannedQuantity: "100.0000",
      cumulativeReportedQuantity: "40.0000", remainingQuantity: "60.0000"
    };

    beforeEach(() => {
      queries.pendingReportRows.mockResolvedValue({ rows: [pendingRow], visibleFields: [] });
      previewManager.query.mockImplementation((sql: string) => sql.startsWith("INSERT") ? [{ id: previewId }] : []);
      dataSourceQuery.mockImplementation((sql: string, params: unknown[]) => sql.startsWith("SELECT task.id,task.version")
        ? (String(params[1]) === taskId ? [{ id: taskId, version: 4, weekly_plan_id: weeklyPlanId, process_code: "bending" }] : [])
        : []);
    });

    it("builds the pending template from the same authoritative field definition, in the approved order", async () => {
      const buffer = await service.template("mps-process-reports", actor, "PENDING");
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never);
      const sheet = workbook.worksheets[0]!;
      expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual([
        "记录ID", "版本", "订单编号", "品项编码", "品项名称", "工序", "计划数量", "累计报工", "剩余数量", "本次报工数量", "生产日期", "异常"
      ]);
      /* 模板预置当前待报工任务，只有本次报工数量与生产日期是空白待填。 */
      expect(sheet.getRow(2).getCell(3).text).toBe("2026A027192");
      expect(sheet.getRow(2).getCell(9).text).toBe("60.0000");
      /* 字典列按用户看到的 label 展示（工序=bending 显示为折弯），导入时再解析回 value。 */
      expect(sheet.getRow(2).getCell(6).text).toBe("折弯");
      expect(sheet.getRow(2).getCell(10).text).toBe("");
      /* KN-MPS-UI-001：异常是可选人工文本，模板留空。 */
      expect(sheet.getRow(2).getCell(12).text).toBe("");
      expect(workbook.getWorksheet("填写说明")!.getCell("A1").text).toContain("CREATE 报工记录");
      expect((sheet.getRow(1).values as unknown[]).join("|")).not.toContain("操作");
    });

    it("creates a new report row from the task identity, never from order number or Chinese process name", async () => {
      application.validateImportUpdates.mockResolvedValue([]);
      const file = await workbookFile(
        ["记录ID", "版本", "订单编号", "品项编码", "品项名称", "工序", "计划数量", "累计报工", "剩余数量", "本次报工数量", "生产日期", "异常"],
        [[taskId, 4, "2026A027192", "TGG919BDP-1/1", "品项", "折弯", 100, 40, 60, 20, "2026-09-16", "夹具异常"]]
      );
      const result = await service.preview("mps-process-reports", file, actor, "PENDING");

      expect(result.errors).toEqual([]);
      expect(application.validateImportUpdates).toHaveBeenCalledWith("mps-process-reports", [
        expect.objectContaining({ id: null, expectedVersion: null, values: { weeklyPlanId, processCode: "bending", productionDate: "2026-09-16", productionQuantity: "20", exceptionText: "夹具异常" } })
      ], actor);
    });

    it("rejects a stale task version and an unknown task per row before any write", async () => {
      application.validateImportUpdates.mockResolvedValue([]);
      dataSourceQuery.mockImplementation((sql: string, params: unknown[]) => sql.startsWith("SELECT task.id,task.version")
        ? (String(params[1]) === taskId ? [{ id: taskId, version: 5, weekly_plan_id: weeklyPlanId, process_code: "bending" }] : [])
        : []);
      const file = await workbookFile(
        ["记录ID", "版本", "本次报工数量", "生产日期"],
        [[taskId, 4, 20, "2026-09-16"], ["55555555-5555-4555-8555-555555555555", 1, 10, "2026-09-16"]]
      );
      const result = await service.preview("mps-process-reports", file, actor, "PENDING");

      expect(result.previewId).toBeNull();
      expect(result.errors).toEqual([
        { row: 2, reason: "任务版本已变化，请重新下载待报工模板后填写" },
        { row: 3, reason: "待报工任务不存在或不属于当前租户" }
      ]);
      expect(application.validateImportUpdates).not.toHaveBeenCalled();
    });

    it("skips untouched template rows and requires quantity and date together on filled rows", async () => {
      const file = await workbookFile(
        ["记录ID", "版本", "本次报工数量", "生产日期"],
        [[taskId, 4, "", ""], [taskId, 4, "", "2026-09-16"], [taskId, 4, 10, ""]]
      );
      const result = await service.preview("mps-process-reports", file, actor, "PENDING");

      expect(result.errors).toEqual([
        { row: 3, reason: "本次报工数量不能为空" },
        { row: 4, reason: "生产日期不能为空" }
      ]);
    });

    it("parses dictionary labels back to their stable values on import", async () => {
      application.validateImportUpdates.mockResolvedValue([]);
      const file = await workbookFile(
        ["记录ID", "版本", "所属事业部周计划", "工序"],
        [["", "", "", "折弯"]]
      );
      await service.preview("mps-weekly-process-plans", file, actor);

      expect(application.validateImportUpdates).toHaveBeenCalledWith("mps-weekly-process-plans", [
        expect.objectContaining({ values: expect.objectContaining({ processCode: "bending" }) })
      ], actor);
    });

    it("reuses the shared transaction and idempotency pipeline on confirm", async () => {
      application.importUpdates.mockResolvedValue({ total: 1, created: 1, updated: 0, repeated: false });
      /* 用户下载待报工模板后只填写“本次报工数量/生产日期”，其余列保持系统导出值。 */
      const filled = new ExcelJS.Workbook(); await filled.xlsx.load(await service.template("mps-process-reports", actor, "PENDING") as never);
      const sheet = filled.worksheets[0]!; sheet.getRow(2).getCell(10).value = 20; sheet.getRow(2).getCell(11).value = new Date("2026-09-16T00:00:00Z");
      const buffer = Buffer.from(await filled.xlsx.writeBuffer());
      const file = { originalname: "pending.xlsx", buffer } as Express.Multer.File;
      application.validateImportUpdates.mockResolvedValue([]);
      const preview = await service.preview("mps-process-reports", file, actor, "PENDING");
      previewManager.query.mockImplementation((sql: string) => sql.includes("SELECT * FROM mps_import_previews") ? [{ id: previewId, payload_json: { rows: [{ row: 2, id: null, expectedVersion: null, values: { weeklyPlanId, processCode: "bending", productionDate: "2026-09-16", productionQuantity: "20" } }] }, file_hash: "hash-1", confirmed_at: null }] : []);

      await expect(service.confirm("mps-process-reports", preview.previewId!, actor)).resolves.toMatchObject({ created: 1, updated: 0 });
      expect(application.importUpdates).toHaveBeenCalledWith("mps-process-reports", [expect.objectContaining({ id: null, values: expect.objectContaining({ weeklyPlanId, processCode: "bending" }) })], "hash-1", actor);
    });
  });
});
