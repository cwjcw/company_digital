import { PlanningOperationsApplicationService } from "./planning-operations.application.service";

const divisionId = "22222222-2222-4222-8222-222222222222";
const actor = {
  tenantCode: "KAINAN", userId: "11111111-1111-4111-8111-111111111111",
  permissions: ["work-report:*:read", "work-report:*:export", "work-report:divisionId:read"], roles: [],
  tableDataScopes: [{ resource: "work-report", scope: "CUSTOM", actions: ["read"], rules: [{ fieldKey: "divisionId", operator: "EQ", value: divisionId }] }],
  managedOrganizationUnitIds: [], requestId: "request-1", traceId: "trace-1", ip: "127.0.0.1", source: "WEB" as const
};

describe("PlanningOperationsApplicationService work-report division", () => {
  it("uses full-path filtering, preserves data scope and exports only authorized division fields", async () => {
    const repository = {
      tenantId: jest.fn().mockResolvedValue("tenant-1"),
      listWorkReports: jest.fn().mockResolvedValue({ rows: [{ id: "report-1", version: 2, divisionId, orderNumber: "SO-1" }], total: 1, page: 1, pageSize: 50 })
    };
    const directory = { listEnabled: jest.fn().mockResolvedValue([{ id: divisionId, name: "事业一部", pathLabel: "凯南 / 制造中心 / 事业一部" }]) };
    const service = new PlanningOperationsApplicationService(repository as never, directory as never);

    const result = await service.workReports("2026-09-14", { filters: { divisionId: "凯南 / 制造中心 / 事业一部" } }, actor as never);
    expect(repository.listWorkReports).toHaveBeenCalledWith("tenant-1", "2026-09-14", expect.objectContaining({ divisionIds: [divisionId], divisionFilterActive: true }), actor);
    expect(result.rows).toEqual([expect.objectContaining({ id: "report-1", version: 2, divisionId, divisionName: "凯南 / 制造中心 / 事业一部" })]);

    await expect(service.exportWorkReports("2026-09-14", { filters: { divisionId: "事业一部" } }, actor as never)).resolves.toEqual([
      expect.objectContaining({ id: "report-1", version: 2, divisionId, divisionName: "凯南 / 制造中心 / 事业一部" })
    ]);
    expect(repository.listWorkReports.mock.calls.at(-1)?.[3]).toBe(actor);
  });
});
