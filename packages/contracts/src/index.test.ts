import { describe, expect, it } from "vitest";
import { masterPlanResourceDefinitions, tableResourceRegistry } from "./index";

describe("active PMC resources", () => {
  it("keeps the current master-plan resources and excludes retired planning UI resources", () => {
    const masterPlanCodes = masterPlanResourceDefinitions.map((resource) => resource.code);
    expect(masterPlanCodes).toContain("mps-erp-orders");
    expect(masterPlanCodes).toContain("mps-group-plans");
    expect(masterPlanCodes).toContain("mps-monthly-plans");
    expect(masterPlanCodes).toContain("mps-weekly-plans");

    const activeCodes = tableResourceRegistry.map((resource) => resource.code);
    expect(activeCodes).not.toEqual(expect.arrayContaining([
      "on-hand-summary-dashboard", "rolling-plan", "monthly-plan", "rolling-plan-table",
      "division-order-review", "weekly-plan", "work-report"
    ]));
  });
});
