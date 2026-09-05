import { ForbiddenException } from "@nestjs/common";
import { PlanningDomainService } from "./planning-domain.service";
import { PlanQueryService } from "./planning.query.service";

describe("PlanQueryService on-hand dashboard", () => {
  const planRow = (createdBy: string, orderNumber: string) => ({
    id: `item-${orderNumber}`, tenantId: "tenant-1", planVersionId: "version-draft", salesOrderLineId: null,
    orderNumber, itemNumber: `ITEM-${orderNumber}`, customerCode: null, customerName: "客户甲", itemName: "产品",
    specification: null, orderQuantity: "10", productionQuantity: "10", historicalInboundQuantity: "2",
    currentInboundQuantity: "1", unitPrice: "1", deliveryDate: "2026-09-08", responsibleOrgId: "org-1",
    ownerUserId: null, priority: 50, sequence: 10, status: "PENDING", exception: null, remark: null,
    imageRefs: [], legacyData: {}, version: 1, createdBy, createdAt: new Date(), updatedBy: createdBy, updatedAt: new Date(), processes: {}
  });
  const repository = {
    tenantId: jest.fn().mockResolvedValue("tenant-1"),
    periodByMonth: jest.fn().mockResolvedValue({
      id: "period-1", currentVersionId: "version-published",
      versions: [
        { id: "version-published", name: "v1", status: "PUBLISHED" },
        { id: "version-draft", name: "9月计划草稿", status: "DRAFT" }
      ]
    }),
    searchItems: jest.fn().mockResolvedValue([planRow("user-1", "SO-1"), planRow("user-2", "SO-2")]),
    countItems: jest.fn().mockResolvedValue(2)
  } as any;
  const directory = { listEnabled: jest.fn().mockResolvedValue([{ id: "org-1", name: "事业一部", path: ["公司", "事业一部"], pathLabel: "公司 / 事业一部" }]) } as any;

  beforeEach(() => jest.clearAllMocks());

  it("requires the report's own read permission", async () => {
    const service = new PlanQueryService(repository, new PlanningDomainService(), directory);
    await expect(service.getOnHandSummary(2026, 9, {
      tenantCode: "KAINAN", userId: "user-1", permissions: ["monthly-plan:*:read"], roles: [], requestId: "request-1", source: "WEB"
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("uses the same draft-first version as the September plan and applies OWN data scope", async () => {
    const service = new PlanQueryService(repository, new PlanningDomainService(), directory);
    const result = await service.getOnHandSummary(2026, 9, {
      tenantCode: "KAINAN", userId: "user-1",
      permissions: ["on-hand-summary-dashboard:*:read", "on-hand-summary-dashboard:itemCount:read", "on-hand-summary-dashboard:balanceQuantity:read", "on-hand-summary-dashboard:responsibleOrgId:read"],
      roles: [], requestId: "request-1", source: "WEB",
      tableDataScopes: [{ resource: "on-hand-summary-dashboard", groupId: "group-1", scope: "OWN", actions: ["read"] }]
    });
    expect(repository.searchItems).toHaveBeenCalledWith("tenant-1", { versionId: "version-draft", limit: 10_000 });
    expect(result.source).toMatchObject({ year: 2026, month: 9, versionId: "version-draft", versionName: "9月计划草稿", versionStatus: "DRAFT" });
    expect(result.metrics).toEqual({ itemCount: 1, balanceQuantity: "7.0000" });
    expect(result.divisionRows).toEqual([expect.objectContaining({ divisionId: "org-1", divisionName: "事业一部", itemCount: 1, balanceQuantity: "7.0000" })]);
    expect(result.customerRows).toEqual([]);
  });

  it("resolves the standard department-name filter to stable organization IDs before paging", async () => {
    const service = new PlanQueryService(repository, new PlanningDomainService(), directory);
    await service.searchPlanItemsPage({
      versionId: "version-draft", page: 1, pageSize: 50, filters: { responsibleOrgId: "事业一部" }
    }, {
      tenantCode: "KAINAN", userId: "user-1", permissions: ["*"], roles: [], requestId: "request-1", source: "WEB"
    });
    expect(repository.searchItems).toHaveBeenCalledWith("tenant-1", expect.objectContaining({
      responsibleOrgIds: ["org-1"], filters: {}, limit: 50, offset: 0
    }));
    expect(repository.countItems).toHaveBeenCalledWith("tenant-1", expect.objectContaining({ responsibleOrgIds: ["org-1"] }));
  });
});
