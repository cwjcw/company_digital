import type { MigrationInterface, QueryRunner } from "typeorm";
export class OrderAllocationImportNotifications1722920092000 implements MigrationInterface {
  name = "OrderAllocationImportNotifications1722920092000";
  async up(r: QueryRunner) {
    await r.query(`ALTER TABLE users ADD COLUMN tenant_id varchar(64) NOT NULL DEFAULT 'KAINAN'; CREATE INDEX users_tenant_name ON users(tenant_id,display_name);
      ALTER TABLE mps_order_allocations ADD COLUMN order_sequence varchar(128), ADD COLUMN specification text,
      ADD COLUMN unallocated_quantity numeric(20,4), ADD COLUMN approval_date date, ADD COLUMN supplier_code varchar(128),
      ADD COLUMN supplier_name varchar(255), ADD COLUMN plan_number varchar(128), ADD COLUMN currency varchar(32),
      ADD COLUMN financial_exchange_rate numeric(20,8), ADD COLUMN settlement_ratio numeric(20,8), ADD COLUMN scheduled_quantity numeric(20,4),
      ADD COLUMN manually_maintained boolean NOT NULL DEFAULT false;
      UPDATE mps_order_allocations allocation SET manually_maintained=true WHERE EXISTS (
        SELECT 1 FROM audit_logs audit WHERE audit.tenant_id=allocation.tenant_id AND audit.record_id=allocation.id::text
        AND audit.actor_id IS NOT NULL AND audit.actor_id<>'0199e000-0000-7000-8000-000000000001'::uuid
        AND audit.action IN ('mps-order-allocations.created','mps-order-allocations.updated','mps-order-allocations.batch_item_updated','mps-order-allocations.import_created','mps-order-allocations.import_updated'));
      CREATE UNIQUE INDEX notification_allocation_single_rule ON notification_rules(tenant_id,event_type) WHERE event_type='mps.order_allocation.batch_changed';
      CREATE UNIQUE INDEX mps_alloc_order_sequence ON mps_order_allocations(tenant_id,order_number,order_sequence) WHERE order_sequence IS NOT NULL;
      ALTER TABLE notification_delivery_logs ADD COLUMN component varchar(32) NOT NULL DEFAULT 'text', ADD COLUMN attachment_id uuid;
      DROP INDEX uq_notification_delivery_recipient_attempt;
      CREATE UNIQUE INDEX uq_notification_delivery_recipient_attempt ON notification_delivery_logs(tenant_id,notification_outbox_id,recipient_user_id,component,attempt) WHERE recipient_user_id IS NOT NULL;
    `);
    const audit = `created_by uuid NOT NULL REFERENCES users(id),updated_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1 CHECK(version>0)`;
    await r.query(`CREATE TABLE mps_allocation_vendor_mappings(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,supplier_name varchar(255) NOT NULL CHECK(supplier_name=btrim(supplier_name) AND supplier_name<>''),division_id uuid NOT NULL REFERENCES organization_units(id),enabled boolean NOT NULL DEFAULT true,${audit},UNIQUE(tenant_id,supplier_name));
      CREATE TABLE mps_allocation_recipients(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,division_id uuid NOT NULL REFERENCES organization_units(id),user_ids jsonb NOT NULL DEFAULT '[]',enabled boolean NOT NULL DEFAULT true,${audit},UNIQUE(tenant_id,division_id));
      CREATE TABLE notification_attachments(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,notification_outbox_id uuid NOT NULL REFERENCES notification_outbox(id),recipient_user_id uuid NOT NULL REFERENCES users(id),filename varchar(255) NOT NULL,part integer NOT NULL DEFAULT 1,content bytea NOT NULL,sha256 varchar(64) NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,notification_outbox_id,recipient_user_id,part));`);
    for (const table of ["mps_allocation_vendor_mappings","mps_allocation_recipients","notification_attachments"]) await r.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;CREATE POLICY ${table}_tenant ON ${table} USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));`);
  }
  async down() { throw new Error("Retain allocation imports, configurations and delivery evidence; roll back application images instead."); }
}
