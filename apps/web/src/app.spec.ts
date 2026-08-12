import { describe, expect, it } from "vitest";
import { excelMonthlyPlanColumns, monthlyPlanColumns, processDefinitions } from "@tracker/shared";
import { getValue } from "./api";

describe("monthly plan configuration", () => {
  it("keeps the 77-column import contract and exposes the expanded web fields", () => {
    expect(excelMonthlyPlanColumns).toHaveLength(77);
    expect(monthlyPlanColumns).toHaveLength(81);
    expect(processDefinitions).toHaveLength(14);
    expect(monthlyPlanColumns[0]?.header).toBe("序号");
    expect(monthlyPlanColumns.at(-1)?.header).toBe("所属事业部");
  });

  it("splits milestone quantities from computed statuses and adds item status", () => {
    for (const code of ["blank", "bakingPlating", "assemblyPacking"]) {
      expect(monthlyPlanColumns.find((column) => column.key === `processes.${code}.quantity`)).toMatchObject({ kind: "decimal", editable: true });
      expect(monthlyPlanColumns.find((column) => column.key === `processes.${code}.status`)).toMatchObject({ header: "状态", editable: false });
    }
    expect(monthlyPlanColumns.find((column) => column.key === "itemStatus")).toMatchObject({ header: "品号状态", editable: false });
    expect(monthlyPlanColumns.find((column) => column.key === "month")).toMatchObject({
      header: "年月", kind: "text", editable: false
    });
  });

  it("reads nested process values by field key", () => {
    expect(getValue({ processes: { drawingBom: { status: "Y" } } }, "processes.drawingBom.status")).toBe("Y");
  });
});
