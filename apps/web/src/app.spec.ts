import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { excelMonthlyPlanColumns, monthlyPlanColumns, processDefinitions } from "@tracker/shared";
import { containsText, getValue } from "./api";

describe("monthly plan configuration", () => {
  it("keeps the 93-column import contract and exposes the expanded web fields", () => {
    expect(excelMonthlyPlanColumns).toHaveLength(93);
    expect(monthlyPlanColumns).toHaveLength(97);
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

  it("matches quick text filters without case sensitivity", () => {
    expect(containsText("TEST-2026-001", "test")).toBe(true);
    expect(containsText("TEST-2026-001", "  test  ")).toBe(true);
    expect(containsText("TEST-2026-001", "2026")).toBe(true);
    expect(containsText("TEST-2026-001", "other")).toBe(false);
  });

  it("ships explicit browser icons", () => {
    const root = path.resolve(__dirname, "..");
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    expect(html).toContain('href="/favicon.ico?v=kn2"');
    expect(html).toContain('href="/apple-touch-icon.png?v=kn2"');
    expect(fs.statSync(path.join(root, "public/favicon.ico")).size).toBeGreaterThan(1000);
  });
});
