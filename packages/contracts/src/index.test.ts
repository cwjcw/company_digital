import { describe, expect, it } from "vitest";
import { legacyPlanningFieldRegistry, orchestrationFieldRegistry, planningFieldRegistry, tableResourceRegistry } from "./index";

describe("Planning Field Registry", () => {
  it("preserves every legacy field and adds orchestration metadata", () => {
    expect(legacyPlanningFieldRegistry).toHaveLength(97);
    expect(orchestrationFieldRegistry.map((field) => field.code)).toEqual(["priority", "planSequence", "responsibleOrgId", "ownerUserId", "planningStatus"]);
    expect(planningFieldRegistry).toHaveLength(102);
  });

  it("carries permissions and process source metadata", () => {
    const process = planningFieldRegistry.find((field) => field.code === "processes.machining.dueDate");
    expect(process).toMatchObject({ sourceType: "PROCESS", groupCode: "process.machining", editable: true });
    expect(process?.permissionCode).toBe("planning.plan.field.processes.machining.dueDate");
  });

  it("registers each table/report as an independently authorized resource", () => {
    const codes = tableResourceRegistry.map((resource) => resource.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(expect.arrayContaining([
      "rolling-plan", "monthly-plan", "daily-progress", "sales-orders", "finished-goods-inbound",
      "business-customer-mapping", "order-schedule", "weekly-plan", "work-report"
    ]));
  });
});
