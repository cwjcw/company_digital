import { describe, expect, it } from "vitest";
import type { ColDef, ColGroupDef } from "ag-grid-community";
import { monthlyPlanningFieldRegistry, planningFieldRegistry } from "@kdos/contracts";
import { buildPlanningColumns } from "./column-builder";

function leafFields(columns: Array<ColDef | ColGroupDef>): string[] {
  return columns.flatMap((column) => "children" in column && column.children
    ? leafFields(column.children as Array<ColDef | ColGroupDef>)
    : [String((column as ColDef).field)]);
}

describe("monthly planning column builder", () => {
  it("renders exactly 84 business fields plus the four required audit fields", () => {
    const fields = planningFieldRegistry.map((field) => ({ ...field, access: field.editable ? "EDITABLE" as const : "READONLY" as const }));
    const leaves = leafFields(buildPlanningColumns(fields, false, [], {}));
    expect(leaves.slice(0, 84)).toEqual(monthlyPlanningFieldRegistry.map((field) => field.code));
    expect(leaves.slice(84)).toEqual(["createdBy", "createdAt", "updatedBy", "updatedAt"]);
    expect(leaves).not.toContain("priority");
    expect(leaves).not.toContain("itemStatus");
  });
});
