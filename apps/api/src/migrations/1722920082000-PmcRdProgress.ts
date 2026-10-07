import type { MigrationInterface, QueryRunner } from 'typeorm';
export class PmcRdProgress1722920082000 implements MigrationInterface {
  name = 'PmcRdProgress1722920082000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE pmc_rd_progress_items (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        source_order_id uuid NOT NULL,
        source_order_line_id uuid NOT NULL,
        order_no text NOT NULL,
        line_number integer NULL,
        customer_id uuid NULL,
        customer_code text NULL,
        customer_name text NULL,
        order_date date NULL,
        order_create_date timestamp(6) NULL,
        order_last_modified_date timestamp(6) NULL,
        owner_dept_id uuid NULL,
        owner_dept_name text NULL,
        order_status_raw text NULL,
        division_id uuid NULL,
        division_name text NULL,
        division_source text NULL,
        item_id uuid NULL,
        item_code text NULL,
        item_name text NULL,
        item_spec text NULL,
        item_feature_id uuid NULL,
        business_qty numeric(28,8) NULL,
        item_property text NULL,
        routing_control text NULL,
        standard_routing_id uuid NULL,
        plant_org_id uuid NULL,
        design_bom_status text NOT NULL,
        bom_id uuid NULL,
        bom_version text NULL,
        bom_e_code text NULL,
        bom_approve_status text NULL,
        valid_bom_detail_count integer NULL,
        routing_status text NOT NULL,
        routing_id uuid NULL,
        routing_code text NULL,
        routing_approve_status text NULL,
        valid_operation_count integer NULL,
        routing_source text NULL,
        rd_status text NOT NULL,
        reason_code text NOT NULL,
        reason_text text NOT NULL,
        rd_last_modified_at timestamp(6) NULL,
        source_order_modified_at timestamp(6) NULL,
        source_bom_modified_at timestamp(6) NULL,
        source_routing_modified_at timestamp(6) NULL,
        source_snapshot_at timestamp(6) NOT NULL, synced_at timestamptz NOT NULL DEFAULT now(),
        content_hash char(64) NOT NULL, is_active boolean NOT NULL DEFAULT true, source_deleted_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid NULL REFERENCES users(id), updated_by uuid NULL REFERENCES users(id), version integer NOT NULL DEFAULT 1 CHECK(version>0),
        UNIQUE(tenant_id,source_order_line_id),
        CHECK(rd_status IN ('NOT_APPLICABLE','NOT_STARTED','DESIGN_IN_PROGRESS','WAITING_ROUTING','ROUTING_IN_PROGRESS','COMPLETE','ABNORMAL')),
        CHECK(design_bom_status IN ('NOT_APPLICABLE','NOT_STARTED','IN_PROGRESS','COMPLETE','ABNORMAL')),
        CHECK(routing_status IN ('NOT_APPLICABLE','NOT_STARTED','IN_PROGRESS','COMPLETE','ABNORMAL'))
      );
      CREATE INDEX idx_pmc_rd_order ON pmc_rd_progress_items(tenant_id,order_no,source_order_id,line_number) WHERE is_active;
      CREATE INDEX idx_pmc_rd_status ON pmc_rd_progress_items(tenant_id,rd_status,order_date) WHERE is_active;
      CREATE INDEX idx_pmc_rd_item ON pmc_rd_progress_items(tenant_id,item_code) WHERE is_active;
      CREATE INDEX idx_pmc_rd_division_customer ON pmc_rd_progress_items(tenant_id,division_id,customer_code) WHERE is_active;
      CREATE INDEX idx_pmc_rd_date ON pmc_rd_progress_items(tenant_id,order_date) WHERE is_active;
      CREATE TABLE pmc_rd_progress_sync_runs (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        mode text NOT NULL CHECK(mode IN ('FULL','INCREMENTAL')), status text NOT NULL DEFAULT 'RUNNING' CHECK(status IN ('RUNNING','SUCCESS','FAILED')),
        started_at timestamptz NOT NULL DEFAULT now(), source_snapshot_at timestamp(6) NULL, completed_at timestamptz NULL,
        rows_read integer NOT NULL DEFAULT 0, rows_created integer NOT NULL DEFAULT 0, rows_updated integer NOT NULL DEFAULT 0,
        rows_unchanged integer NOT NULL DEFAULT 0, rows_failed integer NOT NULL DEFAULT 0, rows_deactivated integer NOT NULL DEFAULT 0,
        error_message text NULL, watermark_before jsonb NULL, watermark_after jsonb NULL, source_consistency text NULL,
        affected_item_count integer NOT NULL DEFAULT 0, affected_order_count integer NOT NULL DEFAULT 0,
        actor_id uuid NULL REFERENCES users(id)
      );
      CREATE INDEX idx_pmc_rd_runs ON pmc_rd_progress_sync_runs(tenant_id,started_at DESC);
      CREATE UNIQUE INDEX uq_pmc_rd_running ON pmc_rd_progress_sync_runs(tenant_id) WHERE status='RUNNING';
    `);
    for (const table of ['pmc_rd_progress_items','pmc_rd_progress_sync_runs']) {
      await runner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await runner.query(`CREATE POLICY ${table}_tenant_policy ON ${table} USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true))`);
    }
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE pmc_rd_progress_sync_runs');
    await runner.query('DROP TABLE pmc_rd_progress_items');
  }
}
