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
    (service as any).shanghaiDate = () => "2026-09-22";

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
    expect(sql).toContain("sum(report.planned_runtime_minutes) FILTER (WHERE report.planned_runtime_minutes IS NOT NULL AND report.planned_runtime_minutes>0)");
    expect(sql).toContain("'plannedRuntimeMinutes'");
    expect(sql).toContain("'utilizationRate'");
    expect(sql).toContain("'equipmentRows'");
    expect(sql).toContain("utilization_runtime_minutes::numeric/planned_runtime_minutes*100");
    expect(sql).toContain("'operationsMonitoring'");
    expect(sql).toContain("operations_divisions");
    expect(sql).toContain("operations_division_daily");
    expect(sql).toContain("operations_division_trends");
    expect(sql).toContain("operations_yesterday_department");
    expect(sql).toContain("operations_yesterday_division");
    expect(sql).toContain("GROUP BY division_id,division");
    expect(sql).toContain("'yesterdayDivisionRows'");
    expect(sql).toContain("'yesterdayDepartmentRows'");
    expect(sql).not.toContain("'yesterdayRows'");
    expect(sql).toContain("'sevenDayTrend',jsonb_build_object");
    expect(sql).toContain("'total'");
    expect(sql).toContain("'divisions'");
    expect(sql).toContain("generate_series(window_start,window_end,interval '1 day')");
    expect(sql).toContain("count(DISTINCT report.equipment_id)::integer filled_equipment_count");
    expect(sql).toContain("COALESCE(sum(report.runtime_minutes),0)::integer runtime_minutes");
    expect(sql).toContain("sum(report.runtime_minutes) FILTER (WHERE report.planned_runtime_minutes IS NOT NULL AND report.planned_runtime_minutes>0)");
    expect(sql).toContain("'utilizationRate',CASE WHEN planned_runtime_minutes>0 THEN round(utilization_runtime_minutes::numeric/planned_runtime_minutes*100,1) ELSE NULL END");
    expect(sql).toContain("round(filled_equipment_count::numeric/expected_equipment_count*100,1)");
    expect(sql).not.toContain("avg(");
    expect(dataSource.query.mock.calls[0][1].slice(-2)).toEqual(["2026-09-15", "2026-09-21"]);
  });

  it("rolls the operations trend window forward with the Shanghai calendar date", async () => {
    const dataSource = { query: jest.fn().mockResolvedValueOnce([{ payload: { metrics: {} } }]) } as any;
    const service = new EquipmentQueryService(dataSource);
    (service as any).shanghaiDate = () => "2026-09-23";

    await service.dashboard({ periodType: "day", period: "2026-09-22" }, {
      tenantId: "KAINAN", userId: null, username: "系统管理员", permissions: ["*"], tableDataScopes: [], requestId: "request-dashboard-rollover"
    });

    expect(dataSource.query.mock.calls[0][1].slice(-2)).toEqual(["2026-09-16", "2026-09-22"]);
  });
});

describe("EquipmentQueryService typed filtering (KN-FILTER-001)", () => {
  const actor = {
    tenantId: "KAINAN", userId: null, username: "系统管理员", isSystemAdmin: true,
    permissions: ["*"], tableDataScopes: [], requestId: "request-filter"
  } as any;

  it("applies typed filterGroup to the asset list/count with the real column binding", async () => {
    const dataSource = { query: jest.fn().mockResolvedValueOnce([{ count: 3 }]).mockResolvedValueOnce([]) } as any;
    const service = new EquipmentQueryService(dataSource);
    const result = await service.listAssets({
      page: 1, pageSize: 50,
      filterGroup: { logic: "AND", rules: [{ field: "plannedStartupMinutes", operator: "gte", value: 480 }] }
    }, actor);
    expect(result.total).toBe(3);
    const countSql = String(dataSource.query.mock.calls[0][0]);
    expect(countSql).toContain("asset.planned_startup_minutes");
    expect(dataSource.query.mock.calls[0][1]).toContain("480");
  });

  it("resolves the faultReason dictionary against dictionary_values without assuming a label column", async () => {
    const dataSource = { query: jest.fn()
      .mockResolvedValueOnce([{ value: "机械故障" }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([]) } as any;
    const service = new EquipmentQueryService(dataSource);
    await service.listStatus({
      page: 1, pageSize: 50,
      filterGroup: { logic: "AND", rules: [{ field: "faultReason", operator: "eq", value: "机械故障" }] }
    }, actor);
    const dictionarySql = String(dataSource.query.mock.calls[0][0]);
    expect(dictionarySql).toContain("dictionary_values");
    expect(dictionarySql).not.toContain("dv.label");
    expect(String(dataSource.query.mock.calls[1][0])).toContain("report.fault_reason");
  });

  it("拒绝未知字段与不匹配的操作符，不把条件静默丢掉", async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([{ count: 0 }, []]) } as any;
    const service = new EquipmentQueryService(dataSource);
    await expect(service.listAssets({
      page: 1, pageSize: 50,
      filterGroup: { logic: "AND", rules: [{ field: "notAColumn", operator: "eq", value: 1 }] }
    }, actor)).rejects.toThrow(/不允许筛选/);
    await expect(service.listAssets({
      page: 1, pageSize: 50,
      filterGroup: { logic: "AND", rules: [{ field: "monitored", operator: "contains", value: "是" }] }
    }, actor)).rejects.toThrow(/不支持该筛选方式/);
  });
});
