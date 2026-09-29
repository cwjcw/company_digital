import { MigrationInterface, QueryRunner } from "typeorm";

export class RdMaterialDuplicateDetection1722920076000 implements MigrationInterface {
  name = "RdMaterialDuplicateDetection1722920076000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE rd_items (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        source_system varchar(40) NOT NULL DEFAULT 'E10', source_database varchar(160) NOT NULL,
        source_id uuid NOT NULL, item_code varchar(160) NOT NULL, item_name varchar(240) NOT NULL DEFAULT '',
        specification varchar(510) NOT NULL DEFAULT '', remark varchar(510) NOT NULL DEFAULT '',
        is_group_item boolean NULL, status varchar(40) NULL, approve_status varchar(8) NULL,
        created_at_source timestamptz NULL, last_modified_at_source timestamptz NULL, modified_at_source timestamptz NULL,
        created_by_source uuid NULL, last_modified_by_source uuid NULL, modified_by_source uuid NULL,
        created_by_name varchar(400) NULL, last_modified_by_name varchar(400) NULL, modified_by_name varchar(400) NULL,
        content_hash char(64) NOT NULL, synced_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_rd_items_source UNIQUE(tenant_id,source_system,source_database,source_id),
        CONSTRAINT uq_rd_items_code UNIQUE(tenant_id,item_code), CONSTRAINT ck_rd_items_version CHECK(version>0)
      );
      CREATE INDEX idx_rd_items_search ON rd_items(tenant_id,item_code,item_name);
      CREATE INDEX idx_rd_items_modified ON rd_items(tenant_id,last_modified_at_source,source_id);
      CREATE TABLE rd_sync_runs (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, mode varchar(20) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'RUNNING', started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz NULL,
        source_database varchar(160) NOT NULL, watermark_before_at timestamptz NULL, watermark_before_id uuid NULL,
        watermark_after_at timestamptz NULL, watermark_after_id uuid NULL, rows_read integer NOT NULL DEFAULT 0,
        rows_created integer NOT NULL DEFAULT 0, rows_updated integer NOT NULL DEFAULT 0, rows_unchanged integer NOT NULL DEFAULT 0,
        error_message text NULL, actor_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT ck_rd_sync_mode CHECK(mode IN ('FULL','INCREMENTAL')), CONSTRAINT ck_rd_sync_status CHECK(status IN ('RUNNING','SUCCESS','FAILED'))
      );
      CREATE INDEX idx_rd_sync_runs_latest ON rd_sync_runs(tenant_id,started_at DESC);
      CREATE TABLE rd_duplicate_scans (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, status varchar(20) NOT NULL DEFAULT 'RUNNING',
        stage varchar(80) NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz NULL,
        rows integer NOT NULL DEFAULT 0, compared_pairs integer NOT NULL DEFAULT 0, skipped_blocks integer NOT NULL DEFAULT 0,
        skipped_pairs integer NOT NULL DEFAULT 0, counts jsonb NOT NULL DEFAULT '{}'::jsonb, error_message text NULL,
        rule_version varchar(40) NOT NULL DEFAULT 'history-1', created_by uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
        CONSTRAINT ck_rd_scan_status CHECK(status IN ('IDLE','RUNNING','COMPLETE','FAILED'))
      );
      CREATE TABLE rd_duplicate_groups (
        id uuid PRIMARY KEY DEFAULT uuidv7(), scan_id uuid NOT NULL REFERENCES rd_duplicate_scans(id) ON DELETE CASCADE,
        tenant_id varchar(64) NOT NULL, group_no integer NOT NULL, kind varchar(20) NOT NULL, score numeric(6,1) NULL,
        reason text NOT NULL, warnings jsonb NOT NULL DEFAULT '[]'::jsonb, member_count integer NOT NULL,
        distinct_codes integer NOT NULL, members_truncated boolean NOT NULL DEFAULT false,
        CONSTRAINT uq_rd_duplicate_group_no UNIQUE(scan_id,group_no), CONSTRAINT ck_rd_duplicate_kind CHECK(kind IN ('exact','similar','missing','code'))
      );
      CREATE TABLE rd_duplicate_members (
        id uuid PRIMARY KEY DEFAULT uuidv7(), group_id uuid NOT NULL REFERENCES rd_duplicate_groups(id) ON DELETE CASCADE,
        tenant_id varchar(64) NOT NULL, rd_item_id uuid NOT NULL REFERENCES rd_items(id) ON DELETE RESTRICT,
        member_order integer NOT NULL, source_row integer NULL
      );
      CREATE INDEX idx_rd_duplicate_scans_tenant ON rd_duplicate_scans(tenant_id,started_at DESC);
      CREATE INDEX idx_rd_duplicate_groups_scan ON rd_duplicate_groups(scan_id,kind,score DESC);
      CREATE INDEX idx_rd_duplicate_members_group ON rd_duplicate_members(group_id,member_order);
    `);
    for (const table of ["rd_items", "rd_sync_runs", "rd_duplicate_scans", "rd_duplicate_groups", "rd_duplicate_members"]) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`CREATE POLICY ${table}_tenant_policy ON ${table} USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true))`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS rd_duplicate_members");
    await queryRunner.query("DROP TABLE IF EXISTS rd_duplicate_groups");
    await queryRunner.query("DROP TABLE IF EXISTS rd_duplicate_scans");
    await queryRunner.query("DROP TABLE IF EXISTS rd_sync_runs");
    await queryRunner.query("DROP TABLE IF EXISTS rd_items");
  }
}
