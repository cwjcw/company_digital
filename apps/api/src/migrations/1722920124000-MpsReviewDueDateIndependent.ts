import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Forward-only boundary: clear only retired review business rows, then detach the module. */
export class MpsReviewDueDateIndependent1722920124000 implements MigrationInterface {
  name = 'MpsReviewDueDateIndependent1722920124000';

  async up(q: QueryRunner) {
    const [state] = await q.query(`SELECT
      to_regclass('mps_review_due_dates') IS NOT NULL AS review_table,
      to_regclass('mps_review_due_date_changes') IS NOT NULL AS changes_table,
      to_regclass('mps_review_base_plan_links') IS NOT NULL AS application_links,
      EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('mps_review_due_dates') AND attname='monthly_plan_id' AND NOT attisdropped) AS demand_link,
      (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('mps_review_due_dates') AND attname IN('customer_due_date','order_date') AND NOT attisdropped) AS target_columns`);
    if (!state.review_table || !state.changes_table || !state.application_links || !state.demand_link || Number(state.target_columns)!==0)
      throw new Error('评审交期独立化前置结构不匹配；未修改数据库');

    const [queuedReviewEvents] = await q.query(`SELECT count(*)::int n FROM mps_reconciliation_outbox
      WHERE resource='mps-review-due-dates' AND status IN ('PENDING','FAILED','RUNNING')`);
    if (Number(queuedReviewEvents.n) > 0)
      throw new Error('存在待执行/失败/运行中的旧评审计划联动事件；先停止消费者并核实处理结果，再执行断链迁移');

    // The user explicitly chose a clean re-import. Do not infer or backfill values from plans.
    await q.query(`ALTER TABLE mps_review_due_dates ADD COLUMN order_date date, ADD COLUMN customer_due_date date;
      DROP TRIGGER IF EXISTS ab_mps_demand_link ON mps_review_due_dates;
      DROP TRIGGER IF EXISTS trg_mps_applied_review_identity ON mps_review_due_dates;
      DROP TRIGGER IF EXISTS trg_mps_review_due_guard_update ON mps_review_due_dates;`);

    await q.query(`DROP TRIGGER IF EXISTS trg_mps_review_due_count ON mps_review_due_dates;
      DROP TRIGGER IF EXISTS trg_mps_review_due_history_count ON mps_review_due_date_changes;
      DROP FUNCTION IF EXISTS mps_review_due_check_count() RESTRICT`);

    await q.query(`CREATE OR REPLACE FUNCTION mps_review_due_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' THEN
        IF current_setting('app.review_due_delete_authorized',true)='true'
          AND current_setting('app.tenant_id',true)=OLD.tenant_id THEN RETURN OLD; END IF;
        RAISE EXCEPTION '评审交期记录仅允许经授权的本表删除命令删除';
      END IF;
      IF (NEW.id,NEW.tenant_id,NEW.created_at,NEW.created_by)
        IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.created_at,OLD.created_by) THEN
        RAISE EXCEPTION '评审交期记录身份及创建审计不可修改';
      END IF;
      IF NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.updated_by AND u.tenant_id=NEW.tenant_id) THEN
        RAISE EXCEPTION '评审交期更新人必须属于当前租户';
      END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER trg_mps_review_due_guard_update BEFORE UPDATE OR DELETE ON mps_review_due_dates FOR EACH ROW EXECUTE FUNCTION mps_review_due_guard_update();`);

    await q.query(`DROP TRIGGER trg_mps_review_application ON mps_review_base_plan_links;
      DROP FUNCTION mps_guard_review_application();
      DROP FUNCTION mps_guard_applied_review_identity();
      DROP TABLE mps_review_base_plan_links RESTRICT;
      DROP TRIGGER IF EXISTS trg_mps_review_due_initial_source ON mps_review_due_dates;
      DROP FUNCTION IF EXISTS mps_review_due_initial_source();
      ALTER TABLE mps_review_due_dates DROP CONSTRAINT IF EXISTS mps_review_due_dates_change_count_check;
      ALTER TABLE mps_review_due_dates DROP CONSTRAINT IF EXISTS uq_mps_review_due_dates_review_tenant RESTRICT;
      ALTER TABLE mps_review_due_dates DROP CONSTRAINT uq_mps_review_due_source RESTRICT;
      ALTER TABLE mps_review_due_dates DROP CONSTRAINT fk_mps_review_due_source_division RESTRICT`);

    // The detail rows are module-owned business history; system audit_logs are deliberately untouched.
    // Iterate tenant contexts so FORCE RLS is respected even when the migration role is not a superuser.
    await q.query(`CREATE OR REPLACE FUNCTION mps_review_due_immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='DELETE' AND current_setting('app.review_due_delete_authorized',true)='true'
        AND current_setting('app.tenant_id',true)=OLD.tenant_id THEN RETURN OLD; END IF;
      RAISE EXCEPTION '评审交期历史事件不可修改；仅可随获权删除命令一并删除'; END $$`);
    const tenants: Array<{tenant_id:string}> = await q.query(`SELECT DISTINCT tenant_id FROM mps_review_due_dates ORDER BY tenant_id`);
    for (const {tenant_id} of tenants) {
      await q.query(`SELECT set_config('app.tenant_id',$1,true)`,[tenant_id]);
      await q.query(`SELECT set_config('app.review_due_delete_authorized','true',true)`);
      await q.query(`DELETE FROM mps_review_due_date_changes WHERE tenant_id=$1`,[tenant_id]);
      await q.query(`DELETE FROM mps_review_due_dates WHERE tenant_id=$1`,[tenant_id]);
    }
    await q.query(`SELECT set_config('app.review_due_delete_authorized','false',true)`);

    await q.query(`ALTER TABLE mps_review_due_dates DROP CONSTRAINT fk_mps_review_due_dates_demand RESTRICT;
      DROP INDEX ix_mps_review_due_dates_demand RESTRICT;
      ALTER TABLE mps_review_due_dates DROP COLUMN source_division_id RESTRICT;
      ALTER TABLE mps_review_due_dates DROP COLUMN source_order_number RESTRICT;
      ALTER TABLE mps_review_due_dates DROP COLUMN source_batch_number RESTRICT;
      ALTER TABLE mps_review_due_dates DROP COLUMN source_drawing_number RESTRICT;
      ALTER TABLE mps_review_due_dates DROP COLUMN monthly_plan_id RESTRICT;
      ALTER TABLE mps_review_due_dates DROP COLUMN due_date RESTRICT;
      ALTER TABLE mps_review_due_dates DROP COLUMN change_count RESTRICT;
      ALTER TABLE mps_review_due_dates DROP COLUMN previous_inbound_date RESTRICT`);

    // Migration 121's parent guard and demand validator remain active for allocations/base plans,
    // but review due dates are no longer a demand child.
    await q.query(`CREATE OR REPLACE FUNCTION mps_guard_demand_parent() RETURNS trigger AS $$
      BEGIN
        IF (OLD.order_number,OLD.item_code,OLD.division_id,OLD.customer_code,OLD.allocation_id)
          IS DISTINCT FROM (NEW.order_number,NEW.item_code,NEW.division_id,NEW.customer_code,NEW.allocation_id)
          AND (EXISTS(SELECT 1 FROM mps_base_plans b WHERE b.tenant_id=OLD.tenant_id AND b.monthly_plan_id=OLD.id)
            OR EXISTS(SELECT 1 FROM mps_order_allocations a WHERE a.tenant_id=OLD.tenant_id AND a.monthly_plan_id=OLD.id)) THEN
          RAISE EXCEPTION '需求已有稳定关联，身份或代表来源变更须受控核实' USING ERRCODE='23514',CONSTRAINT='ck_mps_demand_parent';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);

    const [fn] = await q.query(`SELECT pg_get_functiondef('mps_assert_demand_link(text,jsonb)'::regprocedure) AS definition`);
    const oldItem = "item:=CASE WHEN kind='mps_review_due_dates' THEN r->>'drawing_number' ELSE r->>'item_code' END;";
    if (!String(fn.definition).includes(oldItem)) throw new Error('Migration 121 demand validator shape changed; stop for review');
    await q.query(String(fn.definition).replace(oldItem, "item:=r->>'item_code';"));
  }

  async down(): Promise<void> {
    throw new Error('不可安全降级：旧评审业务数据及指定字段数据已清空/物理删除，断链后不得恢复旧联动');
  }
}
