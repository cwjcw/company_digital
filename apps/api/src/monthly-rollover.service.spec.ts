import { MonthlyRolloverService } from "./monthly-rollover.service";

describe("MonthlyRolloverService", () => {
  it("is idempotent when the month already has a version", async () => {
    const period = { id: "period", versions: [{ id: "v1" }] } as any;
    const commands = { createPeriod: jest.fn(), createVersion: jest.fn(), createItem: jest.fn() } as any;
    const queries = { getPeriodByMonth: jest.fn().mockResolvedValue(period) } as any;
    const service = new MonthlyRolloverService(commands, queries);
    const result = await service.rollover(2026, 9, { tenantCode: "KAINAN", permissions: ["*"], roles: [], userId: null, requestId: "test", source: "SYSTEM" });
    expect(result.created).toBe(false); expect(commands.createVersion).not.toHaveBeenCalled();
  });
});
