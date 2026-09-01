export type SyncActor = { userId: string; displayName: string; requestId: string; source: "API" | "WEB" };

export type RawStagingRecord = {
  sourceSystem: string; sourceDatabase: string; sourceTable: string; sourceId: string;
  recordType: "ORDER_HEADER" | "ORDER_LINE" | "DELIVERY_PLAN" | "OUTBOUND_LINE" | "INBOUND_LINE" | "INVENTORY";
  sourceOrderId?: string | null; sourceOrderLineId?: string | null; orderNumber?: string | null;
  businessDate?: string | null; modifiedAt?: string | null; customerCode?: string | null; customerName?: string | null;
  itemCode?: string | null; itemName?: string | null; quantity?: string | number | null;
  deliveredQuantity?: string | number | null; outstandingQuantity?: string | number | null;
  deliveryDate?: string | null; statusCode?: string | null; statusLabel?: string | null;
  isCancelled?: boolean | null; isClosed?: boolean | null; isCompleted?: boolean | null;
  orderLinkStable?: boolean | null; linkRule?: string | null; rawPayload: Record<string, unknown>; contentHash: string;
  overlapReplay?: boolean;
};

export type StartSyncRun = {
  sourceKey: string; sourceSystem: string; sourceDatabase: string; sourceAccountName: string;
  fieldMapping: Record<string, unknown>; runType: "INITIALIZATION" | "COMPENSATION" | "INCREMENTAL";
  sourceSnapshotAt?: string | null; scanUpperBound?: string | null;
};

export type CommitSyncBatch = {
  sourceKey: string; runId: string; phase: "INITIALIZATION" | "INCREMENTAL";
  stream: string; sourceTable: string; batchNumber: number; idempotencyKey: string;
  cursorBefore?: Record<string, unknown> | null; cursorAfter?: Record<string, unknown> | null;
  scanUpperBound?: string | null; batchFull: boolean; durationMs: number; records: RawStagingRecord[];
};
