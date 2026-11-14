import type { EntityManager } from "typeorm";

/** A whole-tenant projection yields its locks to queued plan writers. The caller's
 * durable sync/outbox event remains retryable; this transaction commits no partial work. */
export class AllocationProjectionYieldError extends Error {
  readonly code = "MPS_ALLOCATION_PROJECTION_YIELDED";
  constructor() {
    super("全量计划投影检测到等待中的计划变更，已回滚让行；持久同步任务将稍后重试");
    this.name = "AllocationProjectionYieldError";
  }
}

/** Detect queued waiters only for the two existing tenant advisory keys. Keep the
 * locks themselves and all row/transaction protection intact. */
export async function yieldAllocationProjectionToWaitingWriters(manager: EntityManager, tenantId: string) {
  const [result] = await manager.query(`WITH lock_keys AS (
      SELECT hashtextextended($1 || ':mps-allocation-projection',0) AS lock_key
      UNION ALL SELECT hashtextextended($1 || ':mps-existing-monthly-inbound',0)
    ), advisory_ids AS (
      SELECT ((lock_key >> 32) & 4294967295)::oid AS class_id,
        (lock_key & 4294967295)::oid AS object_id FROM lock_keys
    )
    SELECT EXISTS(
      SELECT 1 FROM pg_locks l JOIN advisory_ids k
        ON l.classid=k.class_id AND l.objid=k.object_id AND l.objsubid=1
      WHERE l.locktype='advisory' AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database())
        AND l.granted=false
    ) AS waiting`, [tenantId]);
  if (result?.waiting === true || result?.waiting === "t") throw new AllocationProjectionYieldError();
}
