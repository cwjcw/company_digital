import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { excelMonthlyPlanColumns, monthlyPlanColumns, processDefinitions } from "@tracker/shared";
import { containsText, getValue } from "./api";
import { kdosSystemFieldDefinitions } from "./shared/KdosDataTable";

function tsxFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? tsxFiles(full) : entry.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("monthly plan configuration", () => {
  it("uses the exact 84-column monthly-plan contract", () => {
    expect(excelMonthlyPlanColumns).toHaveLength(84);
    expect(monthlyPlanColumns).toHaveLength(84);
    expect(processDefinitions).toHaveLength(14);
    expect(monthlyPlanColumns[0]?.header).toBe("序号");
    expect(monthlyPlanColumns.at(-1)?.header).toBe("客户");
  });

  it("uses four exact fields for every displayed process", () => {
    for (const code of ["drawingBom", "metalMain", "woodMain", "machining", "welding", "blank", "bakingPlating", "acrylic", "painting", "assemblyPacking", "rearPackingParts"]) {
      expect(monthlyPlanColumns.filter((column) => column.key.startsWith(`processes.${code}.`)).map((column) => column.header))
        .toEqual(["所需周期", "交期", "状态", "异常"]);
    }
    expect(monthlyPlanColumns.find((column) => column.key === "month")).toMatchObject({
      header: "月", kind: "decimal", editable: true
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

  it("uses the unified KDOS table shell and exact read-only system fields", () => {
    expect(kdosSystemFieldDefinitions.map(({ key, label }) => [key, label])).toEqual([
      ["createdBy", "创建人"], ["createdAt", "创建时间"], ["updatedBy", "更新人"], ["updatedAt", "更新时间"]
    ]);
    const sourceRoot = path.resolve(__dirname);
    const directLegacyTables = tsxFiles(sourceRoot)
      .filter((file) => !file.endsWith("KdosDataTable.tsx"))
      .filter((file) => /<Table(?:\s|>)/.test(fs.readFileSync(file, "utf8")));
    expect(directLegacyTables).toEqual([]);
  });
});
