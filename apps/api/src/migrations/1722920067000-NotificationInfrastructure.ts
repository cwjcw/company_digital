import { MigrationInterface, QueryRunner } from "typeorm";

/** KDOS 通知系统第一阶段：规则、事务 outbox 和投递尝试日志。 */
export class NotificationInfrastructure1722920067000 implements MigrationInterface {
  name = "NotificationInfrastructure1722920067000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notification_rules (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        tenant_id varchar(64) NOT NULL,
        rule_key varchar(128) NOT NULL,
        name varchar(255) NOT NULL,
        event_type varchar(128) NOT NULL,
        channel varchar(64) NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        config jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_notification_rules_tenant_rule_key UNIQUE(tenant_id,rule_key),
        CONSTRAINT uq_notification_rules_tenant_id UNIQUE(tenant_id,id),
        CONSTRAINT ck_notification_rules_version CHECK(version>0)
      );

      CREATE TABLE notification_outbox (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        tenant_id varchar(64) NOT NULL,
        notification_rule_id uuid,
        event_type varchar(128) NOT NULL,
        channel varchar(64) NOT NULL,
        dedup_key varchar(255) NOT NULL,
        payload jsonb NOT NULL,
        status varchar(16) NOT NULL DEFAULT 'PENDING',
        attempts integer NOT NULL DEFAULT 0,
        next_retry_at timestamptz NOT NULL DEFAULT now(),
        locked_at timestamptz,
        locked_by varchar(255),
        sent_at timestamptz,
        failed_at timestamptz,
        last_error text,
        created_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_notification_outbox_tenant_dedup UNIQUE(tenant_id,dedup_key),
        CONSTRAINT uq_notification_outbox_tenant_id UNIQUE(tenant_id,id),
        CONSTRAINT fk_notification_outbox_rule FOREIGN KEY(tenant_id,notification_rule_id)
          REFERENCES notification_rules(tenant_id,id) ON DELETE RESTRICT,
        CONSTRAINT ck_notification_outbox_status CHECK(status IN ('PENDING','PROCESSING','SENT','FAILED')),
        CONSTRAINT ck_notification_outbox_attempts CHECK(attempts>=0),
        CONSTRAINT ck_notification_outbox_version CHECK(version>0)
      );

      CREATE TABLE notification_delivery_logs (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        tenant_id varchar(64) NOT NULL,
        notification_outbox_id uuid NOT NULL,
        attempt integer NOT NULL,
        status varchar(16) NOT NULL,
        response_code varchar(64),
        response_json jsonb,
        error_message text,
        delivered_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_notification_delivery_outbox FOREIGN KEY(tenant_id,notification_outbox_id)
          REFERENCES notification_outbox(tenant_id,id) ON DELETE CASCADE,
        CONSTRAINT uq_notification_delivery_attempt UNIQUE(tenant_id,notification_outbox_id,attempt),
        CONSTRAINT ck_notification_delivery_attempt CHECK(attempt>0),
        CONSTRAINT ck_notification_delivery_status CHECK(status IN ('SENT','FAILED'))
      );

      CREATE INDEX idx_notification_rules_enabled
        ON notification_rules(tenant_id,enabled,event_type);
      CREATE INDEX idx_notification_outbox_claim
        ON notification_outbox(tenant_id,status,next_retry_at,created_at,id)
        WHERE status IN ('PENDING','FAILED');
      CREATE INDEX idx_notification_outbox_processing
        ON notification_outbox(tenant_id,status,locked_at)
        WHERE status='PROCESSING';
      CREATE INDEX idx_notification_delivery_logs_outbox
        ON notification_delivery_logs(tenant_id,notification_outbox_id,created_at DESC);

      ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
      CREATE POLICY notification_rules_tenant_policy ON notification_rules
        USING (tenant_id=current_setting('app.tenant_id',true))
        WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
      ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
      CREATE POLICY notification_outbox_tenant_policy ON notification_outbox
        USING (tenant_id=current_setting('app.tenant_id',true))
        WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
      ALTER TABLE notification_delivery_logs ENABLE ROW LEVEL SECURITY;
      CREATE POLICY notification_delivery_logs_tenant_policy ON notification_delivery_logs
        USING (tenant_id=current_setting('app.tenant_id',true))
        WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS notification_delivery_logs;
      DROP TABLE IF EXISTS notification_outbox;
      DROP TABLE IF EXISTS notification_rules;
    `);
  }
}
