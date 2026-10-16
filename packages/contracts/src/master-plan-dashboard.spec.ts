import { describe, expect, it } from "vitest";
import { mpsDashboardGaps, mpsDashboardGapColumns, mpsDashboardTableKeys, mpsDashboardResource, tablePermissionFieldsFor } from "./index";

describe("shared overview and independent gaps dashboard contract", () => {
  it("locks the nine existing gaps, export keys and metric dependencies under the same resource", () => {
    expect(mpsDashboardResource).toBe("mps-overview-dashboard");
    expect(mpsDashboardGaps.map(g => g.title)).toEqual(["未进入出货计划", "未进入基础计划", "未进入周计划（已具备条件）", "计划待完善", "未开始报工", "未入库", "未完成入库", "延期未完成", "生产异常"]);
    const fields = new Set(tablePermissionFieldsFor(mpsDashboardResource).map(f => f.key));
    for (const gap of mpsDashboardGaps) {
      expect(mpsDashboardTableKeys).toContain(gap.key);
      for (const key of [gap.metric, ...gap.dependencies]) expect(fields.has(key)).toBe(true);
      expect(mpsDashboardGapColumns(gap.key).map(([key]) => key)).toEqual(expect.arrayContaining(["orderNumber", "itemCode", "currentNode", "currentStatus"]));
    }
    expect(new Set(mpsDashboardGaps.map(g => g.key)).size).toBe(9);
    expect(mpsDashboardGaps.some(g => String(g.key).includes("three-day"))).toBe(false);
  });
});
