import ExcelJS from "exceljs";
import { TableFilterRegistry, type TableFilterActor } from "../filtering/table-filter.registry";
import { TablePrintService } from "./table-print.service";
import { MasterPlanFilterSourceProvider } from "../../modules/master-plan-system/master-plan.filter-sources";

const code = "mps-process-reports";
const admin: TableFilterActor = { tenantId: "KAINAN", userId: "user", permissions: ["*"], tableDataScopes: [] };
function setup(row: Record<string, unknown>) {
  const registry = new TableFilterRegistry();
  const list = jest.fn().mockResolvedValue({ rows: [row], total: 1 });
  new MasterPlanFilterSourceProvider(registry, { list } as never).onModuleInit();
  return { service: new TablePrintService(registry, {} as never), list };
}
async function sheet(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never); return workbook.worksheets[0]!;
}

describe("标准导出跟随页面展示", () => {
  it("实际报工使用页面中文工序字典、日期、原始数量和当前列顺序，不输出隐藏列/技术ID", async () => {
    const { service, list } = setup({ id: "row", orderNumber: "SO", processCode: "welding", productionQuantity: "2.0000", productionDate: "2026-10-30T00:00:00.000Z", exceptionText: "隐藏" });
    const result = await sheet(await service.exportXlsx(code, {
      columnKeys: ["productionDate", "processCode", "productionQuantity", "orderNumber", "id", "tenantId", "password"],
      context: { view: "ACTUAL" }, search: "SO", sortField: "productionDate", sortOrder: "desc"
    }, admin));
    expect(result.getRow(1).values).toEqual([undefined, "生产日期", "工序", "报工数量", "订单编号"]);
    expect(result.getRow(2).values).toEqual([undefined, "2026-10-30", "焊接", "2.0000", "SO"]);
    expect(list.mock.calls[0]?.[1]).toMatchObject({ view: "ACTUAL", search: "SO", sortField: "productionDate", sortOrder: "desc" });
    expect(typeof list.mock.calls[0]?.[3]).toBe("function");
  });

  it("待报工导出使用任务列而非实际报工列，派生字段遵循原有读取权限", async () => {
    const { service, list } = setup({ id: "task", processCode: "packaging", remainingQuantity: "6.0000", cumulativeReportedQuantity: "4.0000", productionQuantity: null });
    const principal = { ...admin, permissions: [`${code}:*:read`, `${code}:*:export`, `${code}:processCode:read`] };
    const result = await sheet(await service.exportXlsx(code, {
      context: { view: "PENDING" }, columnKeys: ["remainingQuantity", "processCode", "cumulativeReportedQuantity", "productionQuantity"], sortField: "remainingQuantity", sortOrder: "asc"
    }, principal));
    expect(result.getRow(1).values).toEqual([undefined, "剩余数量", "工序", "累计报工"]);
    expect(result.getRow(2).values).toEqual([undefined, "6.0000", "包装", "4.0000"]);
    expect(list.mock.calls[0]?.[1].view).toBe("PENDING");
  });

  it("明确空列集合或无可读字段不会回退导出全部列", async () => {
    const { service, list } = setup({ id: "row", orderNumber: "SO" });
    await expect(service.exportXlsx(code, { columnKeys: "" }, admin)).rejects.toThrow("没有可导出字段");
    await expect(service.exportXlsx(code, { columnKeys: ["orderNumber"] }, { ...admin, permissions: [`${code}:*:read`, `${code}:*:export`] })).rejects.toThrow("没有可导出字段");
    expect(list).not.toHaveBeenCalled();
  });

  it("待报工尚未填写的输入格导出为空白，不伪造报工数量或生产日期", async () => {
    const { service } = setup({ id: "task", pendingTask: true, productionQuantity: null, productionDate: null, exceptionText: null });
    const result = await sheet(await service.exportXlsx(code, { context: { view: "PENDING" }, columnKeys: ["productionQuantity", "productionDate", "exceptionText"] }, admin));
    expect(result.getCell("A2").text).toBe("");
    expect(result.getCell("B2").text).toBe("");
    expect(result.getCell("C2").text).toBe("");
  });

  it("当前可见审计时间可以导出，基础计划定位条件沿用页面上下文", async () => {
    const { service, list } = setup({ id: "row", createdAt: "2026-10-30T00:00:00.000Z" });
    const result = await sheet(await service.exportXlsx("mps-weekly-plans", { columnKeys: ["createdAt"], context: { basePlanId: "base" } }, admin));
    expect(result.columnCount).toBe(1);
    expect(result.getCell("A2").text).toBe("2026-10-30 08:00:00");
    expect(list.mock.calls[0]?.[1].basePlanId).toBe("base");
  });

  it("工单组合生产日期与周计划百分比复用页面展示口径", async () => {
    const { service } = setup({ id: "row", productionStartDate: "2026-10-30T00:00:00.000Z", productionEndDate: "2026-10-31T00:00:00.000Z", bendingProductionProgress: "0.7143" });
    const range = await sheet(await service.exportXlsx("mps-three-day-work-orders", { columnKeys: ["productionDateRange"] }, admin));
    expect(range.getCell("A1").text).toBe("生产日期");
    expect(range.getCell("A2").text).toBe("2026-10-30 → 2026-10-31");
    const progress = await sheet(await service.exportXlsx("mps-weekly-plans", { columnKeys: ["bendingProductionProgress"] }, admin));
    expect(progress.getCell("A2").text).toBe("71.4%");
  });
});
