import { describe, expect, it } from "vitest";
import { legacyPlanningFieldRegistry, monthlyPlanningFieldRegistry, orchestrationFieldRegistry, planningAuditFieldRegistry, planningFieldRegistry, presetTablePermissionDataScope, presetTablePermissionMatrix, tablePermissionActions, tableResourceRegistry } from "./index";

describe("Planning Field Registry", () => {
  it("preserves legacy fields while exposing only the exact active monthly fields", () => {
    expect(legacyPlanningFieldRegistry).toHaveLength(97);
    expect(monthlyPlanningFieldRegistry).toHaveLength(84);
    expect(orchestrationFieldRegistry.map((field) => field.code)).toEqual(["priority", "planSequence", "responsibleOrgId", "ownerUserId", "planningStatus"]);
    expect(planningAuditFieldRegistry.map((field) => field.label)).toEqual(["创建人", "创建时间", "更新人", "更新时间"]);
    expect(planningFieldRegistry).toEqual([...monthlyPlanningFieldRegistry, ...planningAuditFieldRegistry]);
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

  it("keeps the five system permission groups immutable and import-free", () => {
    expect(Object.keys(presetTablePermissionMatrix)).toEqual(["ADD_ONLY", "ADD_MANAGE_OWN", "ADD_VIEW_ALL", "MANAGE_ALL", "VIEW_ALL"]);
    for (const permissions of Object.values(presetTablePermissionMatrix)) {
      expect(Object.keys(permissions)).toEqual(tablePermissionActions);
      expect(permissions.import).toBe(false);
    }
    expect(presetTablePermissionMatrix.ADD_ONLY).toMatchObject({ read: false, create: true });
    expect(presetTablePermissionMatrix.ADD_MANAGE_OWN).toMatchObject({ read: true, update: true, export: true });
    expect(presetTablePermissionDataScope).toEqual({ ADD_ONLY: "NONE", ADD_MANAGE_OWN: "OWN", ADD_VIEW_ALL: "ALL", MANAGE_ALL: "ALL", VIEW_ALL: "ALL" });
  });
});
