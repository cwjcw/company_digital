import { BadRequestException, ForbiddenException } from "@nestjs/common";
import ExcelJS from "exceljs";
import { EquipmentApplicationService } from "./equipment.application.service";
import { EquipmentController } from "./equipment.controller";
import { EquipmentImportService } from "./equipment-import.service";
import { EquipmentQueryService } from "./equipment.query.service";
import { equipmentCreateAllowed, equipmentScope, hasEquipmentPermission, type EquipmentActor } from "./equipment.types";

const actor = (overrides: Partial<EquipmentActor> = {}): EquipmentActor => ({
  tenantId: "KAINAN", userId: "00000000-0000-7000-8000-000000000001", username: "tester",
  permissions: ["equipment-status-report:*:read"], tableDataScopes: [], requestId: "test", ...overrides
});

describe("equipment permissions and validation", () => {
  it("accepts optimistic versions from DELETE query parameters", async () => {
    const application = { disableStatus: jest.fn().mockResolvedValue({ id: "status-1", active: false, version: 4 }) };
    const controller = new EquipmentController(application as never, {} as never, {} as never, {} as never);
    const request = { user: { sub: actor().userId, username: actor().username, permissions: ["*"] }, requestId: "delete-request" } as never;

    await controller.disableStatus("status-1", "3", undefined, request);

    expect(application.disableStatus).toHaveBeenCalledWith("status-1", 3, expect.objectContaining({ requestId: "delete-request" }));
  });

  it("lets an explicit system administrator soft-delete and audit a status record", async () => {
    const report = {
      id: "status-1", tenantId: "KAINAN", divisionOrganizationUnitId: "division-1", createdBy: "another-user",
      equipmentId: "asset-1", reportDate: "2026-09-07", runtimeMinutes: 60, faultMinutes: 0, faultReason: null,
      active: true, version: 3, updatedBy: "creator"
    };
    const queryBuilder = { setLock: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(report) };
    const manager = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      save: jest.fn().mockImplementation((_entity: unknown, value: unknown) => Promise.resolve(value))
    };
    const service = new EquipmentApplicationService({ transaction: jest.fn((work: (value: unknown) => unknown) => work(manager)) } as never);

    await expect(service.disableStatus("status-1", 3, actor({ permissions: [], isSystemAdmin: true }))).resolves.toEqual({ id: "status-1", active: false, version: 4 });
    expect(report).toMatchObject({ active: false, version: 4, updatedBy: actor().userId });
    expect(manager.save).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ action: "equipment.status.disabled", resource: "equipment-status-report" }));
  });

  it("recognizes explicit and wildcard resource permissions", () => {
    expect(hasEquipmentPermission(actor(), "equipment-status-report", "read")).toBe(true);
    expect(hasEquipmentPermission(actor(), "equipment-status-report", "update")).toBe(false);
    expect(hasEquipmentPermission(actor({ permissions: ["*"] }), "equipment-register", "delete")).toBe(true);
    expect(hasEquipmentPermission(actor({ permissions: [], isSystemAdmin: true }), "equipment-status-report", "delete")).toBe(true);
  });

  it("extracts division IDs from EQ and IN rules without widening scope", () => {
    const scoped = equipmentScope(actor({ tableDataScopes: [{
      resource: "equipment-status-report", scope: "CUSTOM", match: "ANY", actions: ["read"], rules: [
        { fieldKey: "divisionId", operator: "EQ", value: "division-1" },
        { fieldKey: "divisionId", operator: "IN", value: ["division-2", "division-3"] },
        { fieldKey: "equipmentName", operator: "EQ", value: "不可用于扩大事业部范围" }
      ]
    }] }), "equipment-status-report", "read");
    expect(scoped).toEqual({ unrestricted: false, divisionIds: ["division-1", "division-2", "division-3"] });
  });

  it("intersects ALL division rules and fails closed for unsupported narrowing rules", () => {
    const common = { resource: "equipment-register", scope: "CUSTOM", match: "ALL", actions: ["read"] };
    expect(equipmentScope(actor({ tableDataScopes: [{ ...common, rules: [
      { fieldKey: "divisionId", operator: "IN", value: ["d1", "d2"] },
      { fieldKey: "divisionId", operator: "EQ", value: "d2" }
    ] }] }), "equipment-register", "read").divisionIds).toEqual(["d2"]);
    expect(equipmentScope(actor({ tableDataScopes: [{ ...common, rules: [
      { fieldKey: "divisionId", operator: "EQ", value: "d2" },
      { fieldKey: "equipmentName", operator: "EQ", value: "精密设备" }
    ] }] }), "equipment-register", "read").divisionIds).toEqual([]);
  });

  it("honors ALL scope and refuses a scope configured for another action", () => {
    const all = equipmentScope(actor({ tableDataScopes: [{ resource: "equipment-dashboard", scope: "ALL", actions: ["read"] }] }), "equipment-dashboard", "read");
    expect(all.unrestricted).toBe(true);
    const none = equipmentScope(actor({ tableDataScopes: [{ resource: "equipment-dashboard", scope: "ALL", actions: ["update"] }] }), "equipment-dashboard", "read");
    expect(none).toEqual({ unrestricted: false, divisionIds: [] });
  });

  it("preserves OWN scope and allows a creator to reference equipment before the new row exists", () => {
    const own = equipmentScope(actor({ tableDataScopes: [{
      resource: "equipment-status-report", scope: "OWN", actions: ["read", "create", "update"]
    }] }), "equipment-status-report", "read");
    expect(own).toEqual({ unrestricted: false, divisionIds: [], own: true });
    const service = new EquipmentApplicationService({} as never) as any;
    /* KN-EQUIP-001：OWN 权限组的新增不受事业部限制（与候选设备范围同源）。 */
    expect(equipmentCreateAllowed(actor({
      permissions: ["equipment-status-report:*:create"],
      tableDataScopes: [{ resource: "equipment-status-report", scope: "OWN", actions: ["create"] }]
    }), "equipment-status-report", "division-1")).toBe(true);
    expect(service).toBeTruthy();
    expect(() => service.assertRecordAccess(actor({
      permissions: ["equipment-status-report:*:update"],
      tableDataScopes: [{ resource: "equipment-status-report", scope: "OWN", actions: ["update"] }]
    }), "equipment-status-report", "update", "division-1", actor().userId)).not.toThrow();
    expect(() => service.assertRecordAccess(actor({
      permissions: ["equipment-status-report:*:update"],
      tableDataScopes: [{ resource: "equipment-status-report", scope: "OWN", actions: ["update"] }]
    }), "equipment-status-report", "update", "division-1", "another-user")).toThrow(ForbiddenException);
  });

  it("accepts the ten-day inclusive Shanghai window and keeps future dates rejected", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-06T04:00:00.000Z"));
    const service = new EquipmentApplicationService({} as never) as any;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const date = new Date(`${today}T00:00:00+08:00`);
    const offset = (days: number) => {
      const value = new Date(date); value.setDate(value.getDate() + days);
      return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
    };
    expect(service.reportDate(today)).toBe(today);
    expect(service.reportDate(offset(-7))).toBe(offset(-7));
    expect(service.reportDate(offset(-8))).toBe(offset(-8));
    expect(service.reportDate(offset(-9))).toBe(offset(-9));
    expect(() => service.reportDate(offset(-10))).toThrow(BadRequestException);
    expect(() => service.reportDate(offset(1))).toThrow(BadRequestException);
    jest.useRealTimers();
  });

  it("keeps multi-row import preview partial when one row is older than the ten-day window", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-06T04:00:00.000Z"));
    const asset = {
      id: "asset-window", tenantId: "KAINAN", divisionOrganizationUnitId: "division-1", divisionNameSnapshot: "事业一部",
      equipmentCode: "A001", equipmentName: "设备甲", active: true, monitored: true
    };
    const manager = {
      find: jest.fn().mockImplementation((entity: { name?: string }) => Promise.resolve(
        entity.name === "OrganizationUnit" ? [{ id: "division-1", name: "事业一部", enabled: true }] : [asset]
      )),
      findOneBy: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([])
      })
    };
    const service = new EquipmentApplicationService({ manager } as never);
    const importActor = actor({ permissions: ["equipment-status-report:*:import"], isSystemAdmin: true });
    const common = { divisionName: "事业一部", equipmentCode: "A001", plannedRuntimeMinutes: 480, runtimeMinutes: 420, faultMinutes: 0, faultReason: null };

    const preview = await service.previewStatusImport([
      { ...common, rowNumber: 2, reportDate: "2026-09-27" },
      { ...common, rowNumber: 3, reportDate: "2026-09-26" }
    ], importActor);

    expect(preview).toMatchObject({ total: 2, createCount: 1, errors: [{ rowNumber: 3 }] });
    expect(preview.rows).toEqual([expect.objectContaining({ rowNumber: 2, reportDate: "2026-09-27" })]);
    expect(preview.errors[0]?.message).toContain("填报日期只能选择 2026-09-27 至 2026-10-06");
    jest.useRealTimers();
  });

  it("stores durations as exact non-negative integer minutes", () => {
    const service = new EquipmentApplicationService({} as never) as any;
    expect(service.minutes(undefined, "实际运行时长")).toBe(0);
    expect(service.minutes(125, "实际运行时长")).toBe(125);
    expect(() => service.minutes(-1, "实际运行时长")).toThrow(BadRequestException);
    expect(() => service.minutes(1.5, "实际运行时长")).toThrow(BadRequestException);
  });

  it("allows a required daily planned runtime of zero while keeping the legacy positive helper strict", () => {
    const service = new EquipmentApplicationService({} as never) as any;
    expect(service.positiveMinutes(600, "计划运行时间")).toBe(600);
    expect(() => service.positiveMinutes(undefined, "计划运行时间")).toThrow("必须填写且必须大于0");
    expect(() => service.positiveMinutes(0, "计划运行时间")).toThrow("必须填写且必须大于0");
    expect(() => service.positiveMinutes(-1, "计划运行时间")).toThrow("必须填写且必须大于0");
    expect(service.requiredMinutes(0, "计划运行时间")).toBe(0);
    expect(() => service.requiredMinutes(undefined, "计划运行时间")).toThrow("必须填写");
  });

  it("previews and confirms a zero planned-runtime status without changing other duration rules", async () => {
    const reportDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    const asset = {
      id: "asset-zero-runtime", tenantId: "KAINAN", divisionOrganizationUnitId: "division-1", divisionNameSnapshot: "事业一部",
      usageDepartmentOrganizationUnitId: null, usageDepartmentNameSnapshot: "生产部", equipmentCode: "KN-020YK005", equipmentName: "设备甲",
      active: true, monitored: true, createdBy: actor().userId, version: 1
    };
    const reportQuery = { setLock: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(null) };
    const dictionaryQuery = { innerJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([]) };
    const manager = {
      find: jest.fn().mockImplementation((entity: { name?: string }) => Promise.resolve(
        entity.name === "OrganizationUnit" ? [{ id: "division-1", name: "事业一部", enabled: true }] : [asset]
      )),
      findOneBy: jest.fn().mockImplementation((entity: { name?: string }) => Promise.resolve(entity.name === "EquipmentAsset" ? asset : null)),
      createQueryBuilder: jest.fn()
        .mockReturnValueOnce(dictionaryQuery)
        .mockReturnValueOnce(reportQuery),
      create: jest.fn((_entity: unknown, value: unknown) => value),
      save: jest.fn().mockImplementation((_entity: unknown, value: unknown) => Promise.resolve(value))
    };
    const dataSource = { manager, transaction: jest.fn((work: (value: unknown) => unknown) => work(manager)) };
    const service = new EquipmentApplicationService(dataSource as never);
    const importActor = actor({ permissions: ["equipment-status-report:*:import"], isSystemAdmin: true });
    const source = { rowNumber: 2, divisionName: "事业一部", equipmentCode: "KN-020YK005", reportDate, plannedRuntimeMinutes: 0, runtimeMinutes: 0, faultMinutes: 0, faultReason: null };

    const preview = await service.previewStatusImport([source], importActor);
    expect(preview).toMatchObject({ errors: [], rows: [expect.objectContaining({ plannedRuntimeMinutes: 0 })] });

    const result = await service.confirmStatusImport([{ ...preview.rows[0]!, equipmentId: asset.id, equipmentName: asset.equipmentName }], "a".repeat(64), importActor);
    expect(result).toMatchObject({ created: 1, updated: 0, unchanged: 0 });
    expect(manager.save).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ plannedRuntimeMinutes: 0, runtimeMinutes: 0, faultMinutes: 0 }));
  });

  it("includes the daily planned runtime in status audit snapshots", () => {
    const service = new EquipmentApplicationService({} as never) as any;
    expect(service.statusAudit({ equipmentId: "asset-1", reportDate: "2026-09-20", plannedRuntimeMinutes: 630, runtimeMinutes: 700, faultMinutes: 0, faultReason: null, active: true, version: 2 })).toMatchObject({ plannedRuntimeMinutes: 630 });
  });

  it("parses supported duration formats during import", () => {
    const service = new EquipmentImportService({} as never) as any;
    expect(service.duration("10小时")).toBe(600);
    expect(service.duration("10小时10分钟")).toBe(610);
    expect(service.duration("10分钟")).toBe(10);
    expect(service.duration("")).toBe(0);
  });

  it("updates an otherwise unchanged workbook row when its responsible members changed", async () => {
    const existing = {
      id: "asset-1", tenantId: "KAINAN", divisionOrganizationUnitId: "division-1", divisionNameSnapshot: "事业三部",
      usageDepartmentOrganizationUnitId: null, usageDepartmentNameSnapshot: "事业三部", equipmentCode: "A1", equipmentName: "设备甲",
      purchaseDate: null, plannedStartupMinutes: 0, monitored: false, active: true, createdBy: actor().userId, version: 1
    };
    const current = { ...existing };
    const queryBuilder = { setLock: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(current) };
    const manager = {
      findOneBy: jest.fn()
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ id: "division-1", name: "事业三部", enabled: true }),
      findBy: jest.fn().mockResolvedValue([{ userId: "old-user" }]),
      count: jest.fn().mockResolvedValue(1), createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      save: jest.fn().mockImplementation((_entity: unknown, value: unknown) => Promise.resolve(value)), delete: jest.fn().mockResolvedValue({})
    };
    const service = new EquipmentApplicationService({ transaction: jest.fn((work: (value: unknown) => unknown) => work(manager)) } as never);

    const result = await service.importWorkbookRows([{
      sourceSheetRow: 2, divisionId: "division-1", usageDepartmentId: null, usageDepartmentName: "事业三部",
      equipmentCode: "A1", equipmentName: "设备甲", purchaseDate: null, monitored: false, responsibleUserIds: ["new-user"]
    }], actor({ permissions: ["*"] }));

    expect(result).toEqual({ rows: 1, created: 0, updated: 1, unchanged: 0 });
    expect(manager.delete).toHaveBeenCalledWith(expect.any(Function), { tenantId: "KAINAN", equipmentId: "asset-1" });
    expect(manager.save).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ equipmentId: "asset-1", userId: "new-user" }));
  });

  it("resets every monitored asset through the audited application command", async () => {
    const assets = [
      { id: "asset-1", tenantId: "KAINAN", divisionOrganizationUnitId: "d1", monitored: true, version: 2, equipmentCode: "A1", equipmentName: "设备甲", purchaseDate: null, usageDepartmentOrganizationUnitId: null, active: true },
      { id: "asset-2", tenantId: "KAINAN", divisionOrganizationUnitId: "d2", monitored: false, version: 1, equipmentCode: "A2", equipmentName: "设备乙", purchaseDate: null, usageDepartmentOrganizationUnitId: null, active: true }
    ];
    const queryBuilder = {
      setLock: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(assets)
    };
    const manager = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      save: jest.fn().mockImplementation((_entity: unknown, value: unknown) => Promise.resolve(value))
    };
    const dataSource = { transaction: jest.fn((work: (value: unknown) => unknown) => work(manager)) } as any;
    const service = new EquipmentApplicationService(dataSource);

    const result = await service.resetAllMonitoring(actor({ permissions: ["*"] }));

    expect(result).toEqual({ total: 2, updated: 1, unchanged: 1 });
    expect(assets[0]).toMatchObject({ monitored: false, version: 3 });
    const auditWrites = manager.save.mock.calls.filter(([entity]) => entity?.name === "AuditLog");
    expect(auditWrites).toHaveLength(2);
    expect(auditWrites[0][1]).toMatchObject({ action: "equipment.asset.monitoring_reset", beforeJson: expect.objectContaining({ monitored: true }), afterJson: expect.objectContaining({ monitored: false }) });
  });

  it("uses server-validated calendar bounds for dashboard filters", () => {
    const service = new EquipmentQueryService({} as never) as any;
    jest.useFakeTimers().setSystemTime(new Date("2026-09-15T00:30:00.000Z"));
    expect(service.dashboardInput({})).toMatchObject({ windowStart: "2026-09-14", windowEnd: "2026-09-14", windowDays: 1 });
    expect(service.dashboardInput({ periodType: "day", period: "2026-09-14" })).toMatchObject({ windowStart: "2026-09-14", windowEnd: "2026-09-14", windowDays: 1 });
    jest.useRealTimers();
    expect(service.dashboardInput({ periodType: "month", period: "2026-09" })).toMatchObject({ windowStart: "2026-09-01", windowEnd: "2026-09-30", windowDays: 30 });
    expect(service.dashboardInput({ periodType: "year", period: "2024" })).toMatchObject({ windowStart: "2024-01-01", windowEnd: "2024-12-31", windowDays: 366 });
    expect(service.dashboardInput({ periodType: "custom", startDate: "2024-09-03", endDate: "2026-09-03" })).toMatchObject({ windowDays: 731 });
    expect(() => service.dashboardInput({ periodType: "custom", startDate: "2024-09-03", endDate: "2026-09-04" })).toThrow(BadRequestException);
  });

  it("accepts multiple stable department IDs and rejects invalid department filters", () => {
    const service = new EquipmentQueryService({} as never) as any;
    const first = "00000000-0000-7000-8000-000000000011";
    const second = "00000000-0000-7000-8000-000000000012";
    expect(service.dashboardInput({ departmentId: [first, second, first] }).departmentIds).toEqual([first, second]);
    expect(() => service.dashboardInput({ departmentId: [first, "研发中心"] })).toThrow(BadRequestException);
  });

  it("parses the supported status-import duration formats", () => {
    const service = new EquipmentImportService({} as never) as any;
    expect(service.duration("12小时35分钟")).toBe(755);
    expect(service.duration("12:35")).toBe(755);
    expect(service.duration("755")).toBe(755);
    expect(service.duration(0)).toBe(0);
    expect(Number.isNaN(service.duration("十二小时"))).toBe(true);
    expect(() => service.headerMap(["事业部", "设备编号", "填报日期", "运行时长", "故障时长", "故障原因"])).toThrow("当前导入文件使用的是旧版设备状态模板，缺少“计划运行时间”字段。设备状态模板已升级，请重新下载最新模板，填写“计划运行时间”后再上传。");
    expect(service.headerMap(["事业部", "使用部门", "设备编号", "设备名称", "填报日期", "计划运行时间", "实际运行时长", "故障时长", "故障原因"]).get("runtimeMinutes")).toBe(6);
    expect(service.headerMap(["事业部", "设备编号", "填报日期", "计划运行时间", "运行时长", "故障时长", "故障原因"]).get("runtimeMinutes")).toBe(4);
  });

  it("rejects an old workbook at preview level but accepts the new template", async () => {
    process.env.JWT_ACCESS_SECRET ||= "equipment-import-test-secret";
    const oldWorkbook = new ExcelJS.Workbook();
    const oldSheet = oldWorkbook.addWorksheet("设备状态填报");
    oldSheet.addRow(["事业部", "使用部门", "设备编号", "设备名称", "填报日期", "运行时长", "故障时长", "故障原因"]);
    oldSheet.addRow(["事业一部", "生产部", "A001", "设备甲", "2026-09-21", "7小时", "0小时", ""]);
    const oldFile = { originalname: "旧版设备状态模板.xlsx", buffer: Buffer.from(await oldWorkbook.xlsx.writeBuffer()) } as Express.Multer.File;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("设备状态填报");
    sheet.addRow(["事业部", "使用部门", "设备编号", "设备名称", "填报日期", "计划运行时间", "实际运行时长", "故障时长", "故障原因"]);
    sheet.addRow(["事业一部", "生产部", "A001", "设备甲", "2026-09-21", "8小时", "7小时", "0小时", ""]);
    const newerFile = { originalname: "新版设备状态模板.xlsx", buffer: Buffer.from(await workbook.xlsx.writeBuffer()) } as Express.Multer.File;
    const application = { previewStatusImport: jest.fn().mockResolvedValue({ rows: [], errors: [], total: 1, createCount: 0, updateCount: 0, unchangedCount: 0 }) };
    const service = new EquipmentImportService(application as never);
    const importActor = actor({ permissions: ["equipment-status-report:*:import"] });

    await expect(service.previewStatus(oldFile, importActor)).rejects.toThrow("缺少“计划运行时间”字段");
    expect(application.previewStatusImport).not.toHaveBeenCalled();

    await expect(service.previewStatus(newerFile, importActor)).resolves.toMatchObject({ total: 1 });
    expect(application.previewStatusImport).toHaveBeenCalledTimes(1);
  });
});


it("records dashboard export audit under the actual tenant without changing legacy audit helpers", async () => {
  const manager = { save: jest.fn().mockResolvedValue({}) };
  const service = new EquipmentApplicationService({ transaction: jest.fn(work => work(manager)) } as any);
  const exporter = actor({ tenantId: "TENANT_EXPORT", permissions: ["equipment-dashboard:*:export"] });
  await service.recordDashboardExport("utilization_detail", 100, "2026-10-01", "2026-10-06", exporter);
  expect(manager.save).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
    tenantId: "TENANT_EXPORT", resource: "equipment-dashboard", action: "equipment.dashboard.exported", requestId: "test",
    afterJson: { table: "utilization_detail", rowCount: 100, windowStart: "2026-10-01", windowEnd: "2026-10-06" }
  }));
  await expect(service.recordDashboardExport("unreported", 3, "2026-10-06", "2026-10-06", actor())).rejects.toThrow("权限");
});

describe("equipment status import matching errors", () => {
  const divisionId = "00000000-0000-7000-8000-000000000021";
  const otherDivisionId = "00000000-0000-7000-8000-000000000022";
  const sourceRow = {
    rowNumber: 2, divisionName: "研发中心", equipmentCode: "KN-020Y003", reportDate: "2026-10-08",
    plannedRuntimeMinutes: 600, runtimeMinutes: 600, faultMinutes: 0, faultReason: null
  };
  const asset = {
    id: "asset-import", tenantId: "KAINAN", divisionOrganizationUnitId: divisionId,
    divisionNameSnapshot: "研发中心", equipmentCode: "KN-020Y003", equipmentName: "设备甲", active: true, monitored: true
  };
  const setup = (assets = [asset], divisions = [{ id: divisionId, name: "研发中心", enabled: true }]) => {
    const manager = {
      find: jest.fn().mockImplementation((entity: { name?: string }, options: any) => Promise.resolve(
        entity.name === "OrganizationUnit"
          ? divisions.filter(d => d.enabled && (!options.where.id || options.where.id.value.includes(d.id)))
          : assets.filter(a => a.active && a.monitored)
      )),
      findOneBy: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([])
      })
    };
    return { manager, service: new EquipmentApplicationService({ manager } as never) };
  };
  const importer = actor({ permissions: ["equipment-status-report:*:import"], isSystemAdmin: true });

  beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date("2026-10-08T04:00:00.000Z")); });
  afterEach(() => { jest.useRealTimers(); });

  it("reports a missing division name before attempting equipment lookup", async () => {
    const { service, manager } = setup();
    const preview = await service.previewStatusImport([{ ...sourceRow, divisionName: "研发" }], importer);
    expect(preview.errors).toEqual([{ rowNumber: 2, message: "找不到事业部名称“研发”，请按当前导入权限范围内的设备总台账填写" }]);
    expect(preview.rows).toEqual([]);
    expect(manager.findOneBy).not.toHaveBeenCalled();
  });

  it("distinguishes a blank division name", async () => {
    const { service } = setup();
    const preview = await service.previewStatusImport([{ ...sourceRow, divisionName: " " }], importer);
    expect(preview.errors).toEqual([{ rowNumber: 2, message: "事业部名称不能为空" }]);
  });

  it.each([
    ["an unknown equipment number", "UNKNOWN", [asset]],
    ["an unmonitored equipment", asset.equipmentCode, [{ ...asset, monitored: false }]],
    ["an inactive equipment", asset.equipmentCode, [{ ...asset, active: false }]],
    ["a division with no equipment", asset.equipmentCode, []]
  ])("reports equipment eligibility for %s rather than a missing division", async (_label, equipmentCode, assets) => {
    const { service } = setup(assets);
    const preview = await service.previewStatusImport([{ ...sourceRow, equipmentCode }], importer);
    expect(preview.errors).toEqual([{ rowNumber: 2, message: `未找到事业部“研发中心”下设备编号“${equipmentCode}”对应的可填报设备，请核对编号、设备启用状态和监控设置` }]);
    expect(preview.rows).toEqual([]);
  });

  it("keeps valid rows in a mixed preview and trims names without accepting aliases", async () => {
    const { service } = setup();
    const preview = await service.previewStatusImport([
      { ...sourceRow, divisionName: "研发" },
      { ...sourceRow, rowNumber: 3, divisionName: " 研发中心 ", equipmentCode: "kn-020y003" }
    ], importer);
    expect(preview).toMatchObject({ total: 2, createCount: 1, errors: [{ rowNumber: 2, message: expect.stringContaining("找不到事业部名称“研发”") }] });
    expect(preview.rows).toEqual([expect.objectContaining({ rowNumber: 3, equipmentId: asset.id })]);
  });

  it("does not disclose or match a division outside import scope", async () => {
    const otherAsset = { ...asset, id: "other-asset", divisionOrganizationUnitId: otherDivisionId, divisionNameSnapshot: "事业四部" };
    const { service, manager } = setup([asset, otherAsset], [
      { id: divisionId, name: "研发中心", enabled: true },
      { id: otherDivisionId, name: "事业四部", enabled: true }
    ]);
    const scoped = actor({ permissions: ["equipment-status-report:*:import"], tableDataScopes: [{
      resource: "equipment-status-report", scope: "CUSTOM", actions: ["import"], rules: [{ fieldKey: "divisionId", operator: "EQ", value: divisionId }]
    }] });
    const preview = await service.previewStatusImport([{ ...sourceRow, divisionName: "事业四部" }], scoped);
    expect(preview.rows).toEqual([]);
    expect(preview.errors[0]?.message).toBe("找不到事业部名称“事业四部”，请按当前导入权限范围内的设备总台账填写");
    expect(manager.find).toHaveBeenCalledWith(expect.any(Function), { where: { enabled: true, id: expect.objectContaining({ _value: [divisionId] }) } });
    expect(manager.find).toHaveBeenCalledWith(expect.any(Function), { where: { tenantId: "KAINAN", active: true, monitored: true } });
  });

  it("does not query all organizations when no division is authorized", async () => {
    const { service, manager } = setup();
    const preview = await service.previewStatusImport([sourceRow], actor({ permissions: ["equipment-status-report:*:import"] }));
    expect(preview.rows).toEqual([]);
    expect(preview.errors[0]?.message).toContain("找不到事业部名称“研发中心”");
    expect(manager.find).toHaveBeenCalledTimes(1);
  });

  it("keeps the accepted equipment snapshot name when the organization is renamed", async () => {
    const { service } = setup([asset], [{ id: divisionId, name: "研发新名称", enabled: true }]);
    const preview = await service.previewStatusImport([sourceRow], importer);
    expect(preview.errors).toEqual([]);
    expect(preview.rows).toHaveLength(1);
  });
});
