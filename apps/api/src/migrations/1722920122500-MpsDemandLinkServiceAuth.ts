import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds one NOLOGIN database execution role for the private scheduled synchronizer.
 * Migration121's identity, source, version, same-transaction and anti-rebind guards
 * remain in force. No data is changed and no lifecycle/performance schema is added.
 */
export class MpsDemandLinkServiceAuth1722920122500 implements MigrationInterface {
  name = 'MpsDemandLinkServiceAuth1722920122500';

  async up(q: QueryRunner): Promise<void> {
    const [ready] = await q.query(`SELECT to_regprocedure('mps_assert_demand_link(text,jsonb)') IS NOT NULL AS demand_guard,
      to_regprocedure('mps_guard_demand_link()') IS NOT NULL AS write_guard,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('mps_base_plans') AND tgname='ab_mps_demand_link' AND tgenabled IN('O','A')) AS base_trigger,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('mps_order_allocations') AND tgname='ab_mps_demand_link' AND tgenabled IN('O','A')) AS allocation_trigger,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('mps_review_due_dates') AND tgname='ab_mps_demand_link' AND tgenabled IN('O','A')) AS review_trigger`);
    if (!ready?.demand_guard || !ready?.write_guard || !ready?.base_trigger || !ready?.allocation_trigger || !ready?.review_trigger)
      throw new Error('Demand-link service authorization requires unchanged Migration121 guards');

    await q.query(`DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mps_demand_link_service') THEN
        EXECUTE 'CREATE ROLE mps_demand_link_service NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS';
      END IF;
    END $$`);
    const [role] = await q.query(`SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls
      FROM pg_roles WHERE rolname='mps_demand_link_service'`);
    if (!role || role.rolcanlogin || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolinherit || role.rolreplication || role.rolbypassrls)
      throw new Error('mps_demand_link_service exists with unsafe role attributes');

    await q.query(`GRANT SELECT ON users,mps_monthly_plans,mps_order_allocations,mps_shipping_plans,mps_base_plans,mps_review_due_dates,audit_logs TO mps_demand_link_service;
      GRANT INSERT ON audit_logs TO mps_demand_link_service;
      GRANT UPDATE(monthly_plan_id) ON mps_order_allocations,mps_base_plans,mps_review_due_dates TO mps_demand_link_service;
      GRANT EXECUTE ON FUNCTION mps_assert_demand_link(text,jsonb) TO mps_demand_link_service`);

    // Migration121 uses FOR SHARE while revalidating the parent and allocation.
    // PostgreSQL requires UPDATE privilege for row-locking SELECTs; do not grant
    // that privilege to the service role. Run this read-and-lock assertion with
    // the migration owner, using a pinned search_path. The trigger itself remains
    // invoker-security, so its current_user provenance check still sees the role.
    await q.query(`CREATE OR REPLACE FUNCTION mps_assert_demand_link(kind text,r jsonb) RETURNS void AS $$
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
      END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public`);

    await q.query(`CREATE OR REPLACE FUNCTION mps_guard_demand_link() RETURNS trigger AS $$
      BEGIN
        IF TG_OP='UPDATE' AND OLD.monthly_plan_id IS NOT NULL AND NEW.monthly_plan_id IS DISTINCT FROM OLD.monthly_plan_id THEN
          RAISE EXCEPTION '已有需求父关系不可重新绑定或清空' USING ERRCODE='23514',CONSTRAINT='ck_mps_demand_rebind';
        END IF;
        PERFORM mps_assert_demand_link(TG_TABLE_NAME,to_jsonb(NEW));
        IF TG_OP='UPDATE' AND OLD.monthly_plan_id IS NULL AND NEW.monthly_plan_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM audit_logs a JOIN users u ON u.id=a.actor_id
          WHERE a.tenant_id=NEW.tenant_id AND a.resource=replace(TG_TABLE_NAME,'_','-') AND a.record_id=NEW.id::text
            AND a.action='demand.link_authorized' AND a.after_json->>'demandId'=NEW.monthly_plan_id::text
            AND a.after_json->>'expectedVersion'=OLD.version::text AND a.after_json->>'xactId'=pg_current_xact_id()::text
            AND (u.enabled OR (u.id='0199e000-0000-7000-8000-000000000001'::uuid AND u.username='__kdos_system__' AND NOT u.enabled
              AND current_user='mps_demand_link_service'
              AND EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=current_user AND NOT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolinherit)))) THEN
          RAISE EXCEPTION '首次关联必须使用同事务授权审计的Application Command' USING ERRCODE='23514',CONSTRAINT='ck_mps_demand_command';
        END IF;
        IF TG_OP='INSERT' AND TG_TABLE_NAME<>'mps_review_due_dates' AND EXISTS(
          SELECT 1 FROM mps_monthly_plans m WHERE m.tenant_id=NEW.tenant_id AND m.id=NEW.monthly_plan_id
          AND to_jsonb(m)->>'lifecycle_status' IN ('ON_HOLD','CANCELLED')) THEN
          RAISE EXCEPTION '暂停或取消需求不能新增普通来源或基础计划' USING ERRCODE='23514',CONSTRAINT='ck_mps_demand_state';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
  }

  async down(): Promise<void> {
    throw new Error('Forward-only: retain demand-link authorization history and database service-role protections');
  }
}
