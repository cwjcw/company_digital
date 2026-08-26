export type CustomerImportSource = "tplus" | "e10";
export type CustomerImportScope = { mode: "customer"; customerCode: string } | { mode: "all"; customerCode?: never };

export type CustomerImportOrderLine = {
  sourceOrderId: string;
  sourceDetailId: string;
  orderNumber: string;
  orderDate: string | null;
  voucherState: string | number | null;
  isCancelled: boolean;
  headerClosed: boolean;
  lineClosed: boolean;
  detailVoucherState: string | number | null;
  auditedAt: string | null;
  customerCode: string | null;
  customerName: string | null;
  salesperson: string | null;
  itemNumber: string;
  itemName: string | null;
  specification: string | null;
  quantity: string | number;
  baseQuantity: string | number | null;
  unit: string | null;
  taxPrice: string | number | null;
  taxAmount: string | number | null;
  headerTaxAmount: string | number | null;
  deliveryDate: string | null;
  warehouseCode: string | null;
  deliveredQuantity: string | number | null;
  saleOutQuantity: string | number | null;
  executedQuantity: string | number | null;
  manufactureQuantity: string | number | null;
  maker: string | null;
  auditor: string | null;
  memo: string | null;
};

export type CustomerImportMovement = {
  sourceDocumentId: string;
  sourceDetailId: string;
  documentNumber: string;
  documentDate: string | null;
  voucherState: string | number | null;
  direction: "INBOUND" | "OUTBOUND";
  directionValue: number;
  voucherType: string | number | null;
  businessType: string | number | null;
  partnerCode: string | null;
  partnerName: string | null;
  itemNumber: string;
  itemName: string | null;
  specification: string | null;
  quantity: string | number | null;
  baseQuantity: string | number | null;
  unit: string | null;
  unitPrice: string | number | null;
  amount: string | number | null;
  warehouseCode: string | null;
  warehouseName: string | null;
  batch: string | null;
  salesOrderNumber: string | null;
  salesOrderDetailId: string | null;
  sourceDocumentNumber: string | null;
  sourceDocumentIdRef: string | null;
  sourceDetailIdRef: string | null;
  maker: string | null;
  auditor: string | null;
  memo: string | null;
};

export type CustomerDataSnapshot = {
  schemaVersion: 1;
  source: CustomerImportSource;
  sourceDatabase: string;
  sourceAccountName: string;
  division: string | null;
  scope: CustomerImportScope;
  extractedAt: string;
  idempotencyKey: string;
  replaceDemoData?: boolean;
  orders: CustomerImportOrderLine[];
  movements: CustomerImportMovement[];
};

export type CustomerImportActor = {
  userId: string;
  displayName: string;
  requestId: string;
  source: "API" | "WEB";
};

export type NormalizedCustomerImport = CustomerDataSnapshot & {
  sourceSystem: "TPLUS" | "E10";
  customerCode: string | null;
};

export type CustomerImportRepositoryResult = Record<string, number | string | boolean | null>;

export const LEGACY_CUSTOMER_IMPORT_REPOSITORY = Symbol("LEGACY_CUSTOMER_IMPORT_REPOSITORY");
export const KDOS_CUSTOMER_IMPORT_REPOSITORY = Symbol("KDOS_CUSTOMER_IMPORT_REPOSITORY");

export interface CustomerImportRepository {
  replace(snapshot: NormalizedCustomerImport, actor: CustomerImportActor): Promise<CustomerImportRepositoryResult>;
}
