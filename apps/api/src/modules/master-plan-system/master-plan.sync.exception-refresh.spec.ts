import { MasterPlanSyncService } from "./master-plan.sync.service";

describe("master-plan exception refresh notification", () => {
  it("notifies only upserted exception versions and resolves rows missing from the current source scan", async () => {
    const manager = { query: jest.fn().mockResolvedValue([{
      exception_key: "allocation:ORD-1:ITEM-1:missing-customer-code", exception_type: "MISSING_CUSTOMER_CODE",
      version: 2, resource: "mps-order-allocations", record_id: "allocation-id", business_key: "ORD-1/ITEM-1",
      message: "订单缺少客户代码，请核对来源数据", created_by: null
    }]) };
    const exceptionNotifications = { enqueueBusinessException: jest.fn().mockResolvedValue({ created: true }) };
    const service = new MasterPlanSyncService({} as any, exceptionNotifications as any);

    await (service as any).refreshExceptions(manager, "KAINAN", null, "system-id");

    expect(manager.query).toHaveBeenCalledTimes(1);
    const sql = String(manager.query.mock.calls[0][0]);
    expect(sql).toContain("IS DISTINCT FROM");
    expect(sql).toContain("AND NOT EXISTS(SELECT 1 FROM exceptions current");
    expect(exceptionNotifications.enqueueBusinessException).toHaveBeenCalledWith(manager, "KAINAN", expect.objectContaining({ version: 2 }));
  });

  it("does not emit an immediate notice when no active exception changed", async () => {
    const manager = { query: jest.fn().mockResolvedValue([]) };
    const exceptionNotifications = { enqueueBusinessException: jest.fn() };
    const service = new MasterPlanSyncService({} as any, exceptionNotifications as any);
    await (service as any).refreshExceptions(manager, "KAINAN", null, "system-id");
    expect(exceptionNotifications.enqueueBusinessException).not.toHaveBeenCalled();
  });
});
