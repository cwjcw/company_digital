export interface CanonicalCustomer { code?: string; name: string; }
export interface CanonicalSupplier { code?: string; name: string; }
export interface CanonicalItem { number: string; name?: string; specification?: string; unit?: string; }
export interface CanonicalSalesOrderLine {
  lineNumber: number;
  item: CanonicalItem;
  quantity: string;
  deliveryDate?: string;
  remark?: string;
  sourcePayload?: Record<string, unknown>;
}
export interface CanonicalSalesOrder {
  sourceSystem: string;
  sourceKey: string;
  sourceDatabase?: string;
  orderNumber: string;
  orderDate?: string;
  customer?: CanonicalCustomer;
  salesperson?: string;
  enabled: boolean;
  sourceUpdatedAt?: string;
  lines: CanonicalSalesOrderLine[];
}
