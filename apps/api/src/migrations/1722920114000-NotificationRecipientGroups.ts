import type { MigrationInterface, QueryRunner } from "typeorm";

/** Tenant-scoped recipient groups for notification routes. Existing direct webhook routes remain valid. */
export class NotificationRecipientGroups1722920114000 implements MigrationInterface {
  name = "NotificationRecipientGroups1722920114000";

  async up(r: QueryRunner): Promise<void> {
    await r.query(`
      CREATE TABLE notification_recipient_groups (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        name varchar(128) NOT NULL, category varchar(128), purpose varchar(255), description varchar(1000),
        enabled boolean NOT NULL DEFAULT true,
        created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
        updated_by uuid REFERENCES users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1 CHECK(version>0),
        UNIQUE(tenant_id,id), UNIQUE(tenant_id,name)
      );
      CREATE INDEX idx_notification_recipient_groups_enabled ON notification_recipient_groups(tenant_id,enabled,name);

      CREATE TABLE notification_recipient_group_members (
        tenant_id varchar(64) NOT NULL, recipient_group_id uuid NOT NULL, target_id uuid NOT NULL,
        created_by uuid REFERENCES users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(tenant_id,recipient_group_id,target_id),
        FOREIGN KEY(tenant_id,recipient_group_id) REFERENCES notification_recipient_groups(tenant_id,id) ON DELETE CASCADE,
        FOREIGN KEY(tenant_id,target_id) REFERENCES notification_group_webhooks(tenant_id,id) ON DELETE RESTRICT
      );
      CREATE INDEX idx_notification_recipient_group_members_target ON notification_recipient_group_members(tenant_id,target_id);

      ALTER TABLE notification_route_targets ADD COLUMN webhook_target_id uuid, ADD COLUMN recipient_group_id uuid;
      UPDATE notification_route_targets SET webhook_target_id=target_id WHERE target_type='WECHAT_GROUP_WEBHOOK';
      ALTER TABLE notification_route_targets DROP CONSTRAINT notification_route_targets_tenant_id_target_id_fkey;
      ALTER TABLE notification_route_targets DROP CONSTRAINT notification_route_targets_target_type_check;
      ALTER TABLE notification_route_targets DROP CONSTRAINT notification_route_targets_pkey;
      ALTER TABLE notification_route_targets ADD CONSTRAINT notification_route_targets_target_type_check CHECK(target_type IN ('WECHAT_GROUP_WEBHOOK','RECIPIENT_GROUP'));
      ALTER TABLE notification_route_targets ADD CONSTRAINT notification_route_targets_target_reference_check CHECK(
        (target_type='WECHAT_GROUP_WEBHOOK' AND webhook_target_id=target_id AND recipient_group_id IS NULL) OR
        (target_type='RECIPIENT_GROUP' AND recipient_group_id=target_id AND webhook_target_id IS NULL)
      );
      ALTER TABLE notification_route_targets ADD CONSTRAINT notification_route_targets_webhook_fk FOREIGN KEY(tenant_id,webhook_target_id) REFERENCES notification_group_webhooks(tenant_id,id) ON DELETE RESTRICT;
      ALTER TABLE notification_route_targets ADD CONSTRAINT notification_route_targets_recipient_group_fk FOREIGN KEY(tenant_id,recipient_group_id) REFERENCES notification_recipient_groups(tenant_id,id) ON DELETE RESTRICT;
      ALTER TABLE notification_route_targets ADD PRIMARY KEY(tenant_id,route_id,target_type,target_id);
      CREATE INDEX idx_notification_route_targets_type ON notification_route_targets(tenant_id,target_type,target_id);

      DROP INDEX IF EXISTS uq_notification_delivery_legacy_attempt;

      ALTER TABLE notification_recipient_groups ENABLE ROW LEVEL SECURITY; ALTER TABLE notification_recipient_groups FORCE ROW LEVEL SECURITY;
      CREATE POLICY notification_recipient_groups_tenant ON notification_recipient_groups USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
      ALTER TABLE notification_recipient_group_members ENABLE ROW LEVEL SECURITY; ALTER TABLE notification_recipient_group_members FORCE ROW LEVEL SECURITY;
      CREATE POLICY notification_recipient_group_members_tenant ON notification_recipient_group_members USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
    `);
  }

  async down(): Promise<void> {
    throw new Error("Retain recipient groups and notification route history; roll back application code without dropping recipient or routing data.");
  }
}
