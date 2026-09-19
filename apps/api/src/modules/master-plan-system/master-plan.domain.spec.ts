import { aggregateGroup, allocateInboundFifo, outsourcingStatus, processStatus, reverseSchedule, shouldEnableProcess } from "./master-plan.domain";

describe("master plan domain", () => {
  it.each([
    ["自制", "packaging", true], ["自制+外协", "packaging", true], ["外协", "packaging", true], ["中心外购", "packaging", true],
    ["外协", "cutting", false], ["中心外购", "welding", false], ["自制", "cutting", true], ["自制+外协", "welding", true]
  ])("enables %s / %s = %s through the single process rule", (manufacturingMethod, processCode, expected) => {
    expect(shouldEnableProcess(manufacturingMethod, processCode)).toBe(expected);
  });

  it("reverse schedules natural dates and keeps zero-day processes on the cursor", () => {
    const rows = reverseSchedule("2026-09-20", { packagingDays: 2, surfaceTreatmentDays: 0, grindingDays: 3 });
    expect(rows.find((row) => row.code === "packaging")?.dueDate).toBe("2026-09-20");
    expect(rows.find((row) => row.code === "surfaceTreatment")?.dueDate).toBe("2026-09-18");
    expect(rows.find((row) => row.code === "grinding")?.dueDate).toBe("2026-09-18");
    expect(rows.find((row) => row.code === "welding")?.dueDate).toBeNull();
  });

  it("allocates inbound by due date then delivery number", () => {
    const rows = allocateInboundFifo([
      { id: "b", dueDate: "2026-09-20", deliveryNumber: 2, plannedQuantity: 7 },
      { id: "a", dueDate: "2026-09-10", deliveryNumber: 1, plannedQuantity: 5 }
    ], 8);
    expect(rows.map((row) => [row.id, row.allocatedQuantity, row.pendingQuantity])).toEqual([["a", "5.0000", "0.0000"], ["b", "3.0000", "4.0000"]]);
  });

  it("computes statuses with completion taking precedence", () => {
    expect(processStatus(10, 10, "2026-09-01", "2026-09-10")).toBe("已完成");
    expect(processStatus(10, 1, "2026-09-01", "2026-09-10")).toBe("延期");
    expect(processStatus(10, 1, "2026-09-20", "2026-09-10")).toBe("进行中");
    expect(outsourcingStatus({ purchaseOrderNumber: "", dueDate: "2026-09-01", today: "2026-09-10" })).toBe("未开始");
  });

  it("uses an arithmetic average of item completion rates", () => {
    expect(aggregateGroup([{ requiredQuantity: 100, inboundQuantity: 100 }, { requiredQuantity: 1, inboundQuantity: 0 }])).toEqual({
      requiredQuantity: "101.0000", completedQuantity: "100.0000", pendingQuantity: "1.0000", completionRate: "0.5"
    });
  });

  it("reverse schedules the ten canonical processes by natural days from the review anchor", () => {
    const rows = reverseSchedule("2026-10-20", {
      cuttingDays: 1, machiningDays: 2, bendingDays: 1, spotWeldingDays: 1,
      weldingDays: 2, woodworkingDays: 0, grindingDays: 1, blankDays: 2,
      surfaceTreatmentDays: 3, packagingDays: 1
    });
    /* 毛坯（blank）位于研磨之后、表面处理之前：正向顺序即 sequence 1..10。 */
    expect(rows.map((row) => [row.code, row.sequence])).toEqual([
      ["cutting", 1], ["machining", 2], ["bending", 3], ["spotWelding", 4], ["welding", 5],
      ["woodworking", 6], ["grinding", 7], ["blank", 8], ["surfaceTreatment", 9], ["packaging", 10]
    ]);
    expect(Object.fromEntries(rows.map((row) => [row.code, row.dueDate]))).toEqual({
      cutting: "2026-10-07", machining: "2026-10-09", bending: "2026-10-10",
      spotWelding: "2026-10-11", welding: "2026-10-13", woodworking: "2026-10-13",
      grinding: "2026-10-14", blank: "2026-10-16", surfaceTreatment: "2026-10-19", packaging: "2026-10-20"
    });
  });

  it("keeps 毛坯 in the reverse chain when blankDays is null without breaking the schedule", () => {
    const rows = reverseSchedule("2026-10-20", { grindingDays: 1, surfaceTreatmentDays: 1, packagingDays: 1 });
    const blank = rows.find((row) => row.code === "blank")!;
    expect(blank).toMatchObject({ name: "毛坯", sequence: 8, cycleDays: null, dueDate: null });
    /* 未维护毛坯周期时不得阻止其它工序生成计划。 */
    expect(rows.filter((row) => row.dueDate).map((row) => row.code)).toEqual(["grinding", "surfaceTreatment", "packaging"]);
  });

  it("carries 毛坯 days through the reverse chain when configured", () => {
    const rows = reverseSchedule("2026-10-20", { blankDays: 5, surfaceTreatmentDays: 1, packagingDays: 1 });
    expect(rows.find((row) => row.code === "blank")).toMatchObject({ cycleDays: 5, dueDate: "2026-10-18" });
    expect(rows.find((row) => row.code === "surfaceTreatment")?.dueDate).toBe("2026-10-19");
  });

  it("keeps FIFO allocations capped while preserving excess inbound outside deliveries", () => {
    const deliveries = [
      { id: "1", dueDate: "2026-10-01", deliveryNumber: 1, plannedQuantity: 100 },
      { id: "2", dueDate: "2026-10-02", deliveryNumber: 2, plannedQuantity: 200 },
      { id: "3", dueDate: "2026-10-03", deliveryNumber: 3, plannedQuantity: 150 }
    ];
    expect(allocateInboundFifo(deliveries, 80).map((row) => row.allocatedQuantity)).toEqual(["80.0000", "0.0000", "0.0000"]);
    expect(allocateInboundFifo(deliveries, 150).map((row) => row.allocatedQuantity)).toEqual(["100.0000", "50.0000", "0.0000"]);
    expect(allocateInboundFifo(deliveries, 330).map((row) => row.allocatedQuantity)).toEqual(["100.0000", "200.0000", "30.0000"]);
    expect(allocateInboundFifo(deliveries, 500).map((row) => row.allocatedQuantity)).toEqual(["100.0000", "200.0000", "150.0000"]);
  });

  it("accumulates repeated reports before applying process state precedence", () => {
    const reported = [30, 40, 30, 10].reduce((sum, quantity) => sum + quantity, 0);
    expect(processStatus(100, 30, "2026-10-20", "2026-10-10")).toBe("进行中");
    expect(processStatus(100, 70, "2026-10-20", "2026-10-10")).toBe("进行中");
    expect(processStatus(100, 100, "2026-10-20", "2026-10-10")).toBe("已完成");
    expect(processStatus(100, reported, "2026-10-01", "2026-10-10")).toBe("已完成");
  });

  it("covers all four outsourcing states", () => {
    expect(outsourcingStatus({ today: "2026-10-10" })).toBe("未开始");
    expect(outsourcingStatus({ purchaseOrderNumber: "PO1", dueDate: "2026-10-20", today: "2026-10-10" })).toBe("进行中");
    expect(outsourcingStatus({ purchaseOrderNumber: "PO1", dueDate: "2026-10-01", today: "2026-10-10" })).toBe("延期");
    expect(outsourcingStatus({ purchaseOrderNumber: "PO1", dueDate: "2026-10-01", actualInboundDate: "2026-10-09", today: "2026-10-10" })).toBe("已入库");
  });

  it("caps each item before calculating group quantities and arithmetic completion", () => {
    expect(aggregateGroup([
      { requiredQuantity: 100, inboundQuantity: 120 },
      { requiredQuantity: 200, inboundQuantity: 100 },
      { requiredQuantity: 50, inboundQuantity: 0 }
    ])).toEqual({ requiredQuantity: "350.0000", completedQuantity: "200.0000", pendingQuantity: "150.0000", completionRate: "0.5" });
  });
});
