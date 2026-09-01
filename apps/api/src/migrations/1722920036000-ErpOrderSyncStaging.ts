import { MigrationInterface, QueryRunner } from "typeorm";

export class ErpOrderSyncStaging1722920036000 implements MigrationInterface {
  name = "ErpOrderSyncStaging1722920036000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE erp_sync_sources (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar NOT NULL,
        source_key varchar NOT NULL, source_system varchar NOT NULL, source_database varchar NOT NULL,
        source_account_name varchar NOT NULL, field_mapping jsonb NOT NULL,
        status varchar NOT NULL DEFAULT 'NOT_INITIALIZED', source_snapshot_at timestamptz,
        initialization_started_at timestamptz, initialization_completed_at timestamptz,
        incremental_enabled boolean NOT NULL DEFAULT false, last_sync_at timestamptz,
        version integer NOT NULL DEFAULT 1,
        created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system', updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_erp_sync_sources UNIQUE(tenant_id,source_key),
        CONSTRAINT ck_erp_sync_sources_status CHECK(status IN ('NOT_INITIALIZED','INITIALIZING','COMPENSATING','ACTIVE','FAILED')),
        CONSTRAINT ck_erp_sync_sources_version CHECK(version>0)
      );
      CREATE TABLE erp_sync_runs (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar NOT NULL,
        source_id uuid NOT NULL REFERENCES erp_sync_sources(id) ON DELETE CASCADE,
        run_type varchar NOT NULL, status varchar NOT NULL DEFAULT 'RUNNING',
        source_snapshot_at timestamptz, scan_upper_bound timestamptz,
        started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
        metrics jsonb NOT NULL DEFAULT '{}'::jsonb, error_message varchar, retry_count integer NOT NULL DEFAULT 0,
        version integer NOT NULL DEFAULT 1,
        created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system', updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_erp_sync_runs_type CHECK(run_type IN ('INITIALIZATION','COMPENSATION','INCREMENTAL')),
        CONSTRAINT ck_erp_sync_runs_status CHECK(status IN ('RUNNING','COMPLETED','FAILED')),
        CONSTRAINT ck_erp_sync_runs_version CHECK(version>0)
      );
      CREATE INDEX idx_erp_sync_runs_source_started ON erp_sync_runs(source_id,started_at DESC);
      CREATE TABLE erp_sync_cursors (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar NOT NULL,
        source_id uuid NOT NULL REFERENCES erp_sync_sources(id) ON DELETE CASCADE,
        phase varchar NOT NULL, stream varchar NOT NULL, source_table varchar NOT NULL,
        initialization_business_date timestamptz, initialization_source_pk varchar,
        last_processed_modified_at timestamptz, last_processed_source_pk varchar,
        last_successful_scan_upper_bound timestamptz,
        active_run_id uuid REFERENCES erp_sync_runs(id) ON DELETE SET NULL,
        active_page_modified_at timestamptz, active_page_source_pk varchar,
        version integer NOT NULL DEFAULT 1,
        created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system', updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_erp_sync_cursors UNIQUE(tenant_id,source_id,phase,stream),
        CONSTRAINT ck_erp_sync_cursors_phase CHECK(phase IN ('INITIALIZATION','INCREMENTAL')),
        CONSTRAINT ck_erp_sync_cursors_version CHECK(version>0)
      );
      CREATE TABLE erp_sync_batches (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar NOT NULL,
        run_id uuid NOT NULL REFERENCES erp_sync_runs(id) ON DELETE CASCADE,
        source_id uuid NOT NULL REFERENCES erp_sync_sources(id) ON DELETE CASCADE,
        stream varchar NOT NULL, source_table varchar NOT NULL, batch_number integer NOT NULL,
        idempotency_key varchar NOT NULL, status varchar NOT NULL,
        read_count integer NOT NULL, inserted_count integer NOT NULL DEFAULT 0,
        updated_count integer NOT NULL DEFAULT 0, overlap_replay_count integer NOT NULL DEFAULT 0,
        true_duplicate_count integer NOT NULL DEFAULT 0, duration_ms numeric(18,3),
        cursor_before jsonb, cursor_after jsonb, scan_upper_bound timestamptz,
        error_message varchar, retry_count integer NOT NULL DEFAULT 0,
        version integer NOT NULL DEFAULT 1,
        created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system', updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_erp_sync_batches_idempotency UNIQUE(tenant_id,idempotency_key),
        CONSTRAINT ck_erp_sync_batches_status CHECK(status IN ('COMMITTED','FAILED')),
        CONSTRAINT ck_erp_sync_batches_version CHECK(version>0)
      );
      CREATE INDEX idx_erp_sync_batches_run ON erp_sync_batches(run_id,batch_number);
      CREATE TABLE erp_staging_raw_records (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar NOT NULL,
        source_system varchar NOT NULL, source_database varchar NOT NULL,
        source_table varchar NOT NULL, source_id varchar NOT NULL,
        record_type varchar NOT NULL, source_order_id varchar, source_order_line_id varchar,
        order_number varchar, business_date date, modified_at timestamptz,
        customer_code varchar, customer_name varchar, item_code varchar, item_name varchar,
        quantity numeric(28,6), delivered_quantity numeric(28,6), outstanding_quantity numeric(28,6),
        delivery_date date, status_code varchar, status_label varchar,
        is_cancelled boolean, is_closed boolean, is_completed boolean,
        order_link_stable boolean, link_rule varchar, raw_payload jsonb NOT NULL,
        content_hash varchar NOT NULL, source_active boolean NOT NULL DEFAULT true,
        version integer NOT NULL DEFAULT 1,
        created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system', updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_erp_staging_raw_source UNIQUE(tenant_id,source_system,source_database,source_table,source_id),
        CONSTRAINT ck_erp_staging_raw_version CHECK(version>0)
      );
      CREATE INDEX idx_erp_staging_raw_order ON erp_staging_raw_records(tenant_id,source_system,source_database,source_order_id);
      CREATE INDEX idx_erp_staging_raw_number ON erp_staging_raw_records(tenant_id,order_number);
      CREATE INDEX idx_erp_staging_raw_type ON erp_staging_raw_records(tenant_id,record_type);
      CREATE TABLE business_orders (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar NOT NULL,
        merge_status varchar NOT NULL DEFAULT 'UNMERGED', rule_version varchar NOT NULL,
        business_confirmation_status varchar NOT NULL DEFAULT 'PENDING', version integer NOT NULL DEFAULT 1,
        created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system', updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_business_orders_version CHECK(version>0)
      );
      CREATE TABLE business_order_sources (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar NOT NULL,
        business_order_id uuid NOT NULL REFERENCES business_orders(id) ON DELETE CASCADE,
        source_system varchar NOT NULL, source_database varchar NOT NULL, source_table varchar NOT NULL,
        source_order_id varchar NOT NULL, source_order_number varchar NOT NULL,
        source_order_line_id varchar, merge_status varchar NOT NULL DEFAULT 'UNMERGED',
        duplicate_level varchar NOT NULL DEFAULT 'NO_MATCH', rule_version varchar NOT NULL,
        business_confirmation_status varchar NOT NULL DEFAULT 'PENDING',
        business_confirmed_by uuid, business_confirmed_at timestamptz, business_remark varchar,
        version integer NOT NULL DEFAULT 1,
        created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system', updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_business_order_sources UNIQUE(tenant_id,source_system,source_database,source_order_id,source_order_line_id),
        CONSTRAINT ck_business_order_sources_level CHECK(duplicate_level IN ('HIGH_CONFIDENCE_DUPLICATE','NEEDS_REVIEW','SAME_NUMBER_CONFLICT','NO_MATCH')),
        CONSTRAINT ck_business_order_sources_version CHECK(version>0)
      );
      CREATE TABLE duplicate_order_reviews (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar NOT NULL,
        left_source_record_id uuid NOT NULL REFERENCES erp_staging_raw_records(id) ON DELETE CASCADE,
        right_source_record_id uuid NOT NULL REFERENCES erp_staging_raw_records(id) ON DELETE CASCADE,
        duplicate_level varchar NOT NULL, suggested_action varchar NOT NULL,
        e10_order_number varchar, tplus_order_number varchar, source_account_name varchar,
        customer_summary varchar, e10_item_quantity_summary text, tplus_item_quantity_summary text,
        total_quantity_consistent boolean, delivery_date_consistent boolean,
        matching_rule varchar NOT NULL, matching_reason text NOT NULL, system_suggestion varchar NOT NULL,
        business_confirmation_status varchar NOT NULL DEFAULT 'PENDING',
        business_confirmed_by uuid, business_confirmed_at timestamptz, business_remark varchar,
        rule_version varchar NOT NULL, version integer NOT NULL DEFAULT 1,
        created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system', updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_duplicate_order_review_pair UNIQUE(tenant_id,left_source_record_id,right_source_record_id,rule_version),
        CONSTRAINT ck_duplicate_order_review_level CHECK(duplicate_level IN ('HIGH_CONFIDENCE_DUPLICATE','NEEDS_REVIEW','SAME_NUMBER_CONFLICT','NO_MATCH')),
        CONSTRAINT ck_duplicate_order_review_version CHECK(version>0)
      );
      CREATE INDEX idx_duplicate_order_reviews_level ON duplicate_order_reviews(tenant_id,duplicate_level,business_confirmation_status);
      CREATE UNIQUE INDEX uq_business_order_sources_origin ON business_order_sources(
        tenant_id,source_system,source_database,source_table,source_order_id,source_order_line_id
      ) NULLS NOT DISTINCT;
    `);
    for (const table of ["erp_sync_sources","erp_sync_runs","erp_sync_cursors","erp_sync_batches","erp_staging_raw_records","business_orders","business_order_sources","duplicate_order_reviews"]) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`CREATE POLICY ${table}_tenant_policy ON ${table}
        USING (tenant_id=current_setting('app.tenant_id',true))
        WITH CHECK (tenant_id=current_setting('app.tenant_id',true))`);
    }
    await queryRunner.query(`
      INSERT INTO permissions(id,role_id,resource,field_key,"read","create",copy,"update","delete",batch_print,batch_update,"import","export",updated_by)
      SELECT uuidv7(),role.id,'duplicate-order-review','*',COALESCE(source."read",false),false,false,
        COALESCE(source."update",false),false,false,false,COALESCE(source."import",false),COALESCE(source."export",false),'migration'
      FROM roles role
      LEFT JOIN permissions source ON source.role_id=role.id AND source.resource='sales-orders' AND source.field_key='*'
      WHERE NOT EXISTS(SELECT 1 FROM permissions target WHERE target.role_id=role.id AND target.resource='duplicate-order-review' AND target.field_key='*')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM permissions WHERE resource='duplicate-order-review'`);
    await queryRunner.query(`DROP TABLE IF EXISTS duplicate_order_reviews,business_order_sources,business_orders,erp_staging_raw_records,erp_sync_batches,erp_sync_cursors,erp_sync_runs,erp_sync_sources CASCADE`);
  }
}
