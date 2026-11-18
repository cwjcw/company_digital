import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Permit only first-time process-task INSERTs when inbound facts are the sole execution evidence. */
export class MpsInboundOnlySnapshotInitialization1722920134000 implements MigrationInterface {
  name = 'MpsInboundOnlySnapshotInitialization1722920134000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION mps_guard_executed_task() RETURNS trigger AS $$
      DECLARE previous jsonb; following jsonb; target jsonb; structural boolean;
        write_mode text := current_setting('app.mps_process_config_write_mode',true);
        inbound_snapshot_init text := current_setting('app.mps_inbound_only_snapshot_init',true);
      BEGIN
        previous := CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END;
        following := CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END;
        target := COALESCE(previous,following);
        structural := TG_OP<>'UPDATE' OR
          (previous->'weekly_plan_id',previous->'division_id',previous->'order_number',previous->'item_code',previous->'delivery_number',
            previous->'execution_enabled',previous->'manufacturing_method',previous->'process_code',previous->'process_name',previous->'sequence',CASE WHEN TG_TABLE_NAME='mps_weekly_process_plans' THEN previous->'cycle_days' ELSE NULL END)
          IS DISTINCT FROM
          (following->'weekly_plan_id',following->'division_id',following->'order_number',following->'item_code',following->'delivery_number',
            following->'execution_enabled',following->'manufacturing_method',following->'process_code',following->'process_name',following->'sequence',CASE WHEN TG_TABLE_NAME='mps_weekly_process_plans' THEN following->'cycle_days' ELSE NULL END);
        IF structural AND mps_weekly_has_execution(target->>'tenant_id',(target->>'weekly_plan_id')::uuid) THEN
          IF TG_OP='INSERT' AND write_mode='CONFIRM' AND inbound_snapshot_init='1'
            AND NOT EXISTS(SELECT 1 FROM mps_weekly_plans w WHERE w.tenant_id=target->>'tenant_id' AND w.id=(target->>'weekly_plan_id')::uuid AND w.process_config_locked_at IS NOT NULL)
            AND NOT EXISTS(SELECT 1 FROM mps_process_reports r WHERE r.tenant_id=target->>'tenant_id' AND r.weekly_plan_id=(target->>'weekly_plan_id')::uuid)
            AND NOT EXISTS(SELECT 1 FROM mps_technical_reports r WHERE r.tenant_id=target->>'tenant_id' AND r.weekly_plan_id=(target->>'weekly_plan_id')::uuid AND mps_execution_content('mps_technical_reports',to_jsonb(r)))
            AND NOT EXISTS(SELECT 1 FROM mps_material_reports r WHERE r.tenant_id=target->>'tenant_id' AND r.weekly_plan_id=(target->>'weekly_plan_id')::uuid AND mps_execution_content('mps_material_reports',to_jsonb(r)))
            AND NOT EXISTS(SELECT 1 FROM mps_outsourcing_reports r WHERE r.tenant_id=target->>'tenant_id' AND r.weekly_plan_id=(target->>'weekly_plan_id')::uuid AND mps_execution_content('mps_outsourcing_reports',to_jsonb(r)))
            AND NOT EXISTS(SELECT 1 FROM mps_three_day_work_orders r WHERE r.tenant_id=target->>'tenant_id' AND r.weekly_plan_id=(target->>'weekly_plan_id')::uuid AND mps_execution_content('mps_three_day_work_orders',to_jsonb(r)))
            AND NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.tenant_id=target->>'tenant_id' AND a.resource='mps-weekly-process-plans'
              AND a.record_id=target->>'weekly_plan_id' AND a.action IN ('mps-weekly-plans.process_config_confirmed','mps-weekly-plans.process_config_initialized'))
          THEN RETURN NEW; END IF;
          RAISE EXCEPTION '已有生产执行事实，不能迁移、重建或停用执行任务' USING ERRCODE='23514',CONSTRAINT='ck_mps_executed_identity';
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
    `);
  }

  async down(): Promise<void> {
    throw new Error('Forward-only: preserve execution protection; use a reviewed forward migration');
  }
}
