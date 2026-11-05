import type { MigrationInterface, QueryRunner } from 'typeorm';

/** No historical quantities/IDs/facts are rewritten. Existing rows retain unknown provenance. */
export class MpsPlanLifecycle1722920120000 implements MigrationInterface {
  name='MpsPlanLifecycle1722920120000';
  async up(q:QueryRunner) {
    for(const table of ['mps_monthly_plans','mps_base_plans','mps_weekly_plans']) {
      await q.query(`ALTER TABLE ${table} ADD COLUMN lifecycle_status varchar(24) NOT NULL DEFAULT 'LEGACY_RETAINED',
        ADD CONSTRAINT ck_${table}_lifecycle CHECK(lifecycle_status IN ('ACTIVE','ON_HOLD','CANCELLED','LEGACY_RETAINED'));
        ALTER TABLE ${table} ALTER COLUMN lifecycle_status SET DEFAULT 'ACTIVE';
        CREATE INDEX ix_${table}_lifecycle ON ${table}(tenant_id,lifecycle_status,division_id);`);
    }
    await q.query(`
      CREATE FUNCTION mps_weekly_lifecycle_execution_allowed(t varchar,w uuid) RETURNS boolean AS $$
        SELECT EXISTS(SELECT 1 FROM mps_weekly_plans p
          LEFT JOIN mps_base_plans b ON b.tenant_id=p.tenant_id AND b.id=p.base_plan_id
          LEFT JOIN mps_shipping_plans s ON s.tenant_id=b.tenant_id AND s.id=b.shipping_plan_id
          WHERE p.tenant_id=t AND p.id=w AND p.lifecycle_status NOT IN ('ON_HOLD','CANCELLED')
          AND COALESCE(b.lifecycle_status,'LEGACY_RETAINED') NOT IN ('ON_HOLD','CANCELLED')
          AND NOT EXISTS(SELECT 1 FROM mps_monthly_plans m WHERE m.tenant_id=p.tenant_id
            AND (m.id=s.monthly_plan_id OR (s.monthly_plan_id IS NULL AND m.order_number=p.order_number AND m.item_code=p.item_code AND m.division_id IS NOT DISTINCT FROM p.division_id))
            AND m.lifecycle_status IN ('ON_HOLD','CANCELLED')));
      $$ LANGUAGE sql VOLATILE;
      CREATE FUNCTION mps_guard_plan_lifecycle() RETURNS trigger AS $$
      DECLARE b_id uuid; s_id uuid;
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION '计划生命周期保留记录，禁止物理删除' USING ERRCODE='23514',CONSTRAINT='ck_mps_lifecycle'; END IF;
        IF (TG_OP='INSERT' AND NEW.lifecycle_status NOT IN ('ACTIVE','LEGACY_RETAINED')) OR
           (TG_OP='UPDATE' AND NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status) THEN
          IF current_setting('app.mps_lifecycle_command',true) IS DISTINCT FROM '1' OR current_setting('app.mps_lifecycle_enabled',true) IS DISTINCT FROM '1' THEN
            RAISE EXCEPTION '生命周期只能通过启用后的专用预览确认命令修改' USING ERRCODE='23514',CONSTRAINT='ck_mps_lifecycle';
          END IF;
        END IF;
        IF TG_OP='INSERT' AND TG_TABLE_NAME IN ('mps_base_plans','mps_weekly_plans') THEN
          IF TG_TABLE_NAME='mps_weekly_plans' THEN
            b_id:=(to_jsonb(NEW)->>'base_plan_id')::uuid;
            PERFORM 1 FROM mps_base_plans b WHERE b.tenant_id=NEW.tenant_id AND b.id=b_id FOR SHARE;
            SELECT b.shipping_plan_id INTO s_id FROM mps_base_plans b WHERE b.tenant_id=NEW.tenant_id AND b.id=b_id;
            IF EXISTS(SELECT 1 FROM mps_base_plans b WHERE b.tenant_id=NEW.tenant_id AND b.id=b_id AND b.lifecycle_status IN ('ON_HOLD','CANCELLED')) THEN
              RAISE EXCEPTION '暂停或取消基础计划不能新增周计划' USING ERRCODE='23514',CONSTRAINT='ck_mps_lifecycle';
            END IF;
          ELSE s_id:=(to_jsonb(NEW)->>'shipping_plan_id')::uuid;
          END IF;
          PERFORM 1 FROM mps_monthly_plans m WHERE m.tenant_id=NEW.tenant_id AND
            (m.id=(SELECT s.monthly_plan_id FROM mps_shipping_plans s WHERE s.tenant_id=NEW.tenant_id AND s.id=s_id)
              OR (m.order_number=NEW.order_number AND m.item_code=NEW.item_code AND m.division_id IS NOT DISTINCT FROM NEW.division_id)) FOR SHARE;
          IF EXISTS(SELECT 1 FROM mps_monthly_plans m WHERE m.tenant_id=NEW.tenant_id AND m.lifecycle_status IN ('ON_HOLD','CANCELLED') AND
            (m.id=(SELECT s.monthly_plan_id FROM mps_shipping_plans s WHERE s.tenant_id=NEW.tenant_id AND s.id=s_id)
              OR (m.order_number=NEW.order_number AND m.item_code=NEW.item_code AND m.division_id IS NOT DISTINCT FROM NEW.division_id))) THEN
            RAISE EXCEPTION '暂停或取消月度计划不能新增下游计划' USING ERRCODE='23514',CONSTRAINT='ck_mps_lifecycle';
          END IF;
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE FUNCTION mps_guard_lifecycle_execution() RETURNS trigger AS $$
      DECLARE target jsonb; old_data jsonb; new_data jsonb; w uuid; t varchar;
      BEGIN
        target:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
        w:=(target->>'weekly_plan_id')::uuid; t:=target->>'tenant_id';
        PERFORM 1 FROM mps_weekly_plans p WHERE p.tenant_id=t AND p.id=w FOR UPDATE;
        PERFORM 1 FROM mps_base_plans b JOIN mps_weekly_plans p ON p.tenant_id=b.tenant_id AND p.base_plan_id=b.id WHERE p.tenant_id=t AND p.id=w FOR SHARE OF b;
        PERFORM 1 FROM mps_monthly_plans m JOIN mps_weekly_plans p ON p.tenant_id=m.tenant_id
          LEFT JOIN mps_base_plans b ON b.tenant_id=p.tenant_id AND b.id=p.base_plan_id
          LEFT JOIN mps_shipping_plans s ON s.tenant_id=b.tenant_id AND s.id=b.shipping_plan_id
          WHERE p.tenant_id=t AND p.id=w AND (m.id=s.monthly_plan_id OR (p.order_number=m.order_number AND p.item_code=m.item_code AND p.division_id IS NOT DISTINCT FROM m.division_id)) FOR SHARE OF m;
        IF mps_weekly_lifecycle_execution_allowed(t,w) THEN
          IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
        END IF;
        IF TG_OP='UPDATE' THEN
          IF TG_TABLE_NAME='mps_process_reports' AND current_setting('app.mps_lifecycle_correction',true)='1' THEN RETURN NEW; END IF;
          old_data:=to_jsonb(OLD)-ARRAY['updated_by','updated_at','version'];
          new_data:=to_jsonb(NEW)-ARRAY['updated_by','updated_at','version'];
          IF TG_TABLE_NAME='mps_weekly_process_plans' THEN
            old_data:=old_data-ARRAY['status','daily_reported_quantity'];new_data:=new_data-ARRAY['status','daily_reported_quantity'];
          END IF;
          IF TG_TABLE_NAME='mps_outsourcing_reports' THEN old_data:=old_data-'status';new_data:=new_data-'status'; END IF;
          IF TG_TABLE_NAME='mps_outsourcing_reports' AND (to_jsonb(NEW)->>'received')::boolean=((to_jsonb(OLD)->>'actual_inbound_date') IS NOT NULL) THEN old_data:=old_data-'received';new_data:=new_data-'received'; END IF;
          IF old_data=new_data THEN RETURN NEW; END IF;
        END IF;
        RAISE EXCEPTION '暂停或取消计划不能新增普通执行；历史纠错须使用获权的专用纠错命令' USING ERRCODE='23514',CONSTRAINT='ck_mps_lifecycle_execution';
      END; $$ LANGUAGE plpgsql;
    `);
    for(const table of ['mps_monthly_plans','mps_base_plans','mps_weekly_plans']) await q.query(`CREATE TRIGGER aa_mps_plan_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION mps_guard_plan_lifecycle()`);
    for(const table of ['mps_process_reports','mps_technical_reports','mps_material_reports','mps_outsourcing_reports','mps_three_day_work_orders','mps_weekly_process_plans']) await q.query(`CREATE TRIGGER aa_mps_lifecycle_execution BEFORE INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION mps_guard_lifecycle_execution()`);
  }
  async down():Promise<void>{throw new Error('Forward-only: preserve lifecycle and historical facts; close writes and use a reviewed forward migration');}
}
