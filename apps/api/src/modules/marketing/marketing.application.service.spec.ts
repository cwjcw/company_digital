import { ForbiddenException } from "@nestjs/common";
import { MarketingApplicationService } from "./marketing.application.service";
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

describe("MarketingApplicationService", () => {
  it("enforces each table action on the backend", async () => {
    const service = new MarketingApplicationService(repository());
    await expect(service.listMappings(undefined, actor([]))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listMappings(undefined, actor(["business-customer-mapping:*:read"]))).resolves.toEqual([]);
  });

  it("normalizes multi-customer codes before writing", async () => {
    const adapter = repository(); adapter.saveMapping.mockResolvedValue({});
    const service = new MarketingApplicationService(adapter);
    await service.saveMapping(null, { department: "业务一部", section: "一课", salesperson: "张三", customerCodes: "A001， A002|A001" }, null, actor(["business-customer-mapping:*:create"]));
    expect(adapter.saveMapping).toHaveBeenCalledWith(expect.any(String), null, expect.objectContaining({ customerCodes: "A001|A002" }), null, expect.any(Object));
  });
});
