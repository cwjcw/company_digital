import { EquipmentQueryService } from "./equipment.query.service";

describe("EquipmentQueryService status responsibility", () => {
  it("reads responsible people from the equipment master relation for every status page", async () => {
    const row = {
      id: "status-1", equipmentId: "equipment-1", responsibleUserIds: ["user-1"],
      responsibleUsers: [{ id: "user-1", displayName: "责任人甲", enabled: true }]
    };
    const dataSource = { query: jest.fn().mockResolvedValueOnce([{ count: 1 }]).mockResolvedValueOnce([row]) } as any;
    const service = new EquipmentQueryService(dataSource);

    const result = await service.listStatus({ page: 1, pageSize: 50 }, {
      tenantId: "KAINAN", userId: "user-1", username: "测试用户", permissions: ["*"], tableDataScopes: [], requestId: "request-1"
    });

    expect(result.rows).toEqual([row]);
    expect(result.total).toBe(1);
    const pageSql = String(dataSource.query.mock.calls[1][0]);
    expect(pageSql).toContain("equipment_responsibles");
    expect(pageSql).toContain('"responsibleUserIds"');
    expect(pageSql).toContain('"responsibleUsers"');
  });

  it("summarizes monitoring and responsibility counts by stable division", async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([{
      divisionId: "division-1", divisionName: "事业一部", totalEquipment: "12",
      monitoredEquipment: "3", responsibleEquipment: "2"
    }]) } as any;
    const service = new EquipmentQueryService(dataSource);

    const result = await service.governanceSummary({
      tenantId: "KAINAN", userId: null, username: "system", permissions: ["*"], tableDataScopes: [], requestId: "request-2"
    });

    expect(result.rows).toEqual([{
      divisionId: "division-1", divisionName: "事业一部", totalEquipment: 12,
      monitoredEquipment: 3, responsibleEquipment: 2
    }]);
    expect(String(dataSource.query.mock.calls[0][0])).toContain("equipment_responsibles");
  });

  it("filters OWN status records by creator instead of returning an empty scope", async () => {
    const dataSource = { query: jest.fn().mockResolvedValueOnce([{ count: 0 }]).mockResolvedValueOnce([]) } as any;
    const service = new EquipmentQueryService(dataSource);
    const userId = "00000000-0000-7000-8000-000000000021";
    await service.listStatus({ page: 1, pageSize: 50 }, {
      tenantId: "KAINAN", userId, username: "本人数据用户",
      permissions: ["equipment-status-report:*:read"],
      tableDataScopes: [{ resource: "equipment-status-report", scope: "OWN", actions: ["read"] }], requestId: "request-own"
    });
    expect(String(dataSource.query.mock.calls[0][0])).toContain("report.created_by=$2::uuid");
    expect(dataSource.query.mock.calls[0][1].slice(0, 2)).toEqual(["KAINAN", userId]);
  });

  it("returns monitored equipment candidates to an OWN-scoped creator", async () => {
    const equipment = [{ id: "equipment-1", equipmentCode: "A001" }];
    const dataSource = { query: jest.fn().mockResolvedValueOnce(equipment).mockResolvedValueOnce([{ value: "机械故障" }]) } as any;
    const service = new EquipmentQueryService(dataSource);
    const result = await service.statusFormOptions({
      tenantId: "KAINAN", userId: "00000000-0000-7000-8000-000000000022", username: "新增用户",
      permissions: ["equipment-status-report:*:create"],
      tableDataScopes: [{ resource: "equipment-status-report", scope: "OWN", actions: ["create"] }], requestId: "request-create"
    });
    expect(result.equipment).toEqual(equipment);
    expect(String(dataSource.query.mock.calls[0][0])).toContain("asset.monitored=true AND 1=1");
    expect(result.faultReasons).toEqual(["机械故障"]);
  });

  it.each([
    ["需要填报", true],
    ["无需填报", false]
  ])("filters equipment monitoring by its displayed Chinese label %s", async (filter, expected) => {
    const dataSource = { query: jest.fn().mockResolvedValueOnce([{ count: 0 }]).mockResolvedValueOnce([]) } as any;
    const service = new EquipmentQueryService(dataSource);

    await service.listAssets({ page: 1, pageSize: 50, monitored: filter }, {
      tenantId: "KAINAN", userId: null, username: "系统管理员", permissions: ["*"], tableDataScopes: [], requestId: "request-monitor-filter"
    });

    expect(String(dataSource.query.mock.calls[0][0])).toContain("asset.monitored=$2");
    expect(dataSource.query.mock.calls[0][1].slice(0, 2)).toEqual(["KAINAN", expected]);
  });

  it("supports the other visible equipment ledger filters with server-side allowlisted fields", async () => {
    const dataSource = { query: jest.fn().mockResolvedValueOnce([{ count: 0 }]).mockResolvedValueOnce([]) } as any;
    const service = new EquipmentQueryService(dataSource);

    await service.listAssets({ page: 1, pageSize: 50, purchaseDate: "2026-09", plannedStartupMinutes: "8小时30分钟", responsibleUserIds: "张" }, {
      tenantId: "KAINAN", userId: null, username: "系统管理员", permissions: ["*"], tableDataScopes: [], requestId: "request-visible-filters"
    });

    const sql = String(dataSource.query.mock.calls[0][0]);
    expect(sql).toContain("asset.purchase_date::text ILIKE $2");
    expect(sql).toContain("asset.planned_startup_minutes / 60");
    expect(sql).toContain("string_agg(u.display_name,' ')");
    expect(dataSource.query.mock.calls[0][1].slice(0, 4)).toEqual(["KAINAN", "%2026-09%", "%8小时30分钟%", "%张%"]);
  });

  it("uses a report record rather than duration values to identify daily data", async () => {
    const dataSource = { query: jest.fn().mockResolvedValueOnce([{ payload: { metrics: { dailyRecordedEquipment: 1 } } }]) } as any;
    const service = new EquipmentQueryService(dataSource);

    const result = await service.dashboard({ periodType: "day", period: "2026-09-09" }, {
      tenantId: "KAINAN", userId: null, username: "系统管理员", permissions: ["*"], tableDataScopes: [], requestId: "request-dashboard"
    });

    expect(result).toEqual({ metrics: { dailyRecordedEquipment: 1 } });
    const sql = String(dataSource.query.mock.calls[0][0]);
    expect(sql).toContain("report.report_date=bounds.window_end");
    expect(sql).toContain("CASE WHEN daily.id IS NULL THEN '未填报' WHEN daily.fault_minutes>0 THEN '存在故障' WHEN daily.runtime_minutes>0 THEN '正常运行' ELSE '未运行' END state");
    expect(sql).toContain("'dailyRecordedEquipment',(SELECT count(*) FROM asset_state WHERE state<>'未填报')");
    expect(sql).toContain("'firstBatchMonitoringEquipment'");
    expect(sql).toContain("'pendingGoLiveEquipment'");
    expect(sql).toContain("'dailyRecordedEquipment'");
    expect(sql).toContain("round(duration.runtime_minutes::numeric/(SELECT window_days FROM bounds))::integer");
    expect(sql).toContain("'division',division,'departmentId'");
  });
});
