import { ForbiddenException } from "@nestjs/common";
import { MarketingApplicationService } from "./marketing.application.service";
import type { MarketingDirectoryQueryService } from "./marketing-directory-query.service";
import type { MarketingRepository } from "./marketing.repository";
import type { MarketingActor } from "./marketing.types";

const repository = (): jest.Mocked<MarketingRepository> => ({
  importSchedules: jest.fn(), clearSchedules: jest.fn(),
  tenantId: jest.fn().mockResolvedValue("00000000-0000-7000-8000-000000000001"),
  listMappings: jest.fn().mockResolvedValue([]), listSchedules: jest.fn().mockResolvedValue([]), listDivisionOrderReviews: jest.fn().mockResolvedValue([]), findDivisionOrderReviewsByIds: jest.fn().mockResolvedValue([]), findSchedulesByIds: jest.fn().mockResolvedValue([]), findRollingPlanItemsByBusinessKeys: jest.fn().mockResolvedValue([]),
  saveMapping: jest.fn(), replaceMappings: jest.fn(), deleteMapping: jest.fn(), saveSchedule: jest.fn(),
  batchUpdateDueDate: jest.fn(), batchDeleteSchedules: jest.fn(), syncSchedulesToRollingPlan: jest.fn(), updateDivisionReviewDueDate: jest.fn(), confirmDivisionOrderReviews: jest.fn(), syncMappingDepartmentsFromDirectory: jest.fn(), deleteSchedule: jest.fn()
});
const actor = (permissions: string[]): MarketingActor => ({
  userId: "00000000-0000-7000-8000-000000000002", username: "测试用户", tenantCode: "KAINAN", permissions, requestId: "request-1"
});
const directory = (): jest.Mocked<MarketingDirectoryQueryService> => ({
  listEnabledUsers: jest.fn().mockResolvedValue([]),
  findEnabledUsersByIds: jest.fn().mockResolvedValue([]),
  findUsersByIds: jest.fn().mockResolvedValue([]),
  findEnabledUsersInOrganization: jest.fn().mockResolvedValue([{ id: "00000000-0000-7000-8000-000000000003", displayName: "张三", departmentPaths: [["业务一部"]], enabled: true }]),
  resolveEnabledUsersByNames: jest.fn().mockResolvedValue(new Map()),
  listEnabledOrganizations: jest.fn().mockResolvedValue([
    { id: "00000000-0000-7000-8000-000000000010", name: "业务一部", parentId: null, path: ["业务一部"], pathLabel: "业务一部", enabled: true },
    { id: "00000000-0000-7000-8000-000000000011", name: "一课", parentId: "00000000-0000-7000-8000-000000000010", path: ["业务一部", "一课"], pathLabel: "业务一部 / 一课", enabled: true }
  ])
} as unknown as jest.Mocked<MarketingDirectoryQueryService>);

describe("MarketingApplicationService", () => {
  it("enforces each table action on the backend", async () => {
    const service = new MarketingApplicationService(repository(), directory());
    await expect(service.listMappings(undefined, actor([]))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listMappings(undefined, actor(["business-customer-mapping:*:read"]))).resolves.toEqual([]);
  });

  it("exposes division order reviews only through their own read permission", async () => {
    const adapter = repository();
    adapter.listDivisionOrderReviews.mockResolvedValue([{ id: "review-1", salespersonUserIds: [], status: "NORMAL" }]);
    const service = new MarketingApplicationService(adapter, directory());
    await expect(service.listDivisionOrderReviews({ page: 1, pageSize: 50 }, actor([]))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listDivisionOrderReviews({ page: 1, pageSize: 50 }, actor(["division-order-review:*:read"]))).resolves.toMatchObject({ total: 1 });
  });

  it("normalizes a void order schedule before writing it", async () => {
    const adapter = repository(); adapter.saveSchedule.mockResolvedValue({});
    const service = new MarketingApplicationService(adapter, directory());
    await service.saveSchedule(null, { customerCode: "C1", orderNumber: "SO1", itemNumber: "I1", itemName: "品项", orderTotalQuantity: "1", completionRatio: "0", status: "VOID" }, null, actor(["*"]));
    expect(adapter.saveSchedule).toHaveBeenCalledWith(expect.any(String), null, expect.objectContaining({ status: "VOID" }), null, expect.any(Object));
  });

  it("maps selected order schedules to rolling-plan rows with stable organization IDs", async () => {
    const adapter = repository();
    adapter.findSchedulesByIds.mockResolvedValue([{
      id: "00000000-0000-7000-8000-000000000050", version: 3, customerCode: "C001", orderNumber: "SO001",
      itemNumber: "ITEM001", customerDueDate: "2026-09-20", orderTotalQuantity: "12.5000", productionUnit: "业务一部", createdBy: "user-1"
    }]);
    adapter.syncSchedulesToRollingPlan.mockResolvedValue({ selected: 1, eligible: 1, matched: 0, created: 1, updated: 0, unchanged: 0, retained: 0, failed: [], repeated: false });
    const service = new MarketingApplicationService(adapter, directory());

    await service.syncSchedulesToRollingPlan([{ id: "00000000-0000-7000-8000-000000000050", expectedVersion: 3 }], "00000000-0000-7000-8000-000000000099", actor(["*"]));

    expect(adapter.syncSchedulesToRollingPlan).toHaveBeenCalledWith(expect.any(String), [expect.objectContaining({ responsibleOrgId: "00000000-0000-7000-8000-000000000010" })], 1, [], expect.any(String), expect.any(Object));
  });

  it("confirms division reviews by business key and only resolves an organization for new target rows", async () => {
    const adapter = repository();
    const firstId = "00000000-0000-7000-8000-000000000051";
    const secondId = "00000000-0000-7000-8000-000000000052";
    adapter.findDivisionOrderReviewsByIds.mockResolvedValue([
      { id: firstId, version: 2, status: "NORMAL", customerCode: "C001", orderNumber: "SO001", itemNumber: "ITEM001", itemName: "品项1", customerDueDate: "2026-09-20", divisionReviewDueDate: "2026-09-18", orderTotalQuantity: "12.5000", productionUnit: "业务一部", createdBy: "user-1" },
      { id: secondId, version: 4, status: "NORMAL", customerCode: "C002", orderNumber: "SO002", itemNumber: "ITEM002", itemName: "品项2", customerDueDate: "2026-09-21", divisionReviewDueDate: "2026-09-19", orderTotalQuantity: "8.0000", productionUnit: "业务一部", createdBy: "user-1" }
    ]);
    adapter.findRollingPlanItemsByBusinessKeys.mockResolvedValue([{ id: "target-1", orderNumber: "SO001", itemNumber: "ITEM001", createdBy: "user-1" }]);
    adapter.confirmDivisionOrderReviews.mockResolvedValue({ selected: 2, eligible: 2, matched: 1, created: 1, updated: 1, unchanged: 0, confirmed: 2, retained: 0, failed: [], repeated: false });
    const service = new MarketingApplicationService(adapter, directory());

    await service.confirmDivisionOrderReviews([
      { id: firstId, expectedVersion: 2 }, { id: secondId, expectedVersion: 4 }
    ], "00000000-0000-7000-8000-000000000099", actor(["*"]));

    expect(adapter.confirmDivisionOrderReviews).toHaveBeenCalledWith(expect.any(String), [
      expect.objectContaining({ id: firstId, responsibleOrgId: null }),
      expect.objectContaining({ id: secondId, responsibleOrgId: "00000000-0000-7000-8000-000000000010" })
    ], 2, [], expect.any(String), expect.any(Object));
  });

  it("writes one customer with stable directory user IDs", async () => {
    const adapter = repository(); adapter.saveMapping.mockResolvedValue({});
    const users = directory(); users.findEnabledUsersByIds.mockResolvedValue([{ id: "00000000-0000-7000-8000-000000000003", displayName: "张三", departmentPaths: [], enabled: true }]);
    const service = new MarketingApplicationService(adapter, users);
    await service.saveMapping(null, { department: "业务一部", section: "一课", customerCode: "A001", salespersonUserIds: ["00000000-0000-7000-8000-000000000003"] }, null, actor(["business-customer-mapping:*:create"]));
    expect(adapter.saveMapping).toHaveBeenCalledWith(expect.any(String), null, expect.objectContaining({ customerCode: "A001", salespersonUserIds: ["00000000-0000-7000-8000-000000000003"] }), null, expect.any(Object));
  });

  it("uses a stable organization ID for same-name departments while keeping section as text", async () => {
    const adapter = repository(); adapter.saveMapping.mockResolvedValue({});
    const users = directory();
    users.listEnabledOrganizations.mockResolvedValue([
      { id: "00000000-0000-7000-8000-000000000020", name: "营销中心", parentId: null, path: ["营销中心"], pathLabel: "营销中心", enabled: true },
      { id: "00000000-0000-7000-8000-000000000021", name: "营销中心", parentId: "00000000-0000-7000-8000-000000000020", path: ["营销中心", "营销中心"], pathLabel: "营销中心 / 营销中心", enabled: true }
    ]);
    const service = new MarketingApplicationService(adapter, users);
    await service.saveMapping(null, { departmentId: "00000000-0000-7000-8000-000000000021", section: "营销中心", customerCode: "A002", salespersonUserIds: [] }, null, actor(["business-customer-mapping:*:create"]));
    expect(adapter.saveMapping).toHaveBeenCalledWith(expect.any(String), null, expect.objectContaining({ departmentId: "00000000-0000-7000-8000-000000000021", department: "营销中心", section: "营销中心" }), null, expect.any(Object));
  });

  it("filters department data by the current leader's live department subtree", async () => {
    const adapter = repository();
    adapter.listMappings.mockResolvedValue([
      { id: "mapping-1", departmentId: "org-led", department: "一部", section: "", customerCode: "A001", salespersonUserIds: [] },
      { id: "mapping-2", departmentId: "org-other", department: "二部", section: "", customerCode: "A002", salespersonUserIds: [] }
    ]);
    const service = new MarketingApplicationService(adapter, directory());
    const scopedActor: MarketingActor = { ...actor(["business-customer-mapping:*:read"]), managedOrganizationUnitIds: ["org-led"], tableDataScopes: [{ resource: "business-customer-mapping", groupId: "group-1", scope: "CUSTOM", match: "ALL", actions: ["read"], rules: [{ fieldKey: "departmentId", operator: "EQ", value: "CURRENT_USER_MANAGED_DEPARTMENTS" }] }] };
    await expect(service.listMappings(undefined, scopedActor)).resolves.toEqual([expect.objectContaining({ id: "mapping-1" })]);
  });

  it("resolves CURRENT_USER when a member-array rule contains the logged-in salesperson", async () => {
    const adapter = repository();
    adapter.listSchedules.mockResolvedValue([
      { id: "schedule-visible", departmentId: "org-1", department: "一部", section: "一课", customerCode: "A001", orderNumber: "SO1", itemNumber: "I1", itemName: "品项", productionUnit: null, salespersonUserIds: ["00000000-0000-7000-8000-000000000002"] },
      { id: "schedule-hidden", departmentId: "org-1", department: "一部", section: "一课", customerCode: "A002", orderNumber: "SO2", itemNumber: "I2", itemName: "品项", productionUnit: null, salespersonUserIds: ["00000000-0000-7000-8000-000000000099"] }
    ]);
    const service = new MarketingApplicationService(adapter, directory());
    const scopedActor: MarketingActor = { ...actor(["order-schedule:*:read"]), tableDataScopes: [{ resource: "order-schedule", groupId: "group-sales", scope: "CUSTOM", match: "ALL", actions: ["read"], rules: [{ fieldKey: "salespersonUserIds", operator: "CONTAINS", value: "CURRENT_USER" }] }] };
    await expect(service.listSchedules(undefined, scopedActor)).resolves.toEqual([expect.objectContaining({ id: "schedule-visible" })]);
  });

  it("updates departments from the first enabled salesperson's latest primary directory path", async () => {
    const adapter = repository();
    adapter.listMappings.mockResolvedValue([{ id: "mapping-1", customerCode: "A001", salespersonUserIds: ["user-disabled", "user-enabled"] }]);
    adapter.syncMappingDepartmentsFromDirectory.mockResolvedValue({ sourceCustomers: 1, resolved: 1, mappingsUpdated: 1, skipped: [] });
    const users = directory();
    users.findUsersByIds.mockResolvedValue([
      { id: "user-disabled", displayName: "离职人员", departmentPaths: [["公司", "旧部门"]], enabled: false },
      { id: "user-enabled", displayName: "在职人员", departmentPaths: [["公司", "营销中心", "业务一部（欧美）"]], enabled: true }
    ]);
    users.listEnabledOrganizations.mockResolvedValue([{ id: "org-eu", name: "业务一部（欧美）", parentId: null, path: ["公司", "营销中心", "营销中心", "业务一部（欧美）"], pathLabel: "公司 / 营销中心 / 营销中心 / 业务一部（欧美）", enabled: true }]);
    const service = new MarketingApplicationService(adapter, users);

    await expect(service.syncMappingDepartmentsFromDirectory(actor(["business-customer-mapping:*:import"]))).resolves.toMatchObject({ mappingsUpdated: 1 });
    expect(adapter.syncMappingDepartmentsFromDirectory).toHaveBeenCalledWith(expect.any(String), [{ id: "mapping-1", departmentId: "org-eu", department: "业务一部（欧美）" }], [], expect.any(Object));
  });

  it("deletes selected schedules only with delete permission and matching data scope", async () => {
    const adapter = repository();
    const ownedId = "00000000-0000-7000-8000-000000000031";
    const otherId = "00000000-0000-7000-8000-000000000032";
    adapter.findSchedulesByIds.mockResolvedValue([
      { id: ownedId, version: 3, createdBy: "00000000-0000-7000-8000-000000000002" },
      { id: otherId, version: 2, createdBy: "another-user" }
    ]);
    adapter.batchDeleteSchedules.mockResolvedValue({ deleted: 1 });
    const service = new MarketingApplicationService(adapter, directory());

    await expect(service.batchDeleteSchedules([{ id: ownedId, expectedVersion: 3 }], actor([]))).rejects.toBeInstanceOf(ForbiddenException);
    const scopedActor: MarketingActor = { ...actor(["order-schedule:*:delete"]), tableDataScopes: [{ resource: "order-schedule", groupId: "group-own", scope: "OWN", match: "ALL", actions: ["delete"], rules: [] }] };
    await expect(service.batchDeleteSchedules([{ id: otherId, expectedVersion: 2 }], scopedActor)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.batchDeleteSchedules([{ id: ownedId, expectedVersion: 3 }], scopedActor)).resolves.toEqual({ deleted: 1 });
    expect(adapter.batchDeleteSchedules).toHaveBeenCalledWith(expect.any(String), [{ id: ownedId, expectedVersion: 3 }], expect.any(Object));
  });
});
