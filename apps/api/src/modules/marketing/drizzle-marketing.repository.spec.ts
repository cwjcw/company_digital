import { DrizzleMarketingRepository } from "./drizzle-marketing.repository";

describe("DrizzleMarketingRepository order-schedule business sync", () => {
  it("matches by tenant and customer code, updates only changed rows, and audits the result", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("WITH matched AS MATERIALIZED")) return { rows: [{
        sourceCustomers: 2, targetRows: 3, matched: 2, updated: 1,
        changes: [{ id: "schedule-1", customerCode: "C001", before: { department: null }, after: { department: "业务一部" } }]
      }] };
      return { rows: [], rowCount: 0 };
    });
    const release = jest.fn();
    const repository = new DrizzleMarketingRepository({ pool: { connect: jest.fn().mockResolvedValue({ query, release }) } } as any);

    await expect(repository.syncScheduleBusinessFields("tenant-1", {
      userId: "user-1", username: "测试用户", tenantCode: "KAINAN", permissions: ["order-schedule:*:import"], requestId: "request-1"
    })).resolves.toEqual({ sourceCustomers: 2, targetRows: 3, matched: 2, added: 0, updated: 1, unchanged: 1, removed: 0, retained: 1 });

    const syncSql = String(query.mock.calls.find(([sql]) => String(sql).includes("WITH matched AS MATERIALIZED"))?.[0]);
    expect(syncSql).toContain("mapping.tenant_id=schedule.tenant_id AND mapping.customer_code=schedule.customer_code");
    expect(syncSql).toContain("IS DISTINCT FROM");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO audit.audit_logs"))).toBe(true);
    expect(query.mock.calls.map(([sql]) => sql).slice(-1)).toEqual(["COMMIT"]);
    expect(release).toHaveBeenCalled();
  });
});
