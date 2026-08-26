import { CustomerImportApplicationService } from "./customer-import.application.service";
import type { CustomerDataSnapshot, CustomerImportRepository } from "./customer-import.types";

describe("CustomerImportApplicationService", () => {
  const legacy: jest.Mocked<CustomerImportRepository> = { replace: jest.fn() };
  const kdos: jest.Mocked<CustomerImportRepository> = { replace: jest.fn() };
  const service = new CustomerImportApplicationService(legacy, kdos);
  const snapshot: CustomerDataSnapshot = {
    schemaVersion: 1, source: "tplus", sourceDatabase: "UFTData418971_000003", sourceAccountName: "科加智能", division: "事业四部",
    scope: { mode: "customer", customerCode: "A027" }, extractedAt: "2026-08-25T10:00:00.000Z", idempotencyKey: "CUSTOMER:TPLUS:A027:test",
    orders: [{
      sourceOrderId: "1", sourceDetailId: "11", orderNumber: "SO001", orderDate: "2026-08-01", voucherState: 189,
      isCancelled: false, headerClosed: false, lineClosed: false, detailVoucherState: 189, auditedAt: "2026-08-01T00:00:00Z",
      customerCode: "A027", customerName: "A027", salesperson: "业务员", itemNumber: "ITEM001", itemName: "品项", specification: null,
      quantity: "10", baseQuantity: "10", unit: "件", taxPrice: "12.5", taxAmount: "125", headerTaxAmount: "125",
      deliveryDate: "2026-08-20", warehouseCode: "08", deliveredQuantity: "2", saleOutQuantity: "2", executedQuantity: "2",
      manufactureQuantity: "8", maker: "制单人", auditor: "审核人", memo: null
    }], movements: []
  };
  const actor = { userId: "00000000-0000-4000-8000-000000000001", displayName: "同步服务", requestId: "request-1", source: "API" as const };

  beforeEach(() => { jest.clearAllMocks(); legacy.replace.mockResolvedValue({ orders: 1 }); kdos.replace.mockResolvedValue({ planItems: 1 }); });

  it("normalizes one trusted customer snapshot and writes through both repositories", async () => {
    await expect(service.importSnapshot(snapshot, actor)).resolves.toMatchObject({ legacy: { orders: 1 }, kdos: { planItems: 1 } });
    expect(legacy.replace).toHaveBeenCalledWith(expect.objectContaining({ sourceSystem: "TPLUS", customerCode: "A027" }), actor);
    expect(kdos.replace).toHaveBeenCalledTimes(1);
  });

  it("rejects empty snapshots and cross-customer rows before any write", async () => {
    await expect(service.importSnapshot({ ...snapshot, orders: [] }, actor)).rejects.toThrow(/没有返回订单/);
    await expect(service.importSnapshot({ ...snapshot, orders: [{ ...snapshot.orders[0], customerCode: "B001" }] }, actor)).rejects.toThrow(/不属于客户/);
    expect(legacy.replace).not.toHaveBeenCalled(); expect(kdos.replace).not.toHaveBeenCalled();
  });
});
