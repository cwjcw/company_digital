import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive guards only: no historical DML, no new fact store or process lock. */
export class MpsExecutionFactProtection1722920119000 implements MigrationInterface {
  name = 'MpsExecutionFactProtection1722920119000';
  async up(q: QueryRunner) {
    await q.query(`
      CREATE FUNCTION mps_execution_content(kind text, r jsonb) RETURNS boolean AS $$
        SELECT COALESCE(CASE kind
          WHEN 'mps_process_reports' THEN (r->>'production_quantity')::numeric>0
          WHEN 'mps_technical_reports' THEN r->>'status'='已完成' OR r->>'responsible_user_id' IS NOT NULL
            OR COALESCE(r->'drawing_refs','[]'::jsonb)<>'[]'::jsonb OR NULLIF(btrim(r->>'exception_text'),'') IS NOT NULL
          WHEN 'mps_material_reports' THEN (r->>'received')::boolean OR r->>'actual_inbound_date' IS NOT NULL OR NULLIF(btrim(r->>'exception_text'),'') IS NOT NULL
          WHEN 'mps_outsourcing_reports' THEN (r->>'received')::boolean OR r->>'actual_inbound_date' IS NOT NULL
            OR NULLIF(btrim(r->>'purchase_order_number'),'') IS NOT NULL OR r->>'supplier_id' IS NOT NULL
            OR r->>'outsourcing_method' IS NOT NULL OR r->>'outsourcing_due_date' IS NOT NULL OR NULLIF(btrim(r->>'exception_text'),'') IS NOT NULL
          WHEN 'mps_three_day_work_orders' THEN r->>'production_start_date' IS NOT NULL OR r->>'production_end_date' IS NOT NULL
            OR NULLIF(btrim(r->>'remark'),'') IS NOT NULL OR NULLIF(btrim(r->>'processing_remark'),'') IS NOT NULL
          ELSE false END,false);
      $$ LANGUAGE sql IMMUTABLE;

      CREATE FUNCTION mps_weekly_has_execution(t varchar, w uuid) RETURNS boolean AS $$
        SELECT EXISTS(SELECT 1 FROM mps_weekly_plans p WHERE p.tenant_id=t AND p.id=w
          AND (p.process_config_locked_at IS NOT NULL OR p.allocated_inbound_quantity>0))
        OR EXISTS(SELECT 1 FROM mps_process_reports r WHERE r.tenant_id=t AND r.weekly_plan_id=w AND r.production_quantity>0)
        OR EXISTS(SELECT 1 FROM mps_technical_reports r WHERE r.tenant_id=t AND r.weekly_plan_id=w AND mps_execution_content('mps_technical_reports',to_jsonb(r)))
        OR EXISTS(SELECT 1 FROM mps_material_reports r WHERE r.tenant_id=t AND r.weekly_plan_id=w AND mps_execution_content('mps_material_reports',to_jsonb(r)))
        OR EXISTS(SELECT 1 FROM mps_outsourcing_reports r WHERE r.tenant_id=t AND r.weekly_plan_id=w AND mps_execution_content('mps_outsourcing_reports',to_jsonb(r)))
        OR EXISTS(SELECT 1 FROM mps_three_day_work_orders r WHERE r.tenant_id=t AND r.weekly_plan_id=w AND mps_execution_content('mps_three_day_work_orders',to_jsonb(r)))
        OR EXISTS(SELECT 1 FROM mps_weekly_plans p JOIN mps_base_plans b ON b.tenant_id=p.tenant_id AND b.id=p.base_plan_id
          LEFT JOIN mps_shipping_plans s ON s.tenant_id=b.tenant_id AND s.id=b.shipping_plan_id
          JOIN mps_monthly_plans m ON m.tenant_id=p.tenant_id AND (m.id=s.monthly_plan_id OR (s.monthly_plan_id IS NULL AND m.order_number=p.order_number AND m.item_code=p.item_code AND m.division_id IS NOT DISTINCT FROM p.division_id))
          WHERE p.tenant_id=t AND p.id=w AND m.cumulative_inbound_quantity>0)
        OR EXISTS(SELECT 1 FROM mps_weekly_plans p
          JOIN erp_staging_raw_records r ON r.tenant_id=p.tenant_id AND r.order_number=p.order_number AND r.item_code=p.item_code
            AND r.record_type='INBOUND_LINE' AND r.source_table='ST_RDRecord_b' AND r.order_link_stable=true AND r.status_code='189'
          JOIN finished_goods_inbound f ON f.source_database=r.source_database AND f.source_system=r.source_system AND f.source_key=r.source_id
            AND f.sales_order_number=p.order_number AND f.inventory_code=p.item_code AND f.received_quantity<>0
          WHERE p.tenant_id=t AND p.id=w);
      $$ LANGUAGE sql VOLATILE;

      CREATE FUNCTION mps_guard_executed_plan_identity() RETURNS trigger AS $$
      DECLARE w record; changed boolean;
      BEGIN
        changed := (to_jsonb(OLD)->'division_id',to_jsonb(OLD)->'order_number',to_jsonb(OLD)->'item_code',
          to_jsonb(OLD)->'delivery_number',to_jsonb(OLD)->'manufacturing_method',to_jsonb(OLD)->'base_plan_id',
          to_jsonb(OLD)->'shipping_plan_id',to_jsonb(OLD)->'monthly_plan_id',to_jsonb(OLD)->'allocation_id')
          IS DISTINCT FROM (to_jsonb(NEW)->'division_id',to_jsonb(NEW)->'order_number',to_jsonb(NEW)->'item_code',
          to_jsonb(NEW)->'delivery_number',to_jsonb(NEW)->'manufacturing_method',to_jsonb(NEW)->'base_plan_id',
          to_jsonb(NEW)->'shipping_plan_id',to_jsonb(NEW)->'monthly_plan_id',to_jsonb(NEW)->'allocation_id');
        IF NOT changed THEN RETURN NEW; END IF;
        FOR w IN SELECT p.id FROM mps_weekly_plans p
          LEFT JOIN mps_base_plans b ON b.tenant_id=p.tenant_id AND b.id=p.base_plan_id
          LEFT JOIN mps_shipping_plans s ON s.tenant_id=b.tenant_id AND s.id=b.shipping_plan_id
          LEFT JOIN mps_monthly_plans m ON m.tenant_id=p.tenant_id AND (m.id=s.monthly_plan_id OR (s.monthly_plan_id IS NULL AND m.order_number=p.order_number AND m.item_code=p.item_code AND m.division_id IS NOT DISTINCT FROM p.division_id))
          WHERE p.tenant_id=OLD.tenant_id AND (
            (TG_TABLE_NAME='mps_weekly_plans' AND p.id=OLD.id)
            OR (TG_TABLE_NAME='mps_base_plans' AND b.id=OLD.id)
            OR (TG_TABLE_NAME='mps_shipping_plans' AND s.id=OLD.id)
            OR (TG_TABLE_NAME='mps_monthly_plans' AND m.id=OLD.id)
            OR (TG_TABLE_NAME='mps_order_allocations' AND (m.allocation_id=OLD.id
              OR (p.order_number=OLD.order_number AND p.item_code=OLD.item_code AND p.division_id IS NOT DISTINCT FROM OLD.division_id))))
          ORDER BY p.id FOR UPDATE OF p
        LOOP
          IF mps_weekly_has_execution(OLD.tenant_id,w.id) THEN
            RAISE EXCEPTION '已有生产执行事实，不能直接变更事业部、订单、品项、制造方式或来源关联；请使用受控历史纠错流程'
              USING ERRCODE='23514',CONSTRAINT='ck_mps_executed_identity';
          END IF;
        END LOOP;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;

      CREATE FUNCTION mps_guard_report_context() RETURNS trigger AS $$
      BEGIN
        IF (OLD.id,OLD.tenant_id,OLD.weekly_plan_id,OLD.process_code,OLD.process_name,OLD.division_id,
          OLD.order_number,OLD.item_code,OLD.item_name,OLD.delivery_number,OLD.planned_quantity,OLD.created_at,OLD.created_by)
          IS DISTINCT FROM (NEW.id,NEW.tenant_id,NEW.weekly_plan_id,NEW.process_code,NEW.process_name,NEW.division_id,
          NEW.order_number,NEW.item_code,NEW.item_name,NEW.delivery_number,NEW.planned_quantity,NEW.created_at,NEW.created_by) THEN
          RAISE EXCEPTION '报工历史上下文不可由计划同步或普通修改改写' USING ERRCODE='23514',CONSTRAINT='ck_mps_report_context';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_mps_report_context BEFORE UPDATE ON mps_process_reports FOR EACH ROW EXECUTE FUNCTION mps_guard_report_context();

      CREATE FUNCTION mps_execution_parent_fence() RETURNS trigger AS $$
      BEGIN
        -- A physical parent write fences RR snapshots too; it changes no plan fields, audit metadata or version.
        IF mps_execution_content(TG_TABLE_NAME,to_jsonb(NEW)) OR
          (TG_OP='UPDATE' AND mps_execution_content(TG_TABLE_NAME,to_jsonb(OLD))) THEN
          UPDATE mps_weekly_plans SET id=id WHERE tenant_id=NEW.tenant_id AND id=NEW.weekly_plan_id;
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;

      CREATE FUNCTION mps_guard_executed_task() RETURNS trigger AS $$
      DECLARE previous jsonb; following jsonb; target jsonb; structural boolean;
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
          RAISE EXCEPTION '已有生产执行事实，不能迁移、重建或停用执行任务' USING ERRCODE='23514',CONSTRAINT='ck_mps_executed_identity';
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
    `);
    for (const table of ['mps_weekly_plans','mps_base_plans','mps_shipping_plans','mps_monthly_plans','mps_order_allocations']) {
      await q.query(`CREATE TRIGGER trg_mps_executed_identity BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION mps_guard_executed_plan_identity()`);
    }
    for (const table of ['mps_process_reports','mps_technical_reports','mps_material_reports','mps_outsourcing_reports','mps_three_day_work_orders']) {
      await q.query(`CREATE TRIGGER trg_mps_execution_parent_fence BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION mps_execution_parent_fence()`);
    }
    // Migration107/108 remains the sole persistent process lock. Other execution facts also block identity rebuilds.
    await q.query(`CREATE TRIGGER zz_mps_executed_process_identity BEFORE INSERT OR UPDATE OR DELETE ON mps_weekly_process_plans FOR EACH ROW EXECUTE FUNCTION mps_guard_executed_task()`);
    for (const table of ['mps_technical_reports','mps_material_reports','mps_outsourcing_reports','mps_three_day_work_orders']) {
      await q.query(`CREATE TRIGGER trg_mps_executed_task BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION mps_guard_executed_task()`);
    }
  }
  async down(): Promise<void> { throw new Error('Forward-only: preserve historical execution protection; use a reviewed forward migration'); }
}
