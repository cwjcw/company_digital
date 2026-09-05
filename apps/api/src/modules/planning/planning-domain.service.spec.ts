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

  it("builds an exact September on-hand summary without negative outstanding quantities", () => {
    const row = (overrides: Record<string, unknown>) => ({
      id: "item-1", tenantId: "tenant-1", planVersionId: "version-1", salesOrderLineId: null,
      orderNumber: "SO-1", itemNumber: "I-1", customerCode: null, customerName: "客户甲", itemName: "产品甲",
      specification: null, orderQuantity: "10.1", productionQuantity: "10.1", historicalInboundQuantity: "2.2",
      currentInboundQuantity: "0.3", unitPrice: "1", deliveryDate: "2026-09-05", responsibleOrgId: null,
      ownerUserId: null, priority: 50, sequence: 10, status: "PENDING", exception: null, remark: null,
      imageRefs: [], legacyData: {}, version: 1, createdBy: "user-1", createdAt: new Date(), updatedBy: "user-1", updatedAt: new Date(),
      processes: { machining: { processName: "机加", dueDate: "2026-09-01", quantity: "0", status: "进行中" } },
      ...overrides
    }) as any;
    const summary = service.onHandSummary([
      row({ responsibleOrgId: "org-1" }),
      row({ id: "item-2", orderNumber: "SO-2", itemNumber: "I-2", productionQuantity: "5", historicalInboundQuantity: "6", currentInboundQuantity: "0", deliveryDate: "2026-09-30", processes: {} })
    ], "2026-09-04", new Map([["org-1", { name: "事业一部", pathLabel: "公司 / 事业一部" }]]));
    expect(summary.metrics).toMatchObject({
      itemCount: 2, orderCount: 2, customerCount: 1, productionQuantity: "15.1000",
      inboundQuantity: "8.5000", balanceQuantity: "7.6000", completionRate: 49.67
    });
    expect(summary.statusCounts).toEqual({ 完成: 1, 进行中: 0, 即将延期: 0, 延期: 1 });
    expect(summary.customerRows[0]).toMatchObject({ customer: "客户甲", balanceQuantity: "7.6000" });
    expect(summary.divisionRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ divisionId: "org-1", divisionName: "事业一部", itemCount: 1, balanceQuantity: "7.6000" }),
      expect.objectContaining({ divisionId: null, divisionName: "未归属事业部", itemCount: 1 })
    ]));
    expect(summary.processRows[0]).toMatchObject({ processName: "机加", overdueCount: 1 });
    expect(summary.warningRows[0]).toMatchObject({ orderNumber: "SO-1", balanceQuantity: "7.6000" });
  });
});
