import { aggregateGroup, allocateInboundFifo, outsourcingStatus, processStatus, reverseSchedule } from "./master-plan.domain";

describe("master plan domain", () => {
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

  it("reverse schedules all nine processes by natural days from the review anchor", () => {
    const rows = reverseSchedule("2026-10-20", {
      cuttingDays: 1, machiningDays: 2, bendingDays: 1, spotWeldingDays: 1,
      weldingDays: 2, woodworkingDays: 0, grindingDays: 1,
      surfaceTreatmentDays: 3, packagingDays: 1
    });
    expect(Object.fromEntries(rows.map((row) => [row.code, row.dueDate]))).toEqual({
      cutting: "2026-10-09", machining: "2026-10-11", bending: "2026-10-12",
      spotWelding: "2026-10-13", welding: "2026-10-15", woodworking: "2026-10-15",
      grinding: "2026-10-16", surfaceTreatment: "2026-10-19", packaging: "2026-10-20"
    });
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
