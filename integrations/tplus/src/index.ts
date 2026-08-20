import type { CanonicalSalesOrder, CanonicalSalesOrderLine } from "@kdos/canonical-model";
import type { SalesOrderProvider, SalesOrderReadOptions } from "@kdos/integration-sdk";

export const tplusAccounts = {
  UFTData741219_000012: { accountName: "凯南智能", division: "事业三部" },
  UFTData418971_000003: { accountName: "科加智能", division: "事业四部" }
} as const;

export type TPlusAccountDatabase = keyof typeof tplusAccounts;
export interface TPlusOrderRow {
  sourceDatabase: TPlusAccountDatabase;
  orderNumber: string;
  orderDate?: string | null;
  customerCode?: string | null;
  customerName?: string | null;
  salesperson?: string | null;
  sourceUpdatedAt?: string | null;
  lines: Array<{ lineNumber: number; itemNumber: string; itemName?: string | null; specification?: string | null; unit?: string | null; quantity: string | number; deliveryDate?: string | null; remark?: string | null }>;
}

const text = (value: unknown) => String(value ?? "").trim();
const date = (value: unknown) => text(value).slice(0, 10) || undefined;
const decimal = (value: string | number) => {
  const normalized = text(value).replaceAll(",", "");
  if (!normalized || !Number.isFinite(Number(normalized))) throw new Error(`无效数量：${String(value)}`);
  return normalized;
};

export function mapTPlusSalesOrder(row: TPlusOrderRow): CanonicalSalesOrder {
  if (!tplusAccounts[row.sourceDatabase]) throw new Error(`不支持的 T+ 账套：${row.sourceDatabase}`);
  const orderNumber = text(row.orderNumber);
  if (!orderNumber) throw new Error("T+ 订单缺少订单号");
  const seen = new Set<number>();
  const lines: CanonicalSalesOrderLine[] = row.lines.map((line) => {
    if (seen.has(line.lineNumber)) throw new Error(`订单 ${orderNumber} 行号重复：${line.lineNumber}`);
    seen.add(line.lineNumber);
    const number = text(line.itemNumber); if (!number) throw new Error(`订单 ${orderNumber} 第 ${line.lineNumber} 行缺少品号`);
    return {
      lineNumber: line.lineNumber,
      item: { number, name: text(line.itemName) || undefined, specification: text(line.specification) || undefined, unit: text(line.unit) || undefined },
      quantity: decimal(line.quantity), deliveryDate: date(line.deliveryDate), remark: text(line.remark) || undefined
    };
  });
  return {
    sourceSystem: "TPLUS", sourceDatabase: row.sourceDatabase,
    sourceKey: `${row.sourceDatabase}:${orderNumber}`, orderNumber,
    orderDate: date(row.orderDate),
    customer: row.customerCode || row.customerName ? { code: text(row.customerCode) || undefined, name: text(row.customerName || row.customerCode) } : undefined,
    salesperson: text(row.salesperson) || undefined, enabled: true,
    sourceUpdatedAt: date(row.sourceUpdatedAt), lines
  };
}

export class TPlusSalesOrderAdapter implements SalesOrderProvider {
  readonly id = "tplus-sales-orders";
  constructor(private readonly source: (options?: SalesOrderReadOptions) => AsyncIterable<TPlusOrderRow>) {}
  async *readSalesOrders(options?: SalesOrderReadOptions): AsyncIterable<CanonicalSalesOrder> {
    const seen = new Set<string>();
    for await (const sourceRow of this.source(options)) {
      if (options?.signal?.aborted) throw options.signal.reason;
      const order = mapTPlusSalesOrder(sourceRow);
      if (seen.has(order.sourceKey)) continue;
      seen.add(order.sourceKey); yield order;
    }
  }
}
