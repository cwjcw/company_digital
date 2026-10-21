import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Separate immutable source identity from the six manually maintained business fields. */
export class MpsReviewDueDateManualEdit1722920104000 implements MigrationInterface {
  name = 'MpsReviewDueDateManualEdit1722920104000';
  async up(r: QueryRunner) {
    await r.query(`ALTER TABLE mps_review_due_dates
      ADD COLUMN source_order_number text, ADD COLUMN source_batch_number text, ADD COLUMN source_drawing_number text;
      UPDATE mps_review_due_dates SET source_order_number=order_number,source_batch_number=batch_number,source_drawing_number=drawing_number;
      SET CONSTRAINTS trg_mps_review_due_count IMMEDIATE;
      ALTER TABLE mps_review_due_dates
        ALTER COLUMN source_order_number SET NOT NULL,ALTER COLUMN source_batch_number SET NOT NULL,ALTER COLUMN source_drawing_number SET NOT NULL,
        ADD CONSTRAINT uq_mps_review_due_source UNIQUE(tenant_id,source_order_number,source_batch_number,source_drawing_number);
      SET CONSTRAINTS trg_mps_review_due_count DEFERRED;
      CREATE FUNCTION mps_review_due_initial_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        NEW.source_order_number:=NEW.order_number; NEW.source_batch_number:=NEW.batch_number; NEW.source_drawing_number:=NEW.drawing_number;
        RETURN NEW; END $$;
      CREATE TRIGGER trg_mps_review_due_initial_source BEFORE INSERT ON mps_review_due_dates FOR EACH ROW EXECUTE FUNCTION mps_review_due_initial_source();
      CREATE OR REPLACE FUNCTION mps_review_due_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF (NEW.id,NEW.tenant_id,NEW.source_order_number,NEW.source_batch_number,NEW.source_drawing_number,NEW.created_at,NEW.created_by)
          IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.source_order_number,OLD.source_batch_number,OLD.source_drawing_number,OLD.created_at,OLD.created_by) THEN
          RAISE EXCEPTION '评审交期记录身份及初始来源键不可修改'; END IF;
        IF NEW.inbound_date IS DISTINCT FROM OLD.inbound_date THEN
          IF NEW.change_count<>OLD.change_count+1 OR NEW.previous_inbound_date IS DISTINCT FROM OLD.inbound_date OR NEW.last_changed_at IS NULL THEN
            RAISE EXCEPTION '交期变化必须同事务记录变更次数及上次日期'; END IF;
        ELSIF (NEW.change_count,NEW.previous_inbound_date,NEW.last_changed_at) IS DISTINCT FROM (OLD.change_count,OLD.previous_inbound_date,OLD.last_changed_at) THEN
          RAISE EXCEPTION '未变更交期不能修改交期统计'; END IF;
        RETURN NEW; END $$;`);
  }
  async down(): Promise<void> {
    throw new Error('人工修改后来源身份不可丢弃；本迁移仅允许经评估的前向修复');
  }
}
