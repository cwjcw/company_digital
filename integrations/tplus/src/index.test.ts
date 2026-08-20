import { describe, expect, it } from "vitest";
import { mapTPlusSalesOrder, TPlusSalesOrderAdapter, type TPlusOrderRow } from "./index";

const row = (database: TPlusOrderRow["sourceDatabase"], orderNumber = "SO-1"): TPlusOrderRow => ({
  sourceDatabase: database, orderNumber, orderDate: "2026-09-01", customerCode: " C01 ", customerName: "客户A",
  lines: [{ lineNumber: 1, itemNumber: " I01 ", quantity: "1,200.5000", deliveryDate: "2026-09-20" }]
});

describe("TPlusSalesOrderAdapter", () => {
  it("maps both accounts to the canonical model", () => {
    expect(mapTPlusSalesOrder(row("UFTData741219_000012")).sourceKey).toBe("UFTData741219_000012:SO-1");
    expect(mapTPlusSalesOrder(row("UFTData418971_000003", "SO-2")).lines[0]?.quantity).toBe("1200.5000");
  });
  it("is idempotent inside one source read", async () => {
    const adapter = new TPlusSalesOrderAdapter(async function* () { yield row("UFTData741219_000012"); yield row("UFTData741219_000012"); });
    const result: unknown[] = []; for await (const order of adapter.readSalesOrders()) result.push(order);
    expect(result).toHaveLength(1);
  });
});
