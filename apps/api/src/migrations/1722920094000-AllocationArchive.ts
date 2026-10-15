import type { MigrationInterface, QueryRunner } from "typeorm";

/** Retain stable historical plan references while removing allocations from current work. */
export class AllocationArchive1722920094000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`ALTER TABLE mps_order_allocations ADD COLUMN archived_at timestamptz;
      CREATE INDEX idx_mps_allocation_active ON mps_order_allocations(tenant_id,id) WHERE archived_at IS NULL`);
  }

  async down(r: QueryRunner): Promise<void> {
    await r.query("LOCK TABLE mps_order_allocations IN ACCESS EXCLUSIVE MODE");
    const [row] = await r.query("SELECT EXISTS(SELECT 1 FROM mps_order_allocations WHERE archived_at IS NOT NULL) AS unsafe");
    if (row.unsafe) throw new Error("已有归档分配记录，禁止回滚后使历史记录重新进入当前分配表");
    await r.query("DROP INDEX idx_mps_allocation_active; ALTER TABLE mps_order_allocations DROP COLUMN archived_at");
  }
}
