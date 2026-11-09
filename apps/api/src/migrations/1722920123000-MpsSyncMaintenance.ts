import type { MigrationInterface, QueryRunner } from 'typeorm';
/** No business-row backfill, frequency change or lifecycle120 dependency. */
export class MpsSyncMaintenance1722920123000 implements MigrationInterface {
  name = 'MpsSyncMaintenance1722920123000';
  async up(q: QueryRunner) {
    const [r] = await q.query(`SELECT to_regprocedure('mps_assert_demand_link(text,jsonb)') IS NOT NULL links,
      to_regclass('mps_review_base_plan_links') IS NOT NULL reviews`);
    if(!r.links || !r.reviews) throw Error('123 requires protected119/121/122 baseline');
    await q.query(`ALTER TABLE mps_sync_configs ADD COLUMN maintenance_state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(maintenance_state)='object');
      CREATE INDEX ix_mps_audit_sync_baseline ON audit_logs(tenant_id,resource,action,record_id,created_at DESC,id DESC)
        WHERE action IN ('mps-base-plans.synchronized','demand.quantity.confirmed');
      CREATE INDEX ix_mps_inbound_changed ON finished_goods_inbound(updated_at,id);`);
  }
  async down(q: QueryRunner) {
    const [r]=await q.query(`SELECT EXISTS(SELECT 1 FROM mps_sync_configs WHERE maintenance_state<>'{}'::jsonb) used`);
    if(r.used) throw Error('Retain durable checkpoints; disable feature and use a forward-compatible API');
    await q.query('DROP INDEX ix_mps_inbound_changed; DROP INDEX ix_mps_audit_sync_baseline; ALTER TABLE mps_sync_configs DROP COLUMN maintenance_state');
  }
}
