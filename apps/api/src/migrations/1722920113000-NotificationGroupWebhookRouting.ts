import type { MigrationInterface, QueryRunner } from "typeorm";

/** Tenant-scoped encrypted group webhook targets, message routes and binary event components. */
export class NotificationGroupWebhookRouting1722920113000 implements MigrationInterface {
  name = "NotificationGroupWebhookRouting1722920113000";

  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE notification_group_webhooks (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        group_name varchar(128) NOT NULL, robot_name varchar(128) NOT NULL,
        channel_type varchar(64) NOT NULL DEFAULT 'WECHAT_GROUP_WEBHOOK' CHECK(channel_type='WECHAT_GROUP_WEBHOOK'),
        webhook_ciphertext text NOT NULL, webhook_masked varchar(512) NOT NULL,
        module_code varchar(64) NOT NULL, responsible_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        enabled boolean NOT NULL DEFAULT true, remark varchar(1000),
        created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
        updated_by uuid REFERENCES users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1 CHECK(version>0),
        UNIQUE(tenant_id,id), UNIQUE(tenant_id,group_name)
      );
      CREATE INDEX idx_notification_group_webhooks_enabled ON notification_group_webhooks(tenant_id,module_code,enabled,updated_at DESC);

      CREATE TABLE notification_routes (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        event_type varchar(128) NOT NULL, name varchar(255) NOT NULL, enabled boolean NOT NULL DEFAULT false,
        remark varchar(1000), created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
        updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0),
        UNIQUE(tenant_id,id), UNIQUE(tenant_id,event_type)
      );
      CREATE TABLE notification_route_targets (
        tenant_id varchar(64) NOT NULL, route_id uuid NOT NULL, target_id uuid NOT NULL,
        target_type varchar(64) NOT NULL DEFAULT 'WECHAT_GROUP_WEBHOOK' CHECK(target_type='WECHAT_GROUP_WEBHOOK'),
        enabled boolean NOT NULL DEFAULT true, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(tenant_id,route_id,target_id),
        FOREIGN KEY(tenant_id,route_id) REFERENCES notification_routes(tenant_id,id) ON DELETE CASCADE,
        FOREIGN KEY(tenant_id,target_id) REFERENCES notification_group_webhooks(tenant_id,id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_notification_route_targets_enabled ON notification_route_targets(tenant_id,route_id,enabled);

      CREATE TABLE notification_event_components (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        notification_outbox_id uuid NOT NULL, sequence integer NOT NULL CHECK(sequence>0),
        component_type varchar(16) NOT NULL CHECK(component_type IN ('text','markdown','image')),
        content_text text, filename varchar(255), mime_type varchar(128), content bytea, sha256 varchar(64),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(tenant_id,id), UNIQUE(tenant_id,notification_outbox_id,sequence),
        FOREIGN KEY(tenant_id,notification_outbox_id) REFERENCES notification_outbox(tenant_id,id) ON DELETE CASCADE,
        CHECK((component_type IN ('text','markdown') AND content_text IS NOT NULL AND content IS NULL) OR
              (component_type='image' AND content IS NOT NULL AND content_text IS NULL AND mime_type='image/png' AND sha256 IS NOT NULL))
      );
      CREATE INDEX idx_notification_event_components_outbox ON notification_event_components(tenant_id,notification_outbox_id,sequence);

      ALTER TABLE notification_delivery_logs ADD COLUMN target_type varchar(64), ADD COLUMN target_id uuid, ADD COLUMN target_name varchar(255);
      UPDATE notification_delivery_logs SET target_type='USER',target_id=recipient_user_id WHERE recipient_user_id IS NOT NULL;
      CREATE INDEX idx_notification_delivery_group_target ON notification_delivery_logs(tenant_id,target_type,target_id,created_at DESC);
      CREATE UNIQUE INDEX uq_notification_delivery_group_attempt ON notification_delivery_logs(tenant_id,notification_outbox_id,target_id,component,attempt)
        WHERE target_type='WECHAT_GROUP_WEBHOOK';

      ALTER TABLE notification_group_webhooks ENABLE ROW LEVEL SECURITY; ALTER TABLE notification_group_webhooks FORCE ROW LEVEL SECURITY;
      CREATE POLICY notification_group_webhooks_tenant ON notification_group_webhooks USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
      ALTER TABLE notification_routes ENABLE ROW LEVEL SECURITY; ALTER TABLE notification_routes FORCE ROW LEVEL SECURITY;
      CREATE POLICY notification_routes_tenant ON notification_routes USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
      ALTER TABLE notification_route_targets ENABLE ROW LEVEL SECURITY; ALTER TABLE notification_route_targets FORCE ROW LEVEL SECURITY;
      CREATE POLICY notification_route_targets_tenant ON notification_route_targets USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
      ALTER TABLE notification_event_components ENABLE ROW LEVEL SECURITY; ALTER TABLE notification_event_components FORCE ROW LEVEL SECURITY;
      CREATE POLICY notification_event_components_tenant ON notification_event_components USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
    `);
  }

  async down(): Promise<void> {
    throw new Error("Retain notification route and delivery history; roll back application code without deleting configured webhooks or send records.");
  }
}
