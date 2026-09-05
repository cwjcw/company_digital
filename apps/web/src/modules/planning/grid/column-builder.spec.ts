import { describe, expect, it } from "vitest";
import type { ColDef, ColGroupDef } from "ag-grid-community";
import { monthlyPlanningFieldRegistry, planningFieldRegistry } from "@kdos/contracts";
import { buildPlanningColumns, monthlyPlanDisplayFields } from "./column-builder";

function leafFields(columns: Array<ColDef | ColGroupDef>): string[] {
  return columns.flatMap((column) => "children" in column && column.children
    ? leafFields(column.children as Array<ColDef | ColGroupDef>)
    : [String((column as ColDef).field)]);
}

describe("monthly planning column builder", () => {
  it("renders 82 business fields plus audit fields, with customer before order number and no monetary columns", () => {
    const fields = monthlyPlanDisplayFields(planningFieldRegistry.map((field) => ({ ...field, access: field.editable ? "EDITABLE" as const : "READONLY" as const })));
    const leaves = leafFields(buildPlanningColumns(fields, false, [], {}));
    expect(leaves.slice(0, 4)).toEqual(["sequence", "responsibleOrgId", "customer", "orderNumber"]);
    expect(leaves.slice(0, 82)).toEqual(expect.arrayContaining(monthlyPlanningFieldRegistry.map((field) => field.code).filter((code) => !["unitPrice", "inboundAmount", "balanceAmount"].includes(code))));
    expect(leaves.slice(82)).toEqual(["createdBy", "createdAt", "updatedBy", "updatedAt"]);
    expect(leaves).not.toEqual(expect.arrayContaining(["unitPrice", "inboundAmount", "balanceAmount"]));
    expect(leaves).not.toContain("priority");
    expect(leaves).not.toContain("itemStatus");
  });

  it("shows only the department name in cells while retaining full paths in the editor", () => {
    const fields = monthlyPlanDisplayFields(planningFieldRegistry.map((field) => ({ ...field, access: field.editable ? "EDITABLE" as const : "READONLY" as const })));
    const columns = buildPlanningColumns(fields, true, [], {}, new Map(), [{ id: "org-1", name: "事业一部", pathLabel: "厦门凯南展示制品有限公司 / 事业一部" }]);
    const division = columns.flatMap((entry) => "children" in entry ? entry.children ?? [] : [entry]).find((entry) => (entry as ColDef).field === "responsibleOrgId") as ColDef;
    expect((division.valueFormatter as (params: { value: string }) => string)({ value: "org-1" })).toBe("事业一部");
    expect((division.tooltipValueGetter as (params: { value: string }) => string)({ value: "org-1" })).toBe("事业一部");
    expect((division.cellEditorParams as { formatValue: (value: string) => string }).formatValue("org-1")).toBe("厦门凯南展示制品有限公司 / 事业一部");
  });
});
