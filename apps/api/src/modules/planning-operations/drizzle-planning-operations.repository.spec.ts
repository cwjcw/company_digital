import { DrizzlePlanningOperationsRepository } from "./drizzle-planning-operations.repository";

describe("DrizzlePlanningOperationsRepository work-report data scope", () => {
  it("enforces a division CUSTOM scope in SQL for count and rows", async () => {
    const query = jest.fn(async (...args: [string, unknown[]?]) => {
      const [sql] = args;
      if (sql.includes("count(*)::int total")) return { rows: [{ total: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: jest.fn() };
    const repository = new DrizzlePlanningOperationsRepository({ pool: { connect: jest.fn().mockResolvedValue(client) } } as never);
    const divisionId = "22222222-2222-4222-8222-222222222222";
    const actor = {
      tenantCode: "KAINAN", userId: "11111111-1111-4111-8111-111111111111", permissions: ["work-report:*:read"], roles: [],
      tableDataScopes: [{ resource: "work-report", scope: "CUSTOM", actions: ["read"], rules: [{ fieldKey: "divisionId", operator: "EQ", value: divisionId }] }],
      managedOrganizationUnitIds: [], requestId: "request-1", source: "WEB" as const
    };

    await repository.listWorkReports("tenant-1", "2026-09-14", { page: 1, pageSize: 50, divisionIds: [], divisionFilterActive: false }, actor as never);
    const protectedQueries = query.mock.calls.filter(([sql]) => String(sql).includes("planning.work_reports report"));
    expect(protectedQueries).toHaveLength(2);
    for (const [sql, params] of protectedQueries) {
      expect(String(sql)).toContain("report.division_id::text = $5");
      expect(params).toEqual(expect.arrayContaining([divisionId]));
    }
    expect(client.release).toHaveBeenCalled();
  });
});
