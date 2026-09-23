import { MigrationInterface, QueryRunner } from "typeorm";

/** KDOS 通知规则、动态责任人和按接收人投递状态。 */
export class NotificationRoutingAndRecipientDeliveries1722920068000 implements MigrationInterface {
  name = "NotificationRoutingAndRecipientDeliveries1722920068000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notification_rules
        ADD COLUMN resource varchar(128) NOT NULL DEFAULT 'notification',
        ADD COLUMN recipient_rule varchar(128) NOT NULL DEFAULT 'NONE';
      ALTER TABLE notification_outbox ALTER COLUMN next_retry_at DROP NOT NULL;

      ALTER TABLE notification_delivery_logs
        DROP CONSTRAINT ck_notification_delivery_status,
        DROP CONSTRAINT uq_notification_delivery_attempt,
        ADD COLUMN recipient_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        ADD COLUMN wechat_user_id varchar(255),
        ADD COLUMN errcode varchar(64),
        ADD COLUMN errmsg text,
        ADD COLUMN provider_message_id varchar(255),
        ADD CONSTRAINT ck_notification_delivery_status CHECK(status IN ('PENDING','PROCESSING','SENT','FAILED','RETRY_PENDING','SKIPPED'));
      CREATE UNIQUE INDEX uq_notification_delivery_recipient_attempt
        ON notification_delivery_logs(tenant_id,notification_outbox_id,recipient_user_id,attempt)
        WHERE recipient_user_id IS NOT NULL;
      CREATE UNIQUE INDEX uq_notification_delivery_legacy_attempt
        ON notification_delivery_logs(tenant_id,notification_outbox_id,attempt)
        WHERE recipient_user_id IS NULL;
      CREATE INDEX idx_notification_delivery_recipient
        ON notification_delivery_logs(tenant_id,notification_outbox_id,recipient_user_id,created_at DESC);

      INSERT INTO notification_rules(
        tenant_id,rule_key,name,event_type,channel,enabled,config,resource,recipient_rule
      ) VALUES(
        'KAINAN','equipment_fault_changed','设备故障变化提醒','equipment.status.fault_changed','WECHAT_WORK',true,
        '{"messageType":"text","template":"【设备故障提醒】\\n\\n事业部：{divisionName}\\n设备编号：{equipmentCode}\\n设备名称：{equipmentName}\\n\\n故障时间：{oldFaultMinutes}分钟 → {newFaultMinutes}分钟\\n故障原因：{faultReason}\\n\\n填报人：{actorName}\\n时间：{occurredAt}\\n\\n请及时处理。"}'::jsonb,
        'equipment-status-report','EQUIPMENT_RESPONSIBLE'
      ) ON CONFLICT(tenant_id,rule_key) DO UPDATE SET
        name=EXCLUDED.name,event_type=EXCLUDED.event_type,channel=EXCLUDED.channel,
        enabled=EXCLUDED.enabled,config=EXCLUDED.config,resource=EXCLUDED.resource,
        recipient_rule=EXCLUDED.recipient_rule,updated_at=now(),version=notification_rules.version+1;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM notification_rules WHERE tenant_id='KAINAN' AND rule_key='equipment_fault_changed';
      DROP INDEX IF EXISTS idx_notification_delivery_recipient;
      DROP INDEX IF EXISTS uq_notification_delivery_legacy_attempt;
      DROP INDEX IF EXISTS uq_notification_delivery_recipient_attempt;
      ALTER TABLE notification_delivery_logs
        DROP CONSTRAINT ck_notification_delivery_status,
        DROP COLUMN provider_message_id,
        DROP COLUMN errmsg,
        DROP COLUMN errcode,
        DROP COLUMN wechat_user_id,
        DROP COLUMN recipient_user_id,
        ADD CONSTRAINT ck_notification_delivery_status CHECK(status IN ('SENT','FAILED'));
      ALTER TABLE notification_outbox ALTER COLUMN next_retry_at SET NOT NULL;
      ALTER TABLE notification_rules DROP COLUMN recipient_rule, DROP COLUMN resource;
    `);
  }
}
