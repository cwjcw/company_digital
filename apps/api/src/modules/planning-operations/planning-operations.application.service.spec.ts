import { ForbiddenException } from "@nestjs/common";
import type { PlanningActor } from "../planning/planning.types";
import { PlanningOperationsApplicationService, shanghaiDate } from "./planning-operations.application.service";
import type { PlanningOperationsRepository } from "./planning-operations.repository";

const actor = (permissions: string[]): PlanningActor => ({
  tenantCode: "KAINAN", userId: "00000000-0000-7000-8000-000000000001", permissions,
  roles: ["系统管理员"], requestId: "request-1", source: "WEB"
});

const repository = (): jest.Mocked<PlanningOperationsRepository> => ({
  tenantId: jest.fn().mockResolvedValue("00000000-0000-7000-8000-000000000002"),
  listWeeklyPeriods: jest.fn(), listRollingPlanItems: jest.fn().mockResolvedValue([]), listWeeklyItems: jest.fn(), updateWeeklyDate: jest.fn(),
  listWorkReports: jest.fn(), syncWorkReports: jest.fn(), updateReportedQuantity: jest.fn()
});
const directory = { listEnabled: jest.fn().mockResolvedValue([]) } as any;

describe("PlanningOperationsApplicationService", () => {
  afterEach(() => jest.useRealTimers());

  it("uses the server Shanghai date to choose the weekly plan", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-26T16:30:00.000Z"));
    const adapter = repository();
    adapter.listWeeklyPeriods.mockResolvedValue([]);
    const service = new PlanningOperationsApplicationService(adapter, directory);

    await service.weeklyPeriods(actor(["weekly-plan:*:read"]));

    expect(shanghaiDate()).toBe("2026-08-27");
    expect(adapter.listWeeklyPeriods).toHaveBeenCalledWith(expect.any(String), "2026-08-27");
  });

  it("passes the selected work date to the monthly-plan matching command", async () => {
    const adapter = repository();
    adapter.syncWorkReports.mockResolvedValue({
      date: "2026-08-27", planPeriodId: "month-8", planVersionId: "version-1", sourceCount: 2,
      matched: 1, created: 1, updated: 1, unchanged: 0, removedStale: 0, preservedReported: 0
    });
    const service = new PlanningOperationsApplicationService(adapter, directory);

    await service.syncWorkReports("2026-08-27", actor(["work-report:*:import"]));

    expect(adapter.syncWorkReports).toHaveBeenCalledWith(expect.any(String), "2026-08-27", expect.any(Object));
  });

  it("rejects the work-report import without the table-specific import permission", async () => {
    const service = new PlanningOperationsApplicationService(repository(), directory);
    await expect(service.syncWorkReports("2026-08-27", actor([]))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
