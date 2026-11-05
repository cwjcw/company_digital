import { MigrationInterface, QueryRunner } from "typeorm";

/** Metadata only. NULL leases are historical/unowned and are never auto-recovered. */
export class MpsSyncLeases1722920118000 implements MigrationInterface {
  name = "MpsSyncLeases1722920118000";

  async up(runner: QueryRunner): Promise<void> {
    for (const table of ["mps_sync_configs", "mps_sync_logs", "mps_reconciliation_outbox"]) {
      await runner.query(`ALTER TABLE ${table} ADD COLUMN lease_expires_at timestamptz NULL`);
      await runner.query(`CREATE INDEX idx_${table}_expired_lease ON ${table}(lease_expires_at)
        WHERE status='RUNNING' AND lease_expires_at IS NOT NULL`);
    }
    await runner.query(`ALTER TABLE mps_sync_logs
      ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
      ADD COLUMN scope_json jsonb NULL`);
  }

  async down(): Promise<void> {
    throw new Error("MPS同步租约迁移仅支持前向修复；回退应用须保留租约、代际与尝试记录，不得删除元数据后重放任务");
  }
}
