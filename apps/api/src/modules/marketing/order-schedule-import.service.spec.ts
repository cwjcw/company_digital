import ExcelJS from "exceljs";
import { MarketingApplicationService } from "./marketing.application.service";
import { OrderScheduleImportService, scheduleColumns } from "./order-schedule-import.service";
const actor = { userId: "user-1", username: "tester", tenantCode: "KAINAN", permissions: ["*"], requestId: "test" };
const repository = { tenantId: jest.fn().mockResolvedValue("tenant"), listSchedules: jest.fn().mockResolvedValue([]), importSchedules: jest.fn().mockResolvedValue({ imported: 1, repeated: false }) };
const application = new MarketingApplicationService(repository as any, {} as any);
const service = new OrderScheduleImportService(application);
async function file(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("订单排期");
  sheet.addRow(scheduleColumns.map(([label]) => label)); rows.forEach((row) => sheet.addRow(row));
  return { originalname: "test.xlsx", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) } as Express.Multer.File;
}
const valid = ["001", "00012", "00034", "产品", "2026-09-08", "12.5000", "生产一部", "50"];
beforeEach(() => { jest.clearAllMocks(); process.env.JWT_ACCESS_SECRET = "test-import-signature"; repository.listSchedules.mockResolvedValue([]); });
it("round trips the template, preserves leading zeroes, and confirms only signed rows", async () => {
  const template = await service.template(actor); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(template as any);
  expect(workbook.getWorksheet("订单排期")!.getRow(1).values).toContain("订单编号");
  const preview = await service.preview(await file([valid]), actor);
  expect(preview.errors).toEqual([]); expect(preview.rows[0]).toMatchObject({ orderNumber: "00012", itemNumber: "00034", orderTotalQuantity: "12.5000" });
  await expect(service.confirm(preview.token!, actor)).resolves.toEqual({ imported: 1, repeated: false });
  await expect(service.confirm(`${preview.token}x`, actor)).rejects.toThrow("失效");
  await expect(service.confirm(preview.token!, { ...actor, userId: "other" })).rejects.toThrow("不属于");
});
it("reports row numbers for duplicates, invalid dates, and invalid quantities without writing", async () => {
  const bad = [...valid]; bad[4] = "2026-02-30";
  const quantity = [...valid]; quantity[5] = "abc";
  const preview = await service.preview(await file([valid, valid, bad, quantity]), actor);
  expect(preview.token).toBeNull(); expect(preview.errors).toEqual(expect.arrayContaining([
    { row: 3, reason: expect.stringContaining("重复") }, { row: 4, reason: expect.stringContaining("客户交期") }, { row: 5, reason: expect.stringContaining("订单总数量") }
  ])); expect(repository.importSchedules).not.toHaveBeenCalled();
});
it("rejects unsupported files, formulas, and unauthorized import", async () => {
  await expect(service.preview({ originalname: "bad.csv", buffer: Buffer.from("x") } as any, actor)).rejects.toThrow("xlsx");
  const row = [...valid] as unknown[]; row[5] = { formula: "1+1", result: 2 };
  expect((await service.preview(await file([row]), actor)).errors).toEqual(expect.arrayContaining([{ row: 2, reason: expect.stringContaining("公式") }]));
  await expect(service.template({ ...actor, permissions: ["order-schedule:*:read"] })).rejects.toThrow("操作权限");
});
it("checks import field and own-row scopes", async () => {
  const restricted = { ...actor, permissions: ["order-schedule:*:import"], tableDataScopes: [{ resource: "order-schedule", groupId: "group", scope: "OWN", match: "ALL" as const, rules: [] }] };
  const preview = await service.preview(await file([valid]), restricted);
  expect(preview.errors[0]?.reason).toContain("编辑权限");
  repository.listSchedules.mockResolvedValue([{ id: "id", version: 1, orderNumber: "00012", itemNumber: "00034", createdBy: "other" }] as never);
  expect((await service.preview(await file([valid]), restricted)).errors[0]?.reason).toContain("数据权限");
});

it("rolls back the whole batch on stale version and returns the prior result on repeat", async () => {
  const { DrizzleMarketingRepository } = await import("./drizzle-marketing.repository");
  const queries: string[] = [];
  let repeated = false;
  const client = { release: jest.fn(), query: jest.fn(async (sql: string) => {
    queries.push(sql);
    if (sql.startsWith("SELECT result")) return { rowCount: repeated ? 1 : 0, rows: repeated ? [{ result: { imported: 1, repeated: false } }] : [] };
    if (sql.startsWith("SELECT * FROM marketing.order_schedules")) return { rowCount: 1, rows: [{ id: "existing", version: 2 }] };
    return { rows: [], rowCount: 0 };
  }) };
  const adapter = new DrizzleMarketingRepository({ pool: { connect: async () => client } } as any);
  const rows = [{ row: 2, input: { customerCode: "C", orderNumber: "O", itemNumber: "I", itemName: "N", orderTotalQuantity: "1", completionRatio: "0" }, id: "existing", expectedVersion: 1 }];
  await expect(adapter.importSchedules("tenant", rows, "hash", actor)).rejects.toThrow("第 2 行数据已变化");
  expect(queries).toContain("ROLLBACK"); expect(queries).not.toContain("COMMIT");
  repeated = true; queries.length = 0;
  await expect(adapter.importSchedules("tenant", rows, "hash", actor)).resolves.toEqual({ imported: 1, repeated: true });
  expect(queries).toContain("COMMIT"); expect(queries.some((sql) => sql.startsWith("UPDATE"))).toBe(false);
});
