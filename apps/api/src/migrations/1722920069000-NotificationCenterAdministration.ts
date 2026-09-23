import { MigrationInterface, QueryRunner } from "typeorm";

/** 消息中心管理所需的规则归属元数据；消息内容/投递状态仍沿用既有通知表。 */
export class NotificationCenterAdministration1722920069000 implements MigrationInterface {
  name = "NotificationCenterAdministration1722920069000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notification_rules
        ADD COLUMN module_code varchar(64) NOT NULL DEFAULT 'planning';
      CREATE INDEX idx_notification_rules_tenant_module
        ON notification_rules(tenant_id,module_code,enabled,updated_at DESC);
      UPDATE notification_rules SET module_code='planning'
        WHERE resource='equipment-status-report' AND event_type='equipment.status.fault_changed';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_notification_rules_tenant_module;
      ALTER TABLE notification_rules DROP COLUMN module_code;
    `);
  }
}
