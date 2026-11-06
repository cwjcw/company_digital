import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Independent of 120. DDL and forward guards only: never backfill historical rows. */
export class MpsDemandLinks1722920121000 implements MigrationInterface {
  name = 'MpsDemandLinks1722920121000';
  async up(q: QueryRunner) {
    const [protection]=await q.query("SELECT to_regprocedure('mps_guard_executed_plan_identity()') IS NOT NULL AS ready");
    if(!protection.ready)throw new Error('Migration121 requires119 execution fact protection;120 is optional');
    const [key]=await q.query(`SELECT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='mps_monthly_plans'::regclass AND c.contype IN ('u','p')
      AND array_length(c.conkey,1)=2 AND c.conkey @> ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='tenant_id'),(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='id')]::smallint[]) AS ready`);
    if(!key.ready)await q.query(`ALTER TABLE mps_monthly_plans ADD CONSTRAINT uq_mps_demand_tenant_id UNIQUE(tenant_id,id)`);
    for (const table of ['mps_order_allocations','mps_base_plans','mps_review_due_dates']) {
      await q.query(`ALTER TABLE ${table} ADD COLUMN monthly_plan_id uuid,
        ADD CONSTRAINT fk_${table}_demand FOREIGN KEY(tenant_id,monthly_plan_id) REFERENCES mps_monthly_plans(tenant_id,id) ON DELETE RESTRICT;
        CREATE INDEX ix_${table}_demand ON ${table}(tenant_id,monthly_plan_id)`);
    }
    await q.query(`
      CREATE FUNCTION mps_assert_demand_link(kind text,r jsonb) RETURNS void AS $$
      DECLARE m record; a record; s record; item text;
      BEGIN
        IF r->>'monthly_plan_id' IS NULL THEN RETURN; END IF;
        SELECT * INTO m FROM mps_monthly_plans WHERE tenant_id=r->>'tenant_id' AND id=(r->>'monthly_plan_id')::uuid FOR SHARE;
        item:=CASE WHEN kind='mps_review_due_dates' THEN r->>'drawing_number' ELSE r->>'item_code' END;
        IF m.id IS NULL OR m.division_id IS NULL OR
          (m.order_number,m.item_code,m.division_id::text) IS DISTINCT FROM (r->>'order_number',item,r->>'division_id')
          OR (NULLIF(r->>'customer_code','') IS NOT NULL AND NULLIF(m.customer_code,'') IS NOT NULL AND m.customer_code<>r->>'customer_code') THEN
          RAISE EXCEPTION '需求父关系与租户、订单、品项、事业部或客户冲突' USING ERRCODE='23514',CONSTRAINT='ck_mps_demand_identity';
        END IF;
        SELECT * INTO a FROM mps_order_allocations WHERE tenant_id=m.tenant_id AND id=m.allocation_id FOR SHARE;
        IF a.id IS NULL OR (a.order_number,a.item_code,a.division_id) IS DISTINCT FROM (m.order_number,m.item_code,m.division_id)
          OR (NULLIF(a.customer_code,'') IS NOT NULL AND NULLIF(m.customer_code,'') IS NOT NULL AND a.customer_code<>m.customer_code) THEN
          RAISE EXCEPTION '需求来源缺失或身份冲突，不能首次绑定' USING ERRCODE='23514',CONSTRAINT='ck_mps_demand_source';
        END IF;
        IF kind='mps_base_plans' AND r->>'shipping_plan_id' IS NOT NULL THEN
          SELECT * INTO s FROM mps_shipping_plans WHERE tenant_id=m.tenant_id AND id=(r->>'shipping_plan_id')::uuid FOR SHARE;
          IF s.id IS NULL OR (s.order_number,s.item_code,s.division_id) IS DISTINCT FROM (m.order_number,m.item_code,m.division_id)
            OR (s.monthly_plan_id IS NOT NULL AND s.monthly_plan_id<>m.id) THEN
            RAISE EXCEPTION '已有交货计划来源与需求父关系冲突' USING ERRCODE='23514',CONSTRAINT='ck_mps_demand_source';
          END IF;
        END IF;
      END; $$ LANGUAGE plpgsql;
      CREATE FUNCTION mps_guard_demand_link() RETURNS trigger AS $$
      BEGIN
        IF TG_OP='UPDATE' AND OLD.monthly_plan_id IS NOT NULL AND NEW.monthly_plan_id IS DISTINCT FROM OLD.monthly_plan_id THEN
          RAISE EXCEPTION '已有需求父关系不可重新绑定或清空' USING ERRCODE='23514',CONSTRAINT='ck_mps_demand_rebind';
        END IF;
        PERFORM mps_assert_demand_link(TG_TABLE_NAME,to_jsonb(NEW));
        IF TG_OP='UPDATE' AND OLD.monthly_plan_id IS NULL AND NEW.monthly_plan_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM audit_logs a JOIN users u ON u.id=a.actor_id AND u.enabled
          WHERE a.tenant_id=NEW.tenant_id AND a.resource=replace(TG_TABLE_NAME,'_','-') AND a.record_id=NEW.id::text
            AND a.action='demand.link_authorized' AND a.after_json->>'demandId'=NEW.monthly_plan_id::text
            AND a.after_json->>'expectedVersion'=OLD.version::text AND a.after_json->>'xactId'=pg_current_xact_id()::text) THEN
          RAISE EXCEPTION '首次关联必须使用同事务授权审计的Application Command' USING ERRCODE='23514',CONSTRAINT='ck_mps_demand_command';
        END IF;
        IF TG_OP='INSERT' AND TG_TABLE_NAME<>'mps_review_due_dates' AND EXISTS(
          SELECT 1 FROM mps_monthly_plans m WHERE m.tenant_id=NEW.tenant_id AND m.id=NEW.monthly_plan_id
          AND to_jsonb(m)->>'lifecycle_status' IN ('ON_HOLD','CANCELLED')) THEN
          RAISE EXCEPTION '暂停或取消需求不能新增普通来源或基础计划' USING ERRCODE='23514',CONSTRAINT='ck_mps_demand_state';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE FUNCTION mps_guard_demand_parent() RETURNS trigger AS $$
      BEGIN
        IF (OLD.order_number,OLD.item_code,OLD.division_id,OLD.customer_code,OLD.allocation_id)
          IS DISTINCT FROM (NEW.order_number,NEW.item_code,NEW.division_id,NEW.customer_code,NEW.allocation_id)
          AND (EXISTS(SELECT 1 FROM mps_base_plans b WHERE b.tenant_id=OLD.tenant_id AND b.monthly_plan_id=OLD.id)
            OR EXISTS(SELECT 1 FROM mps_order_allocations a WHERE a.tenant_id=OLD.tenant_id AND a.monthly_plan_id=OLD.id)
            OR EXISTS(SELECT 1 FROM mps_review_due_dates r WHERE r.tenant_id=OLD.tenant_id AND r.monthly_plan_id=OLD.id)) THEN
          RAISE EXCEPTION '需求已有稳定关联，身份或代表来源变更须受控核实' USING ERRCODE='23514',CONSTRAINT='ck_mps_demand_parent';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER aa_mps_demand_parent BEFORE UPDATE ON mps_monthly_plans FOR EACH ROW EXECUTE FUNCTION mps_guard_demand_parent();
    `);
    for (const table of ['mps_order_allocations','mps_base_plans','mps_review_due_dates']) {
      await q.query(`CREATE TRIGGER ab_mps_demand_link BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION mps_guard_demand_link()`);
    }
    // Preserve the complete 119 body. Exempt only an evidence-checked NULL initial link,
    // with every other business field byte-for-byte unchanged. No session bypass flag.
    const [row] = await q.query(`SELECT pg_get_functiondef('mps_guard_executed_plan_identity()'::regprocedure) AS definition`);
    const marker = /BEGIN\s+changed :=/;
    if (!marker.test(row.definition)) throw new Error('Migration119 identity protection is not compatible');
    const definition = row.definition.replace(marker, `BEGIN
        IF TG_TABLE_NAME IN ('mps_base_plans','mps_order_allocations')
          AND to_jsonb(OLD)->>'monthly_plan_id' IS NULL AND to_jsonb(NEW)->>'monthly_plan_id' IS NOT NULL
          AND (to_jsonb(OLD)-ARRAY['monthly_plan_id','updated_at','updated_by','version'])
            = (to_jsonb(NEW)-ARRAY['monthly_plan_id','updated_at','updated_by','version']) THEN
          PERFORM mps_assert_demand_link(TG_TABLE_NAME,to_jsonb(NEW));
          RETURN NEW;
        END IF;
        changed :=`);
    await q.query(definition);
  }
  async down(): Promise<void> { throw new Error('Forward-only: retain confirmed demand links and execution protection'); }
}
