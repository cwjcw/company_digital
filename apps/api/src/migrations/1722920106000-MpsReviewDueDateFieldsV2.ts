import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Manual business fields, organization identity and UUID audit actors for the review-due table. */
export class MpsReviewDueDateFieldsV21722920106000 implements MigrationInterface {
  name = 'MpsReviewDueDateFieldsV21722920106000';

  async up(r: QueryRunner) {
    await r.query(`ALTER TABLE mps_review_due_dates
      ADD COLUMN division_id uuid,
      ADD COLUMN source_division_id uuid;

      DO $$ BEGIN
        IF EXISTS(SELECT 1 FROM mps_review_due_dates WHERE division_id IS NULL) THEN
          RAISE EXCEPTION '评审交期表存在无法可靠判断事业部的历史记录；请完成人工归属后再执行迁移';
        END IF;
        IF EXISTS(SELECT 1 FROM mps_review_due_dates d WHERE d.created_by IS NULL) THEN
          RAISE EXCEPTION '评审交期表存在无法追溯创建人的历史记录；请人工核实后再执行迁移';
        END IF;
        IF EXISTS(SELECT 1 FROM mps_review_due_dates d WHERE d.updated_by !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id::text=d.updated_by AND u.tenant_id=d.tenant_id)) THEN
          RAISE EXCEPTION '评审交期表存在无法转换为稳定用户ID的更新人；请人工核实后再执行迁移';
        END IF;
      END $$;

      ALTER TABLE mps_review_due_dates
        ALTER COLUMN division_id SET NOT NULL,
        ALTER COLUMN source_division_id SET NOT NULL,
        ALTER COLUMN inspection_time_name DROP NOT NULL,
        ALTER COLUMN inspection_time_name DROP DEFAULT,
        ALTER COLUMN change_count DROP NOT NULL,
        ALTER COLUMN change_count DROP DEFAULT,
        ALTER COLUMN created_by SET NOT NULL,
        ALTER COLUMN updated_by DROP DEFAULT,
        ALTER COLUMN updated_by TYPE uuid USING updated_by::uuid;

      ALTER TABLE mps_review_due_dates
        DROP CONSTRAINT mps_review_due_dates_tenant_id_order_number_batch_number_dr_key,
        DROP CONSTRAINT uq_mps_review_due_source,
        ADD CONSTRAINT fk_mps_review_due_division FOREIGN KEY(division_id) REFERENCES organization_units(id) ON DELETE RESTRICT,
        ADD CONSTRAINT fk_mps_review_due_source_division FOREIGN KEY(source_division_id) REFERENCES organization_units(id) ON DELETE RESTRICT,
        ADD CONSTRAINT fk_mps_review_due_updated_by FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE RESTRICT,
        ADD CONSTRAINT uq_mps_review_due_business UNIQUE(tenant_id,division_id,order_number,batch_number,drawing_number),
        ADD CONSTRAINT uq_mps_review_due_source UNIQUE(tenant_id,source_division_id,source_order_number,source_batch_number,source_drawing_number);

      DROP TRIGGER trg_mps_review_due_count ON mps_review_due_dates;
      DROP TRIGGER trg_mps_review_due_history_count ON mps_review_due_date_changes;
      DROP FUNCTION mps_review_due_check_count();

      CREATE OR REPLACE FUNCTION mps_review_due_initial_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        NEW.source_division_id:=NEW.division_id;
        NEW.source_order_number:=NEW.order_number;
        NEW.source_batch_number:=NEW.batch_number;
        NEW.source_drawing_number:=NEW.drawing_number;
        IF NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.created_by AND u.tenant_id=NEW.tenant_id)
          OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.updated_by AND u.tenant_id=NEW.tenant_id) THEN
          RAISE EXCEPTION '评审交期审计用户必须属于当前租户';
        END IF;
        RETURN NEW;
      END $$;

      CREATE OR REPLACE FUNCTION mps_review_due_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF (NEW.id,NEW.tenant_id,NEW.source_division_id,NEW.source_order_number,NEW.source_batch_number,NEW.source_drawing_number,NEW.created_at,NEW.created_by)
          IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.source_division_id,OLD.source_order_number,OLD.source_batch_number,OLD.source_drawing_number,OLD.created_at,OLD.created_by) THEN
          RAISE EXCEPTION '评审交期记录身份、初始来源键及创建审计不可修改';
        END IF;
        IF NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.updated_by AND u.tenant_id=NEW.tenant_id) THEN
          RAISE EXCEPTION '评审交期更新人必须属于当前租户';
        END IF;
        RETURN NEW;
      END $$;

      CREATE INDEX idx_mps_review_due_division ON mps_review_due_dates(tenant_id,division_id,inbound_date,order_number,batch_number,drawing_number,id);
      COMMENT ON COLUMN mps_review_due_dates.drawing_number IS '业务显示名称：品项编码；保留稳定字段键和历史数据';
      COMMENT ON COLUMN mps_review_due_dates.inspection_time_name IS '业务显示名称：品项名称；可空';
      COMMENT ON COLUMN mps_review_due_dates.change_count IS '人工维护的非负整数；NULL表示未填写，不再与历史事件数量绑定';
      COMMENT ON COLUMN mps_review_due_dates.previous_inbound_date IS '人工维护的可空日期；当前入库时间变化不再自动覆盖';
      COMMENT ON COLUMN mps_review_due_dates.last_changed_at IS '旧版自动交期事件兼容字段；不再作为业务字段展示或写入';
      COMMENT ON COLUMN mps_review_due_dates.last_synced_at IS '旧版同步兼容字段；不再作为业务字段展示或写入';`);
  }

  async down(): Promise<void> {
    throw new Error('事业部身份、手工字段语义及UUID审计不可安全降级；请回滚应用并保留前向数据库结构');
  }
}
