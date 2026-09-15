import { SalesDashboardService } from "./sales-dashboard.service";

describe("SalesDashboardService", () => {
  it("limits a non-dashboard user without divisions to an empty result", async () => {
    const service = new SalesDashboardService({ query: jest.fn() } as never);
    await expect(service.salesDashboard({ dimension: "month", period: "2026-09-01" }, { divisions: [] })).resolves.toMatchObject({ metrics: { orderCount: 0 } });
  });

  it("uses the dashboard ALL scope without granting planning-table access", async () => {
    const query = jest.fn().mockResolvedValue([{ payload: { metrics: { orderCount: 1 } } }]);
    const service = new SalesDashboardService({ query } as never);
    await expect(service.salesDashboard({ dimension: "day", period: "2026-09-15" }, { divisions: [], tableDataScopes: [{ resource: "sales-summary-dashboard", scope: "ALL", actions: ["read"] }] })).resolves.toEqual({ metrics: { orderCount: 1 } });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
