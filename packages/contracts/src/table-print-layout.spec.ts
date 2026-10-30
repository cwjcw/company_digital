import { describe, expect, it } from "vitest";
import { computePrintLayout, normalizePrintPreferences, orderedPrintHeaderGroups, printPaperDimensions, printPreferenceKey, type PrintPreferences } from "./table-print-layout";
const defaults: PrintPreferences = { version: 1, columnKeys: ["a", "b"], widths: {}, paperSize: "A4", orientation: "portrait", widthMode: "fit" };
const columns = [{ key: "a", width: 12 }, { key: "b", width: 24 }];
describe("shared print layout", () => {
  it("uses physical paper dimensions, a minimum width and exact width sum for A4/A3 in both orientations", () => {
    for (const paperSize of ["A4", "A3"] as const) for (const orientation of ["portrait", "landscape"] as const) {
      const result = computePrintLayout(columns, { ...defaults, paperSize, orientation });
      expect(result.totalWidth).toBeCloseTo(result.paper.width - 20, 8);
      expect(result.overflow).toBe(false);
      expect(result.widths.b).toBeCloseTo(result.widths.a! * 2, 8);
    }
    expect(printPaperDimensions("A3", "landscape")).toEqual({ width: 420, height: 297 });
  });
  it("keeps custom mm widths, reports overflow without dropping fields or reducing font size", () => {
    const result = computePrintLayout(columns, { ...defaults, widths: { a: 150, b: 100 }, widthMode: "custom" });
    expect(result.widths).toEqual({ a: 150, b: 100 });
    expect(result.totalWidth).toBe(250); expect(result.overflow).toBe(true);
    expect(computePrintLayout(columns, { ...defaults, widths: { a: 150, b: 100 } }).overflow).toBe(false);
    const wide = Array.from({ length: 30 }, (_, index) => ({ key: String(index), width: 10 }));
    expect(computePrintLayout(wide, { ...defaults, columnKeys: wide.map(c => c.key) }).overflow).toBe(true);
  });
  it("filters revoked/deleted/duplicate fields and malformed widths; preserves intentional empty selection", () => {
    const result = normalizePrintPreferences({ ...defaults, columnKeys: ["b", "deleted", "a", "b"], widths: { a: 25, b: -10, deleted: 20 } }, ["a", "b", "new"], defaults);
    expect(result.columnKeys).toEqual(["b", "a"]); expect(result.widths).toEqual({ a: 25 });
    expect(normalizePrintPreferences({ ...defaults, columnKeys: [] }, ["a"], defaults).columnKeys).toEqual([]);
    expect(normalizePrintPreferences({ ...defaults, columnKeys: ["deleted"] }, ["a"], defaults).columnKeys).toEqual([]);
    expect(normalizePrintPreferences(null, ["a", "b"], defaults)).toEqual(defaults);
  });
  it("isolates tenant, user, resource and view including delimiter-containing values", () => {
    const keys = [printPreferenceKey("t", "u", "r", "ACTUAL"), printPreferenceKey("t2", "u", "r", "ACTUAL"), printPreferenceKey("t", "u2", "r", "ACTUAL"), printPreferenceKey("t", "u", "r2", "ACTUAL"), printPreferenceKey("t", "u", "r", "PENDING"), printPreferenceKey("t:u", "r", "ACTUAL")];
    expect(new Set(keys).size).toBe(keys.length);
    expect(printPreferenceKey("t", "u", "r:x", "y")).not.toBe(printPreferenceKey("t", "u", "r", "x:y"));
  });
  it("rebuilds contiguous grouped headers to follow selected order with no missing or overlapping spans", () => {
    expect(orderedPrintHeaderGroups(["c", "a", "ungrouped", "b"], [{ label: "G", columns: ["a", "b"] }, { label: "H", columns: ["c"] }])).toEqual([
      { label: "H", columns: ["c"] }, { label: "G", columns: ["a"] }, { label: "", columns: ["ungrouped"] }, { label: "G", columns: ["b"] }
    ]);
  });
});
