import { MigrationInterface, QueryRunner } from "typeorm";

export class RdDuplicateScanMaintenance1722920080000 implements MigrationInterface {
  name = "RdDuplicateScanMaintenance1722920080000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE rd_item_features (
        tenant_id varchar(64) NOT NULL,
        rd_item_id uuid PRIMARY KEY REFERENCES rd_items(id) ON DELETE CASCADE,
        item_version integer NOT NULL,
        rule_version varchar(40) NOT NULL,
        feature_hash char(64) NOT NULL,
        normalized_name text NOT NULL DEFAULT '',
        normalized_spec text NOT NULL DEFAULT '',
        inferred_category varchar(80) NOT NULL DEFAULT '未确定',
        numeric_features jsonb NOT NULL DEFAULT '[]'::jsonb,
        qualifiers jsonb NOT NULL DEFAULT '[]'::jsonb,
        attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
        candidate_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
        feature_json jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_rd_item_features_tenant_item UNIQUE(tenant_id,rd_item_id)
      );
      CREATE INDEX idx_rd_item_features_tenant_rule ON rd_item_features(tenant_id,rule_version,item_version);
      CREATE INDEX idx_rd_item_features_candidate_keys ON rd_item_features USING gin(candidate_keys);

      ALTER TABLE rd_duplicate_scans
        ADD COLUMN IF NOT EXISTS scan_mode varchar(20) NOT NULL DEFAULT 'FULL',
        ADD COLUMN IF NOT EXISTS base_scan_id uuid NULL REFERENCES rd_duplicate_scans(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS source_watermark_at timestamptz NULL,
        ADD COLUMN IF NOT EXISTS source_watermark_id uuid NULL,
        ADD COLUMN IF NOT EXISTS source_version varchar(160) NULL,
        ADD COLUMN IF NOT EXISTS item_count integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS processed_items integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_items integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS processed_blocks integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_blocks integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS progress_percent numeric(5,2) NOT NULL DEFAULT 0;
      ALTER TABLE rd_duplicate_scans DROP CONSTRAINT IF EXISTS ck_rd_scan_mode;
      ALTER TABLE rd_duplicate_scans ADD CONSTRAINT ck_rd_scan_mode CHECK(scan_mode IN ('FULL','INCREMENTAL'));
      CREATE INDEX IF NOT EXISTS idx_rd_duplicate_scans_latest_complete ON rd_duplicate_scans(tenant_id,finished_at DESC) WHERE status='COMPLETE';

      ALTER TABLE rd_item_features ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rd_item_features_tenant_policy ON rd_item_features;
      CREATE POLICY rd_item_features_tenant_policy ON rd_item_features
        USING (tenant_id=current_setting('app.tenant_id',true))
        WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
    `);
    await queryRunner.query(`
      UPDATE rd_duplicate_scans s
      SET item_count = CASE WHEN s.rows > 0 THEN s.rows ELSE (SELECT count(*)::integer FROM rd_items i WHERE i.tenant_id=s.tenant_id) END,
          total_items = CASE WHEN s.rows > 0 THEN s.rows ELSE (SELECT count(*)::integer FROM rd_items i WHERE i.tenant_id=s.tenant_id) END,
          processed_items = CASE WHEN s.status='COMPLETE' THEN CASE WHEN s.rows > 0 THEN s.rows ELSE (SELECT count(*)::integer FROM rd_items i WHERE i.tenant_id=s.tenant_id) END ELSE s.processed_items END,
          source_watermark_at = COALESCE(s.source_watermark_at, (SELECT r.watermark_after_at FROM rd_sync_runs r WHERE r.tenant_id=s.tenant_id AND r.status='SUCCESS' ORDER BY r.finished_at DESC LIMIT 1)),
          source_watermark_id = COALESCE(s.source_watermark_id, (SELECT r.watermark_after_id FROM rd_sync_runs r WHERE r.tenant_id=s.tenant_id AND r.status='SUCCESS' ORDER BY r.finished_at DESC LIMIT 1)),
          source_version = COALESCE(s.source_version, concat_ws(':', (SELECT r.watermark_after_at FROM rd_sync_runs r WHERE r.tenant_id=s.tenant_id AND r.status='SUCCESS' ORDER BY r.finished_at DESC LIMIT 1), (SELECT r.watermark_after_id FROM rd_sync_runs r WHERE r.tenant_id=s.tenant_id AND r.status='SUCCESS' ORDER BY r.finished_at DESC LIMIT 1), s.rows)),
          progress_percent = CASE WHEN s.status='COMPLETE' THEN 100 ELSE s.progress_percent END
      WHERE s.status='COMPLETE';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS rd_item_features");
    await queryRunner.query(`
      ALTER TABLE rd_duplicate_scans
        DROP COLUMN IF EXISTS scan_mode,
        DROP COLUMN IF EXISTS base_scan_id,
        DROP COLUMN IF EXISTS source_watermark_at,
        DROP COLUMN IF EXISTS source_watermark_id,
        DROP COLUMN IF EXISTS source_version,
        DROP COLUMN IF EXISTS item_count,
        DROP COLUMN IF EXISTS processed_items,
        DROP COLUMN IF EXISTS total_items,
        DROP COLUMN IF EXISTS processed_blocks,
        DROP COLUMN IF EXISTS total_blocks,
        DROP COLUMN IF EXISTS progress_percent;
    `);
  }
}
