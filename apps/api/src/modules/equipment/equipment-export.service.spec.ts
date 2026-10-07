import { equipmentDashboardExportDefinitions, equipmentDashboardExportTables, equipmentDashboardFilename } from "@kdos/contracts";
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
  expect(workbook.getWorksheet("填写说明")!.getColumn(1).values.some((value) => String(value).includes("近10天（含今天，即今天及之前9天，北京时间）"))).toBe(true);
  expect(workbook.getWorksheet("填写说明")!.getColumn(1).values.some((value) => String(value).includes("稼动率 = 实际运行时长 ÷ 计划运行时间 × 100%"))).toBe(true);
});
it("rejects read-only users and permissions for another table", async () => {
  await expect(service.statusTemplate(actor("equipment-status-report:*:read"))).rejects.toThrow("权限");
  await expect(service.statusTemplate(actor("equipment-register:*:create"))).rejects.toThrow("权限");
});

describe("equipment dashboard XLSX exports", () => {
  const administrator: EquipmentActor = { tenantId: "KAINAN", userId: null, username: "test", isSystemAdmin: true, permissions: ["*"], tableDataScopes: [], requestId: "dashboard-export" };
  const row = { equipmentId: "technical-id", division: "凯南事业四部", divisionName: "凯南事业四部", department: "五金车间", usageDepartmentName: "五金车间", equipmentCode: "00001", equipmentName: "设备甲", responsibleUsers: [{ id: "user-id", displayName: "张三" }, { id: "user-2", displayName: "李四" }], expectedEquipmentCount: 10, filledEquipmentCount: 7, unfilledEquipmentCount: 3, reportingRate: 70, equipmentCount: 10, normalCount: 5, faultCount: 1, idleCount: 1, unreportedCount: 3, plannedRuntimeMinutes: 480, runtimeMinutes: 600, utilizationRate: 125, faultMinutes: 0, runtimeDailyAverageMinutes: 60, faultDailyAverageMinutes: null, __operations: "never export", createdAt: "technical-time" };
  const setup = (rows = [row]) => {
    const data = { windowStart: "2026-10-01", windowEnd: "2026-10-06", unreportedEquipmentRows: rows, divisionRows: rows, departmentRows: rows, equipmentRows: rows, operationsMonitoring: { yesterdayDivisionRows: rows, yesterdayDepartmentRows: rows } };
    const queries = { dashboard: jest.fn().mockResolvedValue(data), dashboardFieldReadable: jest.fn().mockReturnValue(true) };
    const application = { recordDashboardExport: jest.fn().mockResolvedValue(undefined) };
    return { service: new EquipmentExportService(queries as any, application as any), queries, application };
  };
  it.each(equipmentDashboardExportTables)("exports %s with Chinese headers, only business columns and an English date filename", async table => {
    const { service, application } = setup(); const result = await service.dashboardExport(table, {}, administrator);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(result.buffer as any); const sheet = book.worksheets[0]!;
    expect(sheet.getRow(1).values).toEqual([undefined, ...equipmentDashboardExportDefinitions[table].columns.map(column => column.label)]);
    expect(sheet.columnCount).toBe(equipmentDashboardExportDefinitions[table].columns.length);
    expect(result.filename).toBe(equipmentDashboardFilename(table, "2026-10-06"));
    expect(application.recordDashboardExport).toHaveBeenCalledWith(table, 1, "2026-10-01", "2026-10-06", administrator);
  });
  it("keeps numeric minutes, real percentages above 100%, leading zeros, and empty null cells", async () => {
    const { service } = setup([{ ...row, plannedRuntimeMinutes: null as any, faultMinutes: undefined as any }]);
    const result = await service.dashboardExport("utilization_detail", {}, administrator);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(result.buffer as any); const sheet = book.worksheets[0]!;
    expect(sheet.getCell("C2").value).toBe("00001"); expect(sheet.getCell("C2").numFmt).toBe("@");
    expect(sheet.getCell("E2").value).toBeNull(); expect(sheet.getCell("H2").value).toBeNull();
    expect(sheet.getCell("F2").value).toBe(600); expect(sheet.getCell("G2").value).toBe(1.25); expect(sheet.getCell("G2").numFmt).toBe("0.0%");
  });
  it("exports all 100 records with pageSize20 and reuses the dashboard filter arguments", async () => {
    const { service, queries } = setup(Array.from({ length: 100 }, (_, index) => ({ ...row, equipmentCode: String(index).padStart(5, "0") })));
    const filters = { periodType: "custom", startDate: "2026-10-01", endDate: "2026-10-06", divisionId: "division", departmentId: ["department"], page: 1, pageSize: 20 };
    const result = await service.dashboardExport("utilization_detail", filters, administrator);
    expect(queries.dashboard).toHaveBeenCalledWith(filters, administrator, "export");
    const book = new ExcelJS.Workbook(); await book.xlsx.load(result.buffer as any); expect(book.worksheets[0]!.rowCount).toBe(101);
  });
  it("resolves member names and trims fields using the existing field authorization", async () => {
    const { service, queries } = setup(); queries.dashboardFieldReadable.mockImplementation((_actor, field) => field === "responsibleUserIds");
    const result = await service.dashboardExport("unreported", {}, administrator);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(result.buffer as any);
    expect(book.worksheets[0]!.getCell("A1").value).toBe("责任人"); expect(book.worksheets[0]!.getCell("A2").value).toBe("张三、李四"); expect(book.worksheets[0]!.columnCount).toBe(1);
  });
  it("rejects empty data, missing readable fields, and unknown tables without downloading a blank workbook", async () => {
    await expect(setup([]).service.dashboardExport("unreported", {}, administrator)).rejects.toThrow("暂无可导出数据");
    const { service, queries, application } = setup(); queries.dashboardFieldReadable.mockReturnValue(false);
    await expect(service.dashboardExport("unreported", {}, administrator)).rejects.toThrow("没有可导出字段");
    await expect(service.dashboardExport("constructor", {}, administrator)).rejects.toThrow("不支持"); expect(application.recordDashboardExport).not.toHaveBeenCalled();
  });
});
