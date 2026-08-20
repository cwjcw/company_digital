import { DomainService } from "./domain.service";

describe("DomainService", () => {
  const service = new DomainService();

  it("keeps negative balances and calculates decimal money exactly", () => {
    expect(service.itemMetrics({
      productionQuantity: "10",
      historicalInboundQuantity: "10.5",
      todayInboundQuantity: "1",
      unitPrice: "0.1"
    })).toEqual({
      productionQuantity: "10",
      completedQuantity: "11.5",
      balanceQuantity: "-1.5",
      inboundAmount: "1.1500",
      balanceAmount: "-0.1500",
      warnings: ["订单欠数为负，请核对入库数量"]
    });
  });

  it("aggregates multiple items and returns null for zero totals", () => {
    expect(service.orderMetrics([
      { productionQuantity: 30, historicalInboundQuantity: 10, todayInboundQuantity: 5 },
      { productionQuantity: 20, historicalInboundQuantity: 2, todayInboundQuantity: 3 }
    ])).toMatchObject({
      totalQuantity: "50",
      completedQuantity: "20",
      pendingQuantity: "30",
      completionRate: 0.4
    });
    expect(service.orderMetrics([]).completionRate).toBeNull();
  });

  it("keeps only positive order balances on the daily progress surface", () => {
    expect(service.hasOutstandingBalance({ productionQuantity: 10, historicalInboundQuantity: 4, todayInboundQuantity: 5 })).toBe(true);
    expect(service.hasOutstandingBalance({ productionQuantity: 10, historicalInboundQuantity: 4, todayInboundQuantity: 6 })).toBe(false);
    expect(service.hasOutstandingBalance({ productionQuantity: 10, historicalInboundQuantity: 4, todayInboundQuantity: 7 })).toBe(false);
  });

  it("uses a source-system total while keeping completion derived from item inbound", () => {
    expect(service.orderMetrics([], "125.5")).toEqual({
      totalQuantity: "125.5", completedQuantity: "0", pendingQuantity: "125.5", completionRate: 0
    });
    expect(service.orderMetrics([
      { productionQuantity: 20, historicalInboundQuantity: 12, todayInboundQuantity: 3 }
    ], "30")).toEqual({
      totalQuantity: "30", completedQuantity: "15", pendingQuantity: "15", completionRate: 0.5
    });
  });

  it("calculates milestone status from quantity, production quantity and due date", () => {
    expect(service.milestoneStatus({ quantity: "30", dueDate: "2026-08-01" }, "30", "2026-08-07")).toBe("已完成");
    expect(service.milestoneStatus({ quantity: "10", dueDate: "2026-08-08" }, "30", "2026-08-07")).toBe("进行中");
    expect(service.milestoneStatus({ quantity: "10", dueDate: "2026-08-07" }, "30", "2026-08-07")).toBe("即将延期");
    expect(service.milestoneStatus({ quantity: "10", dueDate: "2026-08-06" }, "30", "2026-08-07")).toBe("延期");
  });

  it("prioritizes overdue milestone states before inbound completion", () => {
    const completedItem = { productionQuantity: "30", historicalInboundQuantity: "20", todayInboundQuantity: "10" };
    expect(service.itemStatus(completedItem, ["已完成", "进行中", "进行中"])).toBe("完成");
    expect(service.itemStatus(completedItem, ["已完成", "即将延期", "进行中"])).toBe("即将延期");
    expect(service.itemStatus(completedItem, ["已完成", "延期", "即将延期"])).toBe("延期");
    expect(service.itemStatus({ ...completedItem, todayInboundQuantity: "5" }, ["已完成", "进行中", "进行中"])).toBe("进行中");
  });
});
