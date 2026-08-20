import type { CanonicalSalesOrder } from "@kdos/canonical-model";

export interface SalesOrderReadOptions { since?: string; signal?: AbortSignal; }
export interface SalesOrderProvider {
  readonly id: string;
  readSalesOrders(options?: SalesOrderReadOptions): AsyncIterable<CanonicalSalesOrder>;
}
export interface IntegrationWriteContext {
  tenantCode: string;
  actorId?: string;
  requestId: string;
  idempotencyKey: string;
  source: string;
}
