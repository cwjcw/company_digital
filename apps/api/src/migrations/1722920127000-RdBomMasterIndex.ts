import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Local tenant-scoped E10 BOM header index and atomic sync bookkeeping. E10 is read-only. */
export class RdBomMasterIndex1722920127000 implements MigrationInterface {
  name = 'RdBomMasterIndex1722920127000';

  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE rd_bom_sync_state (
      tenant_id varchar(64) PRIMARY KEY,
      active_generation uuid NULL,
      last_change_version bigint NULL,
      last_started_at timestamptz NULL,
      last_success_at timestamptz NULL,
      last_status text NOT NULL DEFAULT 'NOT_INITIALIZED' CHECK (last_status IN ('NOT_INITIALIZED','RUNNING','SUCCESS','FAILED')),
      last_error_code text NULL,
      last_error_count bigint NOT NULL DEFAULT 0,
      last_scanned_count bigint NOT NULL DEFAULT 0,
      last_inserted_count bigint NOT NULL DEFAULT 0,
      last_updated_count bigint NOT NULL DEFAULT 0,
      last_revoked_count bigint NOT NULL DEFAULT 0,
      last_deleted_count bigint NOT NULL DEFAULT 0,
      lease_token uuid NULL,
      lease_until timestamptz NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await r.query(`CREATE TABLE rd_bom_master_heads (
      tenant_id varchar(64) NOT NULL,
      generation_id uuid NOT NULL,
      source_bom_id uuid NOT NULL,
      item_id uuid NOT NULL,
      item_code text NULL,
      owner_org_id uuid NULL,
      version_times text NULL,
      approve_status text NOT NULL CHECK (approve_status='Y'),
      approve_date timestamp NULL,
      create_date timestamp NULL,
      modified_date timestamp NULL,
      last_modified_date timestamp NULL,
      source_change_version bigint NULL,
      synced_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id,generation_id,source_bom_id)
    )`);
    await r.query(`CREATE INDEX rd_bom_master_heads_item_idx ON rd_bom_master_heads(tenant_id,generation_id,item_id)`);
    await r.query(`CREATE TABLE rd_bom_sync_stage (
      tenant_id varchar(64) NOT NULL,
      run_id uuid NOT NULL,
      source_bom_id uuid NOT NULL,
      operation text NOT NULL CHECK (operation IN ('UPSERT','REVOKE','DELETE')),
      item_id uuid NULL,
      item_code text NULL,
      owner_org_id uuid NULL,
      version_times text NULL,
      approve_status text NULL,
      approve_date timestamp NULL,
      create_date timestamp NULL,
      modified_date timestamp NULL,
      last_modified_date timestamp NULL,
      source_change_version bigint NOT NULL,
      PRIMARY KEY (tenant_id,run_id,source_bom_id)
    )`);
    await r.query(`CREATE TABLE rd_bom_sync_runs (
      id uuid PRIMARY KEY,
      tenant_id varchar(64) NOT NULL,
      mode text NOT NULL CHECK (mode IN ('FULL','INCREMENTAL')),
      status text NOT NULL CHECK (status IN ('RUNNING','SUCCESS','FAILED')),
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz NULL,
      from_change_version bigint NULL,
      to_change_version bigint NULL,
      scanned_count bigint NOT NULL DEFAULT 0,
      inserted_count bigint NOT NULL DEFAULT 0,
      updated_count bigint NOT NULL DEFAULT 0,
      revoked_count bigint NOT NULL DEFAULT 0,
      deleted_count bigint NOT NULL DEFAULT 0,
      error_count bigint NOT NULL DEFAULT 0,
      error_code text NULL
    )`);
    for (const table of ['rd_bom_sync_state','rd_bom_master_heads','rd_bom_sync_stage','rd_bom_sync_runs']) {
      await r.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY ${table}_tenant ON ${table} USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),''))`);
    }
    await r.query(`COMMENT ON TABLE rd_bom_master_heads IS 'KDOS只读镜像：E10已审核BOM主档，不含BOM_D；以代次原子切换'`);
    await r.query(`COMMENT ON TABLE rd_bom_sync_stage IS 'E10 Change Tracking增量暂存；提交完整批次后才应用并推进水位'`);
  }

  async down(): Promise<void> {
    throw new Error('Forward-only migration: preserve the E10 BOM snapshot and sync audit history; roll back application code only.');
  }
}
