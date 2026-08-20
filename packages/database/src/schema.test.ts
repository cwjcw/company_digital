import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { planItems, planPeriods, planVersions, processProgress, tenants } from "./schema";

describe("KDOS Drizzle schema", () => {
  it("defines the tenant and planning aggregate tables", () => {
    expect(getTableName(tenants)).toBe("tenants");
    expect(getTableName(planPeriods)).toBe("plan_periods");
    expect(getTableName(planVersions)).toBe("plan_versions");
    expect(getTableName(planItems)).toBe("plan_items");
    expect(getTableName(processProgress)).toBe("process_progress");
  });
});
