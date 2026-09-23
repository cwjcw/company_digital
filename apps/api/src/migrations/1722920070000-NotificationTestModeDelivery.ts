import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Keeps the business recipient and the actual TEST MODE recipient separate.
 * Existing delivery rows remain historical records with test_mode=false.
 */
export class NotificationTestModeDelivery1722920070000 implements MigrationInterface {
  name = "NotificationTestModeDelivery1722920070000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notification_delivery_logs
        ADD COLUMN actual_recipient_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN actual_wechat_user_id varchar(255),
        ADD COLUMN test_mode boolean NOT NULL DEFAULT false;
      CREATE INDEX idx_notification_delivery_actual_recipient
        ON notification_delivery_logs(tenant_id,notification_outbox_id,actual_recipient_user_id,created_at DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_notification_delivery_actual_recipient;
      ALTER TABLE notification_delivery_logs
        DROP COLUMN IF EXISTS test_mode,
        DROP COLUMN IF EXISTS actual_wechat_user_id,
        DROP COLUMN IF EXISTS actual_recipient_user_id;
    `);
  }
}
