import { MigrationInterface, QueryRunner } from "typeorm";

export class ErpSyncScaleAndOutbox1722920037000 implements MigrationInterface {
  name = "ErpSyncScaleAndOutbox1722920037000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE erp_change_events (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar NOT NULL,
        raw_record_id uuid NOT NULL REFERENCES erp_staging_raw_records(id) ON DELETE CASCADE,
        source_system varchar NOT NULL, source_database varchar NOT NULL, source_table varchar NOT NULL,
        source_id varchar NOT NULL, record_type varchar NOT NULL, operation varchar NOT NULL DEFAULT 'UPSERT',
        record_version integer NOT NULL, content_hash varchar NOT NULL, source_modified_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT uq_erp_change_event_version UNIQUE(tenant_id,raw_record_id,record_version),
        CONSTRAINT ck_erp_change_event_operation CHECK(operation IN ('UPSERT','DELETE')),
        CONSTRAINT ck_erp_change_event_version CHECK(record_version>0)
      );
      CREATE INDEX idx_erp_change_events_cursor ON erp_change_events(tenant_id,created_at,id);
      CREATE INDEX idx_erp_change_events_type_cursor ON erp_change_events(tenant_id,record_type,created_at,id);

      CREATE TABLE erp_projection_consumers (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar NOT NULL,
        consumer_key varchar NOT NULL, target_resource varchar NOT NULL, record_types varchar[] NOT NULL,
        enabled boolean NOT NULL DEFAULT false, status varchar NOT NULL DEFAULT 'IDLE', batch_size integer NOT NULL DEFAULT 1000,
        last_event_created_at timestamptz, last_event_id uuid,
        lease_token uuid, lease_expires_at timestamptz, in_flight_event_created_at timestamptz, in_flight_event_id uuid,
        retry_count integer NOT NULL DEFAULT 0, next_retry_at timestamptz, last_error varchar, last_success_at timestamptz,
        version integer NOT NULL DEFAULT 1,
        created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system', updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_erp_projection_consumer UNIQUE(tenant_id,consumer_key),
        CONSTRAINT ck_erp_projection_consumer_status CHECK(status IN ('IDLE','RUNNING','FAILED','DISABLED')),
        CONSTRAINT ck_erp_projection_consumer_batch CHECK(batch_size BETWEEN 1 AND 1000),
        CONSTRAINT ck_erp_projection_consumer_version CHECK(version>0),
        CONSTRAINT ck_erp_projection_consumer_record_types CHECK(cardinality(record_types)>0)
      );
      CREATE INDEX idx_erp_projection_consumers_due ON erp_projection_consumers(tenant_id,enabled,next_retry_at);

      CREATE INDEX idx_erp_staging_raw_type_modified
        ON erp_staging_raw_records(tenant_id,record_type,modified_at,id);
      CREATE INDEX idx_erp_staging_raw_source_type_order
        ON erp_staging_raw_records(tenant_id,source_system,source_database,record_type,source_order_id);
      CREATE INDEX idx_erp_staging_raw_header_number
        ON erp_staging_raw_records(tenant_id,source_system,source_database,order_number)
        WHERE record_type='ORDER_HEADER';
      CREATE INDEX idx_erp_sync_batches_source_stream_created
        ON erp_sync_batches(source_id,stream,created_at DESC,batch_number DESC);
      CREATE INDEX idx_erp_sync_runs_running
        ON erp_sync_runs(tenant_id,source_id,run_type,started_at DESC) WHERE status='RUNNING';
      CREATE INDEX idx_orders_dashboard_date_division
        ON orders(order_date,division) INCLUDE(customer)
        WHERE source_active=true;
      CREATE INDEX idx_orders_dashboard_customer_date
        ON orders(customer,order_date)
        WHERE source_active=true;
      CREATE INDEX idx_order_items_dashboard_active_order
        ON order_items(order_id)
        INCLUDE(production_quantity,historical_inbound_quantity,today_inbound_quantity,unit_price)
        WHERE active=true;

      ALTER TABLE erp_staging_raw_records SET (
        autovacuum_vacuum_scale_factor=0.02,
        autovacuum_analyze_scale_factor=0.01,
        autovacuum_vacuum_threshold=5000,
        autovacuum_analyze_threshold=5000
      );
      ALTER TABLE erp_change_events ENABLE ROW LEVEL SECURITY;
      CREATE POLICY erp_change_events_tenant_policy ON erp_change_events
        USING (tenant_id=current_setting('app.tenant_id',true))
        WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
      ALTER TABLE erp_projection_consumers ENABLE ROW LEVEL SECURITY;
      CREATE POLICY erp_projection_consumers_tenant_policy ON erp_projection_consumers
        USING (tenant_id=current_setting('app.tenant_id',true))
        WITH CHECK (tenant_id=current_setting('app.tenant_id',true));

      INSERT INTO erp_projection_consumers(
        tenant_id,consumer_key,target_resource,record_types,enabled,status,created_by,updated_by
      ) VALUES
        ('KAINAN','sales-orders-v1','sales_orders',ARRAY['ORDER_HEADER','ORDER_LINE'],false,'DISABLED',NULL,'migration'),
        ('KAINAN','finished-goods-inbound-v1','finished_goods_inbound',ARRAY['INBOUND_LINE'],false,'DISABLED',NULL,'migration'),
        ('KAINAN','finished-goods-outbound-v1','finished_goods_outbound',ARRAY['OUTBOUND_LINE'],false,'DISABLED',NULL,'migration')
      ON CONFLICT(tenant_id,consumer_key) DO NOTHING;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE erp_staging_raw_records RESET (
        autovacuum_vacuum_scale_factor,
        autovacuum_analyze_scale_factor,
        autovacuum_vacuum_threshold,
        autovacuum_analyze_threshold
      );
      DROP INDEX IF EXISTS idx_erp_sync_runs_running;
      DROP INDEX IF EXISTS idx_erp_sync_batches_source_stream_created;
      DROP INDEX IF EXISTS idx_order_items_dashboard_active_order;
      DROP INDEX IF EXISTS idx_orders_dashboard_customer_date;
      DROP INDEX IF EXISTS idx_orders_dashboard_date_division;
      DROP INDEX IF EXISTS idx_erp_staging_raw_header_number;
      DROP INDEX IF EXISTS idx_erp_staging_raw_source_type_order;
      DROP INDEX IF EXISTS idx_erp_staging_raw_type_modified;
      DROP TABLE IF EXISTS erp_projection_consumers;
      DROP TABLE IF EXISTS erp_change_events;
    `);
  }
}
