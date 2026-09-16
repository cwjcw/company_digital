import { describe, expect, it } from "vitest";
import { dictionarySeeds, processDefinitions, standardProcessCodes, standardProcesses } from "./index";

describe("canonical KDOS process registry", () => {
  it("defines exactly the ten approved standard processes in order", () => {
    expect(standardProcesses.map((process) => process.code)).toEqual([
      "cutting", "machining", "bending", "spotWelding", "welding",
      "woodworking", "grinding", "blank", "surfaceTreatment", "packaging"
    ]);
    expect(standardProcesses.map((process) => process.name)).toEqual([
      "下料", "机加", "折弯", "点焊", "焊接", "木作", "研磨", "毛坯", "表面处理", "包装"
    ]);
    expect(standardProcesses.map((process) => process.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("places 毛坯 after 研磨 and before 表面处理 with order 8 and cycleField blankDays", () => {
    const order = standardProcessCodes as readonly string[];
    expect(order.indexOf("blank")).toBe(7);
    expect(order.indexOf("blank")).toBeGreaterThan(order.indexOf("grinding"));
    expect(order.indexOf("blank")).toBeLessThan(order.indexOf("surfaceTreatment"));
    expect(standardProcesses.find((process) => process.code === "blank")).toMatchObject({ name: "毛坯", order: 8, cycleField: "blankDays" });
  });

  it("exposes one registry through both exports and never re-introduces the retired legacy codes", () => {
    expect(processDefinitions).toBe(standardProcesses);
    for (const retired of ["drawingBom", "metalMain", "woodMain", "frontParts", "woodwork", "painting", "acrylic", "bakingPlating", "rearPackingParts", "assemblyPacking"]) {
      expect(standardProcessCodes).not.toContain(retired);
    }
  });

  it("keeps every cycle field unique", () => {
    const cycleFields = standardProcesses.map((process) => process.cycleField);
    expect(new Set(cycleFields).size).toBe(cycleFields.length);
    expect(cycleFields).toContain("blankDays");
  });

  it("keeps the shared dictionary seeds used by templates, seeds and reference data", () => {
    expect(dictionarySeeds.handlingMethod).toEqual(["自制", "中心外购", "外协", "自制+外协"]);
    expect(dictionarySeeds.outsourcingMethod).toEqual(["成品", "毛坯", "部件"]);
  });
});
