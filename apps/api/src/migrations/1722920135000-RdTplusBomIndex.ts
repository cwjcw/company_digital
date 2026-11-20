import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RdTplusBomIndex1722920135000 implements MigrationInterface {
  name = 'RdTplusBomIndex1722920135000';
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE rd_tplus_bom_sync_state (
      tenant_id varchar(64) NOT NULL, source text NOT NULL CHECK(source IN ('tplus-kejia','tplus-kainan')),
      source_database text NOT NULL, active_generation uuid, report_enabled boolean NOT NULL DEFAULT false,
      last_status text NOT NULL DEFAULT 'NOT_INITIALIZED' CHECK(last_status IN ('NOT_INITIALIZED','RUNNING','SUCCESS','FAILED')),
      last_started_at timestamptz, last_success_at timestamptz, last_error_code text,
      scanned_count integer NOT NULL DEFAULT 0, valid_count integer NOT NULL DEFAULT 0,
      PRIMARY KEY(tenant_id,source))`);
    await r.query(`CREATE TABLE rd_tplus_bom_heads (
      tenant_id varchar(64) NOT NULL, source text NOT NULL, source_database text NOT NULL,
      generation_id uuid NOT NULL, source_bom_id integer NOT NULL, item_id integer, item_code text,
      bom_version text, voucher_state integer, disabled boolean NOT NULL, is_default boolean NOT NULL,
      source_created_at timestamp, source_modified_at timestamp, source_audited_at timestamp,
      synced_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,source,generation_id,source_bom_id))`);
    await r.query(`CREATE INDEX rd_tplus_bom_heads_code_idx ON rd_tplus_bom_heads(tenant_id,source,generation_id,item_code)`);
    await r.query(`CREATE INDEX rd_bom_master_heads_code_idx ON rd_bom_master_heads(tenant_id,generation_id,item_code)`);
    await r.query(`CREATE TABLE rd_tplus_bom_sync_runs (
      id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, source text NOT NULL,
      generation_id uuid NOT NULL, status text NOT NULL CHECK(status IN ('RUNNING','SUCCESS','FAILED','ACTIVATED')),
      started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, scanned_count integer NOT NULL DEFAULT 0,
      valid_count integer NOT NULL DEFAULT 0, error_code text, source_evidence jsonb)`);
    for (const table of ['rd_tplus_bom_sync_state','rd_tplus_bom_heads','rd_tplus_bom_sync_runs']) {
      await r.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY ${table}_tenant ON ${table} USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),''))
        WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),''))`);
    }
  }
  async down(): Promise<void> { throw new Error('Forward-only: preserve T+ snapshots and sync audit; roll back application/report activation instead.'); }
}
