import { describe, expect, it } from "vitest";
import { standardProcesses } from "@tracker/shared";
import { formatProductionProgress, processColor, processColorClass, progressCellClass, progressCellStyle } from "./MasterPlanPages";

/**
 * KN-MPS-EXEC-001：工序配色、生产进度格式与「>=100% 只高亮进度单元格」的平台规则。
 */
describe("KN-MPS-EXEC-001 工序配色与生产进度", () => {
  it("颜色按 process.order 分配且相邻工序不同（无逐工序硬编码 if）", () => {
    const ordered = [...standardProcesses].sort((left, right) => left.order - right.order);
    const tokens = ordered.map((process) => processColorClass(process.code));
    expect(new Set(tokens).size).toBe(ordered.length);
    for (let index = 1; index < ordered.length; index++) {
      const previous = processColor(ordered[index - 1]!.order);
      const current = processColor(ordered[index]!.order);
      expect(current.header).not.toBe(previous.header);
      expect(current.cell).not.toBe(previous.cell);
    }
    /* 同一工序在周计划/月计划使用同一函数 → 颜色稳定一致（与资源无关）。 */
    expect(processColor(8)).toEqual(processColor(8));
    /* 三层结构：一级表头较明显、二级更浅、单元格极浅。 */
    const color = processColor(3);
    expect(color.header).not.toBe(color.sub);
    expect(color.sub).not.toBe(color.cell);
  });

  it("生产进度格式：ratio→百分比，允许超过 100%，需求缺失显示 —", () => {
    expect(formatProductionProgress(1.05)).toBe("105%");
    expect(formatProductionProgress(1)).toBe("100%");
    expect(formatProductionProgress(0.7143)).toBe("71.4%");
    expect(formatProductionProgress(0)).toBe("0%");
    expect(formatProductionProgress(1.3)).toBe("130%");
    expect(formatProductionProgress(null)).toBe("—");
    expect(formatProductionProgress(undefined)).toBe("—");
    expect(formatProductionProgress("")).toBe("—");
  });

  it(">=100% 只让生产进度单元格变绿（<100% 不绿，其他字段不受影响）", () => {
    expect(progressCellClass(1.05)).toContain("kdos-progress-satisfied");
    expect(progressCellStyle(1.05)).toMatchObject({ fontWeight: 600 });
    expect(progressCellClass(0.99)).not.toContain("kdos-progress-satisfied");
    expect(progressCellStyle(0.99)).toBeUndefined();
    expect(progressCellClass(null)).not.toContain("kdos-progress-satisfied");
    expect(progressCellClass(1)).toContain("kdos-progress-satisfied");
  });

  it("工序分组结构来自 canonical registry（10 个工序，毛坯在研磨与表面处理之间）", () => {
    const ordered = [...standardProcesses].sort((left, right) => left.order - right.order).map((process) => process.name);
    expect(ordered).toEqual(["下料", "机加", "折弯", "点焊", "焊接", "木作", "研磨", "毛坯", "表面处理", "包装"]);
    expect(ordered.indexOf("研磨")).toBeLessThan(ordered.indexOf("毛坯"));
    expect(ordered.indexOf("毛坯")).toBeLessThan(ordered.indexOf("表面处理"));
  });
});
