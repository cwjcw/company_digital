import { PlanService } from "./plan.service";

describe("PlanService administrator data scope", () => {
  const service = Object.create(PlanService.prototype) as {
    hasUnrestrictedPlanningScope(user: unknown): boolean;
  };

  it("gives PMC and cockpit administrators the complete data set used by their module", () => {
    expect(service.hasUnrestrictedPlanningScope({ divisions: [], moduleAdminCodes: ["planning"] })).toBe(true);
    expect(service.hasUnrestrictedPlanningScope({ divisions: [], moduleAdminCodes: ["cockpit"] })).toBe(true);
    expect(service.hasUnrestrictedPlanningScope({ divisions: [], moduleAdminCodes: ["marketing"] })).toBe(false);
  });
});
