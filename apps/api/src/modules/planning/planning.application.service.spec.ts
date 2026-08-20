import { ForbiddenException } from "@nestjs/common";
import type { PlanningRepository } from "./planning.repository";
import { PlanningApplicationService } from "./planning.application.service";
import { PlanningDomainEventBus } from "./domain-event-bus";
import type { PlanningActor } from "./planning.types";

const actor = (permissions = ["*"]): PlanningActor => ({ tenantCode: "KAINAN", userId: "00000000-0000-7000-8000-000000000001", permissions, roles: ["系统管理员"], requestId: "req-1", source: "WEB" });

describe("PlanningApplicationService", () => {
  const repository = {
    tenantId: jest.fn().mockResolvedValue("tenant-1"),
    createVersion: jest.fn(), updateItem: jest.fn(), publishVersion: jest.fn(), lockVersion: jest.fn(), unlockVersion: jest.fn(), confirmImport: jest.fn(),
    getVersion: jest.fn().mockResolvedValue({ periodId: "period-1" })
  } as unknown as jest.Mocked<PlanningRepository>;
  const events = new PlanningDomainEventBus();
  const service = new PlanningApplicationService(repository, events);

  beforeEach(() => jest.clearAllMocks());

  it("creates a Draft through the repository", async () => {
    repository.createVersion.mockResolvedValue({ id: "version-2", status: "DRAFT" } as any);
    await expect(service.createVersion("period-1", "version-1", actor())).resolves.toMatchObject({ status: "DRAFT" });
    expect(repository.createVersion).toHaveBeenCalledWith("tenant-1", "period-1", "version-1", expect.anything());
  });

  it("publishes and emits a minimal domain event", async () => {
    repository.publishVersion.mockResolvedValue({ version: { id: "version-1", status: "PUBLISHED" } as any, snapshotId: "snapshot-1", snapshotNumber: 1 });
    const listener = jest.fn(); const unsubscribe = events.subscribe(listener);
    await service.publish("period-1", "version-1", actor());
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ name: "planning.plan.published", versionId: "version-1" }));
    unsubscribe();
  });

  it("requires publish permission and server-side editable field permission", async () => {
    expect(() => service.publish("period-1", "version-1", actor(["planning.plan.read"]))).toThrow(ForbiddenException);
    expect(() => service.updateItem("item-1", { field: "balanceQuantity", value: 0, expectedVersion: 1 }, actor())).toThrow(ForbiddenException);
  });

  it("enforces lock and unlock permissions independently", () => {
    expect(() => service.lock("period-1", "version-1", "close", actor(["planning.plan.read"]))).toThrow(ForbiddenException);
    expect(() => service.unlock("period-1", "version-1", "change", actor(["planning.plan.lock"]))).toThrow(ForbiddenException);
  });

  it("keeps repeated import confirmation idempotent", async () => {
    repository.confirmImport.mockResolvedValueOnce({ versionId: "version-1", created: 2, updated: 0, repeated: false }).mockResolvedValueOnce({ versionId: "version-1", created: 2, updated: 0, repeated: true });
    await expect(service.confirmImport("job-1", actor())).resolves.toMatchObject({ repeated: false });
    await expect(service.confirmImport("job-1", actor())).resolves.toMatchObject({ repeated: true });
  });
});
