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
});
