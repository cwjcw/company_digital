import { PlanningDomainService } from "./planning-domain.service";

describe("PlanningDomainService", () => {
  const service = new PlanningDomainService();
  it("uses exact decimals for balance, completion and money", () => {
    expect(service.metrics({ productionQuantity: "10.1", historicalInboundQuantity: "2.2", currentInboundQuantity: "0.3", unitPrice: "19.99" })).toEqual({
      inboundQuantity: "2.5000", balanceQuantity: "7.6000", completionRate: 0.24752475,
      inboundAmount: "49.975000", balanceAmount: "151.924000"
    });
  });
  it("prioritizes overdue processes and then completed items", () => {
    expect(service.processStatus({ completedQuantity: "9", plannedDate: "2026-08-19" }, "10", "2026-08-20")).toBe("延期");
    expect(service.processStatus({ completedQuantity: "10", plannedDate: "2026-08-20" }, "10", "2026-08-20")).toBe("已完成");
    expect(service.itemStatus("0", [])).toBe("完成");
  });
});
