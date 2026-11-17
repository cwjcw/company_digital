import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive workflow data only; no preset business categories, amounts or employee grants. */
export class AbnormalCost1722920132000 implements MigrationInterface {
  name = 'AbnormalCost1722920132000';
  async up(r: QueryRunner) {
    const audit = `created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_by varchar NOT NULL DEFAULT 'system',updated_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1 CHECK(version>0)`;
    await r.query(`
      CREATE TABLE abnormal_categories(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,category_name varchar(100) NOT NULL CHECK(btrim(category_name)<>''),remark varchar(4000),deleted_at timestamptz,${audit},UNIQUE(tenant_id,id));
      CREATE UNIQUE INDEX ux_abnormal_category_name ON abnormal_categories(tenant_id,category_name) WHERE deleted_at IS NULL;
      CREATE TABLE incident_severity_levels(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,amount_min numeric(18,2) NOT NULL CHECK(amount_min>=0),amount_max numeric(18,2) NOT NULL CHECK(amount_max>=amount_min),severity_name varchar(10) NOT NULL CHECK(severity_name IN ('特大','重大','严重','一般')),deleted_at timestamptz,${audit},UNIQUE(tenant_id,id));
      CREATE INDEX ix_incident_amount ON incident_severity_levels(tenant_id,amount_min,amount_max) WHERE deleted_at IS NULL;
      CREATE TABLE abnormal_cost_attachments(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,object_key text NOT NULL,name varchar(255) NOT NULL,mime_type varchar(128) NOT NULL,size integer NOT NULL CHECK(size>0),purpose varchar(16) NOT NULL CHECK(purpose IN ('DETAIL','OTHER','EVIDENCE')),parsed_rows jsonb NOT NULL DEFAULT '[]',${audit},UNIQUE(tenant_id,id));
      CREATE TABLE abnormal_responsibility_requests(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,abnormal_no varchar(200) NOT NULL,customer_code varchar(100) NOT NULL CHECK(btrim(customer_code)<>''),order_no varchar(100) NOT NULL CHECK(btrim(order_no)<>''),division_id uuid NOT NULL REFERENCES organization_units(id),initiator_id uuid NOT NULL REFERENCES users(id),abnormal_description varchar(4000) NOT NULL CHECK(btrim(abnormal_description)<>''),estimated_amount numeric(18,2) NOT NULL CHECK(estimated_amount>0),confirmed_amount numeric(18,2) NOT NULL CHECK(confirmed_amount>0),severity_level_id uuid NOT NULL,detail_attachment uuid NOT NULL,other_attachments jsonb NOT NULL DEFAULT '[]',next_judgment integer NOT NULL DEFAULT 0 CHECK(next_judgment BETWEEN 0 AND 99),deleted_at timestamptz,${audit},UNIQUE(tenant_id,id),UNIQUE(tenant_id,abnormal_no),FOREIGN KEY(tenant_id,severity_level_id) REFERENCES incident_severity_levels(tenant_id,id),FOREIGN KEY(tenant_id,detail_attachment) REFERENCES abnormal_cost_attachments(tenant_id,id));
      CREATE TABLE abnormal_responsibility_judgments(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,request_id uuid NOT NULL,judgment_no varchar(204) NOT NULL,category_id uuid NOT NULL,judgment_department_id uuid NOT NULL REFERENCES organization_units(id),judge_user_id uuid NOT NULL REFERENCES users(id),expense_bearing_ratio smallint CHECK(expense_bearing_ratio BETWEEN 0 AND 100),responsibility_allocations jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(responsibility_allocations)='array'),responsibility_reason varchar(4000),judgment_evidence jsonb NOT NULL DEFAULT '[]',judgment_status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK(judgment_status IN ('PENDING','COMPLETED')),deleted_at timestamptz,${audit},UNIQUE(tenant_id,id),UNIQUE(tenant_id,judgment_no),FOREIGN KEY(tenant_id,request_id) REFERENCES abnormal_responsibility_requests(tenant_id,id),FOREIGN KEY(tenant_id,category_id) REFERENCES abnormal_categories(tenant_id,id));
      CREATE INDEX ix_abnormal_judgment_request ON abnormal_responsibility_judgments(tenant_id,request_id) WHERE deleted_at IS NULL;
      CREATE INDEX ix_abnormal_judgment_judge ON abnormal_responsibility_judgments(tenant_id,judge_user_id,judgment_status) WHERE deleted_at IS NULL;
      CREATE INDEX ix_abnormal_request_date ON abnormal_responsibility_requests(tenant_id,created_at DESC,id) WHERE deleted_at IS NULL;
      CREATE TABLE abnormal_cost_counters(tenant_id varchar(64) NOT NULL,business_date date NOT NULL,customer_code varchar(100) NOT NULL,last_number integer NOT NULL CHECK(last_number BETWEEN 1 AND 999),PRIMARY KEY(tenant_id,business_date,customer_code));
      CREATE TABLE abnormal_cost_commands(tenant_id varchar(64) NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),command_key varchar(200) NOT NULL,body_hash varchar(64) NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,actor_id,command_key));
      CREATE TABLE abnormal_cost_import_previews(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),resource varchar(64) NOT NULL,rows jsonb NOT NULL,expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',result jsonb,created_at timestamptz NOT NULL DEFAULT now());
    `);
    for (const table of ['abnormal_categories','incident_severity_levels','abnormal_cost_attachments','abnormal_responsibility_requests','abnormal_responsibility_judgments','abnormal_cost_counters','abnormal_cost_commands','abnormal_cost_import_previews']) {
      await r.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON ${table} USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true))`);
    }
    await r.query(`INSERT INTO notification_rules(tenant_id,rule_key,name,event_type,channel,resource,recipient_rule,enabled,config)
      SELECT DISTINCT tenant_id,'workflow.abnormal.judge','异常责任判定人通知','workflow.abnormal.judgment_assigned','WECHAT_WORK','abnormal-responsibility-judgments','ABNORMAL_JUDGE',true,'{}'::jsonb FROM users
      ON CONFLICT(tenant_id,rule_key) DO NOTHING`);
  }
  async down() { throw new Error('异常费用含独立业务与审计记录，禁止自动删表回滚；回退应用保留新增结构和数据。'); }
}
