import { describe, expect, it } from "vitest";
import { legacyPlanningFieldRegistry, monthlyPlanningFieldRegistry, orchestrationFieldRegistry, planningAuditFieldRegistry, planningFieldRegistry, presetTablePermissionDataScope, presetTablePermissionMatrix, tablePermissionActions, tablePermissionFieldRegistry, tablePermissionFieldsFor, tableResourceRegistry } from "./index";

describe("Planning Field Registry", () => {
  it("preserves legacy fields while exposing only the exact active monthly fields", () => {
    expect(legacyPlanningFieldRegistry).toHaveLength(97);
    expect(monthlyPlanningFieldRegistry).toHaveLength(85);
    expect(monthlyPlanningFieldRegistry[1]).toMatchObject({ code: "responsibleOrgId", label: "事业部", dataType: "department", order: 11 });
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
      "on-hand-summary-dashboard", "rolling-plan", "monthly-plan", "sales-orders", "finished-goods-inbound",
      "business-customer-mapping", "order-schedule", "hr-departure-check", "weekly-plan", "work-report"
    ]));
  });

  it("registers the on-hand dashboard as a read-only independently governed report", () => {
    expect(tableResourceRegistry.find((resource) => resource.code === "on-hand-summary-dashboard")).toMatchObject({ moduleCode: "planning", label: "集团主计划" });
    expect(tableResourceRegistry.find((resource) => resource.code === "equipment-dashboard")).toMatchObject({ moduleCode: "planning", label: "集团设备大屏" });
    expect(tablePermissionFieldsFor("equipment-register")).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "plannedStartupMinutes", label: "设备计划开机时间", type: "number", editable: true })
    ]));
    const fields = tablePermissionFieldsFor("on-hand-summary-dashboard");
    expect(fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "balanceQuantity", editable: false }),
      expect.objectContaining({ key: "customer", editable: false }),
      expect.objectContaining({ key: "processName", editable: false })
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

  it("registers the four immutable audit fields for every authorized table", () => {
    for (const resource of tableResourceRegistry) {
      expect(tablePermissionFieldRegistry[resource.code]).toBeDefined();
      const fields = tablePermissionFieldsFor(resource.code);
      expect(fields.slice(-4).map((field) => field.label)).toEqual(["创建人", "创建时间", "更新人", "更新时间"]);
      expect(fields.slice(-4).every((field) => !field.editable)).toBe(true);
    }
  });

  it("keeps order-schedule ownership fields read-only", () => {
    const ownership = tablePermissionFieldsFor("order-schedule").filter((field) => ["departmentId", "section", "salespersonUserIds"].includes(field.key));
    expect(ownership).toEqual([
      { key: "departmentId", label: "部门", type: "department", editable: false, required: false },
      { key: "section", label: "课室", type: "text", editable: false, required: false },
      { key: "salespersonUserIds", label: "业务员", type: "member", editable: false, required: false }
    ]);
  });

  it("exposes only the review date as editable while keeping confirmation as an action field", () => {
    expect(tablePermissionFieldsFor("division-order-review")).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "divisionReviewDueDate", label: "事业部评审交期", type: "date", editable: true }),
      expect.objectContaining({ key: "deliveryConfirmation", label: "交期确认", editable: false })
    ]));
  });

  it("models marketing sections as ordinary text instead of organization nodes", () => {
    expect(tablePermissionFieldsFor("business-customer-mapping").find((field) => field.label === "课室")).toMatchObject({ key: "section", type: "text" });
  });
});
