import { ForbiddenException } from "@nestjs/common";
import { MarketingApplicationService } from "./marketing.application.service";
import type { MarketingDirectoryQueryService } from "./marketing-directory-query.service";
import type { MarketingRepository } from "./marketing.repository";
import type { MarketingActor } from "./marketing.types";

const repository = (): jest.Mocked<MarketingRepository> => ({
  tenantId: jest.fn().mockResolvedValue("00000000-0000-7000-8000-000000000001"),
  listMappings: jest.fn().mockResolvedValue([]), listSchedules: jest.fn().mockResolvedValue([]),
  saveMapping: jest.fn(), replaceMappings: jest.fn(), deleteMapping: jest.fn(), saveSchedule: jest.fn(),
  batchUpdateDueDate: jest.fn(), syncSchedulesFromPlanning: jest.fn(), deleteSchedule: jest.fn()
});
const actor = (permissions: string[]): MarketingActor => ({
  userId: "00000000-0000-7000-8000-000000000002", username: "测试用户", tenantCode: "KAINAN", permissions, requestId: "request-1"
});
const directory = (): jest.Mocked<MarketingDirectoryQueryService> => ({
  listEnabledUsers: jest.fn().mockResolvedValue([]),
  findEnabledUsersByIds: jest.fn().mockResolvedValue([]),
  findUsersByIds: jest.fn().mockResolvedValue([]),
  resolveEnabledUsersByNames: jest.fn().mockResolvedValue(new Map())
} as unknown as jest.Mocked<MarketingDirectoryQueryService>);

describe("MarketingApplicationService", () => {
  it("enforces each table action on the backend", async () => {
    const service = new MarketingApplicationService(repository(), directory());
    await expect(service.listMappings(undefined, actor([]))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listMappings(undefined, actor(["business-customer-mapping:*:read"]))).resolves.toEqual([]);
  });

  it("writes one customer with stable directory user IDs", async () => {
    const adapter = repository(); adapter.saveMapping.mockResolvedValue({});
    const users = directory(); users.findEnabledUsersByIds.mockResolvedValue([{ id: "00000000-0000-7000-8000-000000000003", displayName: "张三", departmentPaths: [], enabled: true }]);
    const service = new MarketingApplicationService(adapter, users);
    await service.saveMapping(null, { department: "业务一部", section: "一课", customerCode: "A001", salespersonUserIds: ["00000000-0000-7000-8000-000000000003"] }, null, actor(["business-customer-mapping:*:create"]));
    expect(adapter.saveMapping).toHaveBeenCalledWith(expect.any(String), null, expect.objectContaining({ customerCode: "A001", salespersonUserIds: ["00000000-0000-7000-8000-000000000003"] }), null, expect.any(Object));
  });
});
