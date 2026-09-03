import { PlanService } from "./plan.service";

describe("PlanService administrator data scope", () => {
  const service = Object.create(PlanService.prototype) as {
    hasUnrestrictedPlanningScope(user: unknown): boolean;
    hasUnrestrictedDashboardScope(user: unknown): boolean;
  };

  it("gives PMC and cockpit administrators the complete data set used by their module", () => {
    expect(service.hasUnrestrictedPlanningScope({ divisions: [], moduleAdminCodes: ["planning"] })).toBe(true);
    expect(service.hasUnrestrictedPlanningScope({ divisions: [], moduleAdminCodes: ["cockpit"] })).toBe(true);
    expect(service.hasUnrestrictedPlanningScope({ divisions: [], moduleAdminCodes: ["marketing"] })).toBe(false);
  });

  it("treats an enabled dashboard VIEW_ALL scope as unrestricted dashboard data", () => {
    expect(service.hasUnrestrictedDashboardScope({
      divisions: [],
      tableDataScopes: [{ resource: "sales-summary-dashboard", scope: "ALL", actions: ["read"] }]
    })).toBe(true);
    expect(service.hasUnrestrictedDashboardScope({
      divisions: [],
      tableDataScopes: [{ resource: "sales-summary-dashboard", scope: "ALL", actions: ["update"] }]
    })).toBe(false);
    expect(service.hasUnrestrictedDashboardScope({
      divisions: [],
      tableDataScopes: [{ resource: "rolling-plan", scope: "ALL", actions: ["read"] }]
    })).toBe(false);
  });

  it("does not return an empty dashboard for a VIEW_ALL role without division scopes", async () => {
    const dashboardService = Object.create(PlanService.prototype) as any;
    const payload = { metrics: { orderCount: 77 }, divisionRows: [], warningRows: [] };
    dashboardService.dataSource = { query: jest.fn().mockResolvedValue([{ payload }]) };
    const result = await dashboardService.salesDashboard(
      { dimension: "month", period: "2026-09-01", divisions: [], customers: [] },
      { divisions: [], tableDataScopes: [{ resource: "sales-summary-dashboard", scope: "ALL", actions: ["read"] }] }
    );
    expect(result).toEqual(payload);
    expect(dashboardService.dataSource.query).toHaveBeenCalledTimes(1);
    expect(dashboardService.dataSource.query.mock.calls[0][1]).toEqual(["2026-09-01", "2026-10-01"]);
  });

  it("builds exact half-open dashboard date ranges", () => {
    const range = (service as any).dashboardDateRange.bind(service);
    expect(range("year", "2026-09-01")).toEqual(["2026-01-01", "2027-01-01"]);
    expect(range("month", "2026-02-20")).toEqual(["2026-02-01", "2026-03-01"]);
    expect(range("day", "2026-09-01")).toEqual(["2026-09-01", "2026-09-02"]);
    expect(() => range("day", "2026-02-30")).toThrow("驾驶舱日期无效");
  });

  it("aggregates the sales dashboard in PostgreSQL instead of loading order rows", async () => {
    const dashboardService = Object.create(PlanService.prototype) as any;
    const payload = { metrics: { orderCount: 1 }, divisionRows: [], warningRows: [] };
    dashboardService.dataSource = { query: jest.fn().mockResolvedValue([{ payload }]) };
    const result = await dashboardService.salesDashboard(
      { dimension: "month", period: "2026-09-01", divisions: ["事业一部"], customers: [] },
      { divisions: [], moduleAdminCodes: ["cockpit"] }
    );
    expect(result).toEqual(payload);
    expect(dashboardService.dataSource.query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = dashboardService.dataSource.query.mock.calls[0];
    expect(sql).toContain("WITH scoped_orders AS MATERIALIZED");
    expect(sql).toContain("LIMIT 8");
    expect(parameters).toEqual(["2026-09-01", "2026-10-01", ["事业一部"]]);
  });
});
