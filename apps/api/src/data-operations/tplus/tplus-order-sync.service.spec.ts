import { BadRequestException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { TplusOrderSyncService } from "./tplus-order-sync.service";

describe("TplusOrderSyncService", () => {
  const service = new TplusOrderSyncService({} as DataSource);
  const snapshot = {
    beginDate: "2026-01-01",
    sourceDatabases: ["UFTData741219_000012", "UFTData418971_000003"],
    orders: [{
      sourceDatabase: "UFTData741219_000012", customerCode: " C001 ", salesperson: "张三",
      orderNumber: " SO001 ", orderDate: "2026-01-02", reviewDueDate: "2026-02-01",
      orderAmount: "1,234.50", totalQuantity: "12.5"
    }]
  };

  it("normalizes the trusted account mapping and source values", () => {
    const result = (service as any).normalizeSnapshot(snapshot);
    expect(result.rows[0]).toMatchObject({
      sourceDatabase: "UFTData741219_000012", sourceAccountName: "凯南智能", division: "事业三部",
      customer: "C001", orderNumber: "SO001", orderAmount: "1234.50", sourceTotalQuantity: "12.5"
    });
  });

  it("rejects incomplete, duplicate, invalid-date and pre-cutoff snapshots", () => {
    expect(() => (service as any).normalizeSnapshot({ ...snapshot, sourceDatabases: ["UFTData741219_000012"] }))
      .toThrow(BadRequestException);
    expect(() => (service as any).normalizeSnapshot({ ...snapshot, orders: [...snapshot.orders, ...snapshot.orders] }))
      .toThrow(/订单重复/);
    expect(() => (service as any).normalizeSnapshot({ ...snapshot, orders: [{ ...snapshot.orders[0], orderDate: "2026-02-31" }] }))
      .toThrow(/日期格式无效/);
    expect(() => (service as any).normalizeSnapshot({ ...snapshot, orders: [{ ...snapshot.orders[0], orderDate: "2025-12-31" }] }))
      .toThrow(/早于 beginDate/);
  });
});
