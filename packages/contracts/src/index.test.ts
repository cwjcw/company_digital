import { describe, expect, it } from "vitest";
import { legacyPlanningFieldRegistry, orchestrationFieldRegistry, planningFieldRegistry } from "./index";

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
});
