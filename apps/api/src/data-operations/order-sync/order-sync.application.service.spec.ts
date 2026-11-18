import { OrderSyncApplicationService } from "./order-sync.application.service";

describe("OrderSyncApplicationService failure notification", () => {
  const actor = { userId: "00000000-0000-7000-8000-000000000001", displayName: "sync-worker", requestId: "req-1", source: "API" as const };

  it("enqueues one deduplicated event only after a failure was persisted", async () => {
    const repository = { failRun: jest.fn().mockResolvedValue({
      id: "run-1", run_type: "INCREMENTAL", completed_at: "2026-11-18T01:00:00Z", source_account_name: "科加智能",
      source_system: "T+", last_successful_sync_at: "2026-11-15T13:30:00Z",
    }) };
    const notifications = { enqueueEvent: jest.fn().mockResolvedValue({ created: true }) };
    const service = new OrderSyncApplicationService(repository as never, {} as never, notifications as never);

    await service.fail("run-1", "tplus-kejia", "阶段=INCREMENTAL，流=inbound_detail，错误=SQL Server error", 0, actor);

    expect(repository.failRun).toHaveBeenCalledWith("run-1", "tplus-kejia", expect.any(String), 0, actor);
    expect(notifications.enqueueEvent).toHaveBeenCalledTimes(1);
    expect(notifications.enqueueEvent).toHaveBeenCalledWith("KAINAN", expect.objectContaining({
      eventType: "erp.sync.failed", dedupKey: "erp-sync-failure:run-1",
      payload: expect.objectContaining({ sourceName: "科加智能", failedPhase: "INCREMENTAL", runId: "run-1" }),
    }));
  });

  it("does not enqueue a duplicate event when the run is already closed", async () => {
    const notifications = { enqueueEvent: jest.fn() };
    const service = new OrderSyncApplicationService({ failRun: jest.fn().mockResolvedValue(null) } as never, {} as never, notifications as never);
    await service.fail("run-1", "tplus-kejia", "failed", 0, actor);
    expect(notifications.enqueueEvent).not.toHaveBeenCalled();
  });

  it("does not undo the persisted failure when alert enqueue fails", async () => {
    const notifications = { enqueueEvent: jest.fn().mockRejectedValue(new Error("outbox unavailable")) };
    const service = new OrderSyncApplicationService({ failRun: jest.fn().mockResolvedValue({
      id: "run-1", run_type: "INCREMENTAL", source_account_name: "科加智能", completed_at: "2026-11-18T01:00:00Z",
    }) } as never, {} as never, notifications as never);
    await expect(service.fail("run-1", "tplus-kejia", "failed", 0, actor)).resolves.toBeTruthy();
  });
});
