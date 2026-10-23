import type { MigrationInterface, QueryRunner } from "typeorm";

/** 仅允许主计划同步按既有工序快照重算理论交期，不开放任何工艺结构变更。 */
export class MpsProcessDueDateRefreshV11722920108000 implements MigrationInterface {
  name = "MpsProcessDueDateRefreshV11722920108000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION mps_guard_weekly_process_config() RETURNS trigger AS $$
      DECLARE
        target_weekly_id uuid;
        locked_at timestamptz;
        created_at_value timestamptz;
        write_mode text := current_setting('app.mps_process_config_write_mode',true);
        structural_change boolean;
      BEGIN
        target_weekly_id := CASE WHEN TG_OP='DELETE' THEN OLD.weekly_plan_id ELSE NEW.weekly_plan_id END;
        SELECT process_config_locked_at,created_at INTO locked_at,created_at_value
          FROM mps_weekly_plans WHERE tenant_id=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END AND id=target_weekly_id;
        IF TG_OP='INSERT' THEN structural_change := true;
        ELSIF TG_OP='DELETE' THEN structural_change := true;
        ELSE
          structural_change := (OLD.weekly_plan_id,OLD.process_code,OLD.process_name,OLD.sequence,OLD.cycle_days,OLD.due_date,OLD.execution_enabled)
            IS DISTINCT FROM (NEW.weekly_plan_id,NEW.process_code,NEW.process_name,NEW.sequence,NEW.cycle_days,NEW.due_date,NEW.execution_enabled);
          IF NOT structural_change THEN RETURN NEW; END IF;
        END IF;
        IF write_mode='INITIALIZE' AND TG_OP='INSERT' AND created_at_value=transaction_timestamp() AND locked_at IS NULL THEN RETURN NEW; END IF;
        IF write_mode='CONFIRM' AND locked_at IS NULL THEN
          IF TG_OP='DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END IF;
        IF write_mode='RECALCULATE_DATES' AND TG_OP='UPDATE'
          AND (OLD.weekly_plan_id,OLD.process_code,OLD.process_name,OLD.sequence,OLD.cycle_days,OLD.execution_enabled)
            IS NOT DISTINCT FROM (NEW.weekly_plan_id,NEW.process_code,NEW.process_name,NEW.sequence,NEW.cycle_days,NEW.execution_enabled) THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION '工序配置只能通过新周计划初始化或人工预览确认更新；已报工工序配置不可修改'
          USING ERRCODE='23514', CONSTRAINT='ck_mps_process_config_write_guard';
      END;
      $$ LANGUAGE plpgsql;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the v1 guard verbatim; due-date refresh is disabled on rollback.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION mps_guard_weekly_process_config() RETURNS trigger AS $$
      DECLARE target_weekly_id uuid; locked_at timestamptz; created_at_value timestamptz;
        write_mode text := current_setting('app.mps_process_config_write_mode',true); structural_change boolean;
      BEGIN
        target_weekly_id := CASE WHEN TG_OP='DELETE' THEN OLD.weekly_plan_id ELSE NEW.weekly_plan_id END;
        SELECT process_config_locked_at,created_at INTO locked_at,created_at_value FROM mps_weekly_plans
          WHERE tenant_id=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END AND id=target_weekly_id;
        IF TG_OP='INSERT' THEN structural_change:=true; ELSIF TG_OP='DELETE' THEN structural_change:=true; ELSE
          structural_change := (OLD.weekly_plan_id,OLD.process_code,OLD.process_name,OLD.sequence,OLD.cycle_days,OLD.due_date,OLD.execution_enabled)
            IS DISTINCT FROM (NEW.weekly_plan_id,NEW.process_code,NEW.process_name,NEW.sequence,NEW.cycle_days,NEW.due_date,NEW.execution_enabled);
          IF NOT structural_change THEN RETURN NEW; END IF;
        END IF;
        IF write_mode='INITIALIZE' AND TG_OP='INSERT' AND created_at_value=transaction_timestamp() AND locked_at IS NULL THEN RETURN NEW; END IF;
        IF write_mode='CONFIRM' AND locked_at IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
        RAISE EXCEPTION '工序配置只能通过新周计划初始化或人工预览确认更新；已报工工序配置不可修改'
          USING ERRCODE='23514', CONSTRAINT='ck_mps_process_config_write_guard';
      END; $$ LANGUAGE plpgsql;
    `);
  }
}
