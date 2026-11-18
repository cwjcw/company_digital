import type { MigrationInterface, QueryRunner } from "typeorm";

/** Route every persisted ERP synchronization failure to 崔玮杰 through the existing dispatcher. */
export class ErpSyncFailureNotifications1722920133000 implements MigrationInterface {
  name = "ErpSyncFailureNotifications1722920133000";

  async up(queryRunner: QueryRunner): Promise<void> {
    const recipients = await queryRunner.query(`SELECT id FROM users
      WHERE tenant_id='KAINAN' AND display_name='崔玮杰' AND username='08134'
        AND enabled=true AND NULLIF(btrim(wechat_user_id),'') IS NOT NULL`);
    if (recipients.length !== 1) {
      throw new Error(`ERP同步失败预警接收人必须唯一且已配置企业微信，实际匹配${recipients.length}人`);
    }
    const config = JSON.stringify({ recipientTargets: [{ type: "USER", userId: recipients[0].id }] });
    await queryRunner.query(`INSERT INTO notification_rules(
        tenant_id,rule_key,name,event_type,channel,resource,recipient_rule,module_code,enabled,config,created_by,updated_by
      ) VALUES('KAINAN','erp.sync.failed.cui-weijie','ERP同步失败通知崔玮杰','erp.sync.failed','WECHAT_WORK',
        'erp-order-sync','FIXED_USERS','data-operations',true,$1::jsonb,NULL,'system')
      ON CONFLICT(tenant_id,rule_key) DO UPDATE SET
        name=EXCLUDED.name,event_type=EXCLUDED.event_type,channel=EXCLUDED.channel,
        resource=EXCLUDED.resource,recipient_rule=EXCLUDED.recipient_rule,module_code=EXCLUDED.module_code,
        enabled=true,config=EXCLUDED.config,updated_by='system',updated_at=now(),version=notification_rules.version+1`, [config]);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_erp_sync_failure_rule
      ON notification_rules(tenant_id,event_type) WHERE event_type='erp.sync.failed'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS ux_notification_erp_sync_failure_rule`);
    await queryRunner.query(`DELETE FROM notification_rules WHERE tenant_id='KAINAN' AND rule_key='erp.sync.failed.cui-weijie'`);
  }
}
