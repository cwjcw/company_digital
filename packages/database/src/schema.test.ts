import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { businessCustomerMappings, orderSchedules, planItems, planPeriods, planVersions, processProgress, schema, tenants, weeklyPlanItems, workReports } from "./schema";

describe("KDOS Drizzle schema", () => {
  it("defines the tenant and planning aggregate tables", () => {
    expect(getTableName(tenants)).toBe("tenants");
    expect(getTableName(planPeriods)).toBe("plan_periods");
    expect(getTableName(planVersions)).toBe("plan_versions");
    expect(getTableName(planItems)).toBe("plan_items");
    expect(getTableName(processProgress)).toBe("process_progress");
  });

  it("defines tenant-scoped marketing center tables", () => {
    expect(getTableName(businessCustomerMappings)).toBe("business_customer_mappings");
    expect(getTableName(orderSchedules)).toBe("order_schedules");
    expect(getTableName(weeklyPlanItems)).toBe("weekly_plan_items");
    expect(getTableName(workReports)).toBe("work_reports");
    expect(Object.keys(getTableColumns(orderSchedules))).toEqual(expect.arrayContaining(["department", "section", "departmentId", "salespersonUserIds"]));
    expect(Object.keys(getTableColumns(orderSchedules))).not.toContain("sectionId");
  });

  it("gives every registered table the KDOS system fields and optimistic version", () => {
    for (const table of Object.values(schema)) {
      expect(Object.keys(getTableColumns(table)), getTableName(table)).toEqual(expect.arrayContaining(["createdBy", "createdAt", "updatedBy", "updatedAt", "version"]));
      expect(Object.keys(getTableColumns(table)), getTableName(table)).not.toContain("auditedAt");
    }
  });
});
