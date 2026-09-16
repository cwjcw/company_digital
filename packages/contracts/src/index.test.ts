import { describe, expect, it } from "vitest";
import {
  auditTableFieldMetadata, isTableFieldFilterable, masterPlanResourceDefinitions,
  tableFilterDynamicDateKeys, tableFilterOperatorsFor, tablePermissionFieldsFor, tableResourceRegistry
} from "./index";

describe("KN-FILTER-001 field metadata audit gate", () => {
  it("audits every formal resource and field without metadata errors", () => {
    const audit = auditTableFieldMetadata();
    expect(audit.errors).toEqual([]);
    expect(audit.resources).toBeGreaterThanOrEqual(44);
    expect(audit.fields).toBeGreaterThanOrEqual(673);
  });

  it("separates date from datetime and types audit timestamps as datetime", () => {
    for (const resource of ["mps-process-reports", "mps-base-plans", "equipment-status-report", "mps-sync-logs"]) {
      const fields = tablePermissionFieldsFor(resource as never);
      expect(fields.find((field) => field.key === "createdAt")?.type).toBe("datetime");
      expect(fields.find((field) => field.key === "updatedAt")?.type).toBe("datetime");
    }
    expect(tablePermissionFieldsFor("mps-sync-logs" as never).find((field) => field.key === "startedAt")?.type).toBe("datetime");
    expect(tablePermissionFieldsFor("mps-process-reports" as never).find((field) => field.key === "productionDate")?.type).toBe("date");
  });

  it("declares references with their candidate source and never as plain text", () => {
    const expectations: Array<[string, string, string]> = [
      ["mps-process-reports", "weeklyPlanId", "mps-weekly-plans"],
      ["mps-material-reports", "weeklyPlanId", "mps-weekly-plans"],
      ["mps-weekly-process-plans", "weeklyPlanId", "mps-weekly-plans"],
      ["equipment-status-report", "equipmentId", "equipment-register"],
      ["mps-outsourcing-reports", "supplierId", "suppliers"]
    ];
    for (const [resource, key, target] of expectations) {
      const field = tablePermissionFieldsFor(resource as never).find((candidate) => candidate.key === key)!;
      expect(field.type).toBe("reference");
      expect(field.filterBinding?.referenceResource).toBe(target);
    }
  });

  it("marks multi-value fields, number formats and structured policy explicitly", () => {
    expect(tablePermissionFieldsFor("equipment-register" as never).find((field) => field.key === "responsibleUserIds")?.multiple).toBe(true);
    expect(tablePermissionFieldsFor("equipment-register" as never).find((field) => field.key === "plannedStartupMinutes")?.format).toBe("durationMinutes");
    expect(tablePermissionFieldsFor("mps-group-plans" as never).find((field) => field.key === "completionRate")?.format).toBe("percentage");
    expect(tablePermissionFieldsFor("mps-group-plans" as never).find((field) => field.key === "orderAmount")?.format).toBe("currency");
    const structured = tablePermissionFieldsFor("mps-system-settings" as never).find((field) => field.key === "valueJson")!;
    expect(structured.type).toBe("structured");
    expect(structured.filterable).toBe(false);
    expect(isTableFieldFilterable(structured)).toBe(false);
  });

  it("derives operators from the field type and exposes a single dynamic-date keyword list", () => {
    const operators = (resource: string, key: string) => tableFilterOperatorsFor(tablePermissionFieldsFor(resource as never).find((field) => field.key === key)!).map((entry) => entry.operator);
    expect(operators("mps-process-reports", "orderNumber")).toEqual(expect.arrayContaining(["contains", "in", "is_empty"]));
    expect(operators("mps-process-reports", "productionQuantity")).toEqual(expect.arrayContaining(["gt", "between", "not_in"]));
    expect(operators("mps-process-reports", "productionDate")).toEqual(expect.arrayContaining(["date_eq", "date_between", "date_dynamic"]));
    expect(operators("mps-process-reports", "processCode")).toEqual(expect.arrayContaining(["eq", "in", "is_not_empty"]));
    expect(operators("mps-process-reports", "processCode")).not.toContain("contains");
    expect(tableFilterDynamicDateKeys).toContain("this_month");
  });

  it("keeps the process dictionary field filterable so the UI can offer the canonical 10 processes", () => {
    /* 工序候选值由主计划平台从 @tracker/shared 的 canonical registry 注入（不在此重复维护名单）。 */
    const field = tablePermissionFieldsFor("mps-process-reports" as never).find((candidate) => candidate.key === "processCode")!;
    expect(field.type).toBe("dictionary");
    expect(isTableFieldFilterable(field)).toBe(true);
    expect(tableFilterOperatorsFor(field).map((entry) => entry.operator)).toContain("in");
  });
});

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
