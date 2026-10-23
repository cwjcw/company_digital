import type { MigrationInterface, QueryRunner } from "typeorm";

/** PMC工序改造一期：事业部默认工序/周期 + 跨事业部品号路线 + 首次有效报工锁定。 */
export class MpsProcessRoutingV11722920107000 implements MigrationInterface {
  name = "MpsProcessRoutingV11722920107000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mps_weekly_plans ADD COLUMN IF NOT EXISTS process_config_locked_at timestamptz;
      COMMENT ON COLUMN mps_weekly_plans.process_config_locked_at IS '首次有效工序报工后锁定工序集合、顺序和周期；不可由业务API清除';

      CREATE TABLE mps_division_process_configs (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        division_id uuid NOT NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
        process_code varchar(32) NOT NULL, cycle_days integer, default_enabled boolean NOT NULL DEFAULT true,
        sequence integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid REFERENCES users(id) ON DELETE RESTRICT, updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_division_process_code UNIQUE(tenant_id,division_id,process_code),
        CONSTRAINT uq_mps_division_process_sequence UNIQUE(tenant_id,division_id,sequence) DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT ck_mps_division_process_code CHECK(process_code IN ('cutting','machining','bending','spotWelding','welding','woodworking','grinding','blank','surfaceTreatment','packaging')),
        CONSTRAINT ck_mps_division_process_cycle CHECK(cycle_days IS NULL OR cycle_days>=0),
        CONSTRAINT ck_mps_division_process_sequence CHECK(sequence>0),
        CONSTRAINT ck_mps_division_process_version CHECK(version>0)
      );
      CREATE TABLE mps_item_process_routes (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        item_code varchar(128) NOT NULL, process_code varchar(32) NOT NULL, sequence integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_item_process_code UNIQUE(tenant_id,item_code,process_code),
        CONSTRAINT uq_mps_item_process_sequence UNIQUE(tenant_id,item_code,sequence) DEFERRABLE INITIALLY DEFERRED,
        CONSTRAINT ck_mps_item_process_code CHECK(process_code IN ('cutting','machining','bending','spotWelding','welding','woodworking','grinding','blank','surfaceTreatment','packaging')),
        CONSTRAINT ck_mps_item_process_sequence CHECK(sequence>0),
        CONSTRAINT ck_mps_item_process_version CHECK(version>0)
      );
      CREATE INDEX idx_mps_item_process_routes_item ON mps_item_process_routes(tenant_id,item_code,sequence);

      ALTER TABLE mps_division_process_configs ENABLE ROW LEVEL SECURITY;
      CREATE POLICY mps_division_process_configs_tenant_policy ON mps_division_process_configs
        USING (tenant_id=current_setting('app.tenant_id',true))
        WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
      ALTER TABLE mps_item_process_routes ENABLE ROW LEVEL SECURITY;
      CREATE POLICY mps_item_process_routes_tenant_policy ON mps_item_process_routes
        USING (tenant_id=current_setting('app.tenant_id',true))
        WITH CHECK (tenant_id=current_setting('app.tenant_id',true));

      UPDATE mps_weekly_plans weekly SET process_config_locked_at=now()
      WHERE EXISTS (
        SELECT 1 FROM mps_process_reports report
        WHERE report.tenant_id=weekly.tenant_id AND report.weekly_plan_id=weekly.id AND report.production_quantity>0
      );
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
        IF TG_OP='INSERT' THEN
          structural_change := true;
        ELSIF TG_OP='DELETE' THEN
          structural_change := true;
        ELSE
          structural_change := (OLD.weekly_plan_id,OLD.process_code,OLD.process_name,OLD.sequence,OLD.cycle_days,OLD.due_date,OLD.execution_enabled)
            IS DISTINCT FROM (NEW.weekly_plan_id,NEW.process_code,NEW.process_name,NEW.sequence,NEW.cycle_days,NEW.due_date,NEW.execution_enabled);
          IF NOT structural_change THEN RETURN NEW; END IF;
        END IF;
        IF write_mode='INITIALIZE' AND TG_OP='INSERT' AND created_at_value=transaction_timestamp() AND locked_at IS NULL THEN
          RETURN NEW;
        END IF;
        IF write_mode='CONFIRM' AND locked_at IS NULL THEN
          IF TG_OP='DELETE' THEN RETURN OLD; END IF;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION '工序配置只能通过新周计划初始化或人工预览确认更新；已报工工序配置不可修改'
          USING ERRCODE='23514', CONSTRAINT='ck_mps_process_config_write_guard';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_mps_weekly_process_config_guard
        BEFORE INSERT OR UPDATE OR DELETE ON mps_weekly_process_plans
        FOR EACH ROW EXECUTE FUNCTION mps_guard_weekly_process_config();

      CREATE OR REPLACE FUNCTION mps_lock_weekly_process_config_after_report() RETURNS trigger AS $$
      BEGIN
        IF NEW.production_quantity>0 THEN
          UPDATE mps_weekly_plans SET process_config_locked_at=COALESCE(process_config_locked_at,now()),
            updated_at=CASE WHEN process_config_locked_at IS NULL THEN now() ELSE updated_at END,
            updated_by=CASE WHEN process_config_locked_at IS NULL THEN NEW.updated_by ELSE updated_by END,
            version=CASE WHEN process_config_locked_at IS NULL THEN version+1 ELSE version END
          WHERE tenant_id=NEW.tenant_id AND id=NEW.weekly_plan_id AND process_config_locked_at IS NULL;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_mps_process_report_locks_process_config
        AFTER INSERT OR UPDATE OF production_quantity ON mps_process_reports
        FOR EACH ROW EXECUTE FUNCTION mps_lock_weekly_process_config_after_report();
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_mps_process_report_locks_process_config ON mps_process_reports;
      DROP FUNCTION IF EXISTS mps_lock_weekly_process_config_after_report();
      DROP TRIGGER IF EXISTS trg_mps_weekly_process_config_guard ON mps_weekly_process_plans;
      DROP FUNCTION IF EXISTS mps_guard_weekly_process_config();
      DROP TABLE IF EXISTS mps_item_process_routes;
      DROP TABLE IF EXISTS mps_division_process_configs;
      ALTER TABLE mps_weekly_plans DROP COLUMN IF EXISTS process_config_locked_at;
    `);
  }
}
