/**
 * KDOS asynchronous worker boundary.
 * Phase one deliberately runs without a message broker; jobs call protected API
 * commands with an idempotency key so the Planning application layer remains
 * the only write path.
 */
export interface KdosJob {
  type: "planning.monthly-rollover" | "integration.tplus-sales-orders";
  tenantCode: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface KdosJobHandler {
  readonly type: KdosJob["type"];
  handle(job: KdosJob, signal?: AbortSignal): Promise<void>;
}
