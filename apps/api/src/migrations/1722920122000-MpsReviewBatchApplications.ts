import type { MigrationInterface, QueryRunner } from 'typeorm';
/** DDL only. Application evidence is append-only; no historical links are guessed. */
export class MpsReviewBatchApplications1722920122000 implements MigrationInterface {
    name = 'MpsReviewBatchApplications1722920122000';
    async up(q: QueryRunner) {
        const [ready] = await q.query("SELECT to_regprocedure('mps_assert_demand_link(text,jsonb)') IS NOT NULL ready");
        if (!ready.ready)
            throw Error('122 requires119 and121;120 is optional');
        for (const table of ['mps_review_due_dates', 'mps_base_plans']) {
            const [key] = await q.query(`SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=$1::regclass AND contype IN('u','p') AND conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=$1::regclass AND attname='tenant_id'),(SELECT attnum FROM pg_attribute WHERE attrelid=$1::regclass AND attname='id')]::smallint[]) ready`, [table]);
            if (!key.ready)
                await q.query(`ALTER TABLE ${table} ADD CONSTRAINT uq_${table}_review_tenant UNIQUE(tenant_id,id)`);
        }
        await q.query(`CREATE TABLE mps_review_base_plan_links(
   id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,review_id uuid NOT NULL,base_plan_id uuid NOT NULL,
   outbox_id uuid NOT NULL REFERENCES mps_reconciliation_outbox(id) ON DELETE RESTRICT,
   applied_review_version integer NOT NULL CHECK(applied_review_version>0),applied_date date NOT NULL,
   target_field varchar(64) NOT NULL DEFAULT 'latestReviewDueDate' CHECK(target_field='latestReviewDueDate'),
   status varchar(16) NOT NULL DEFAULT 'APPLIED' CHECK(status='APPLIED'),
   version integer NOT NULL DEFAULT 1 CHECK(version=1),
   created_at timestamptz NOT NULL DEFAULT now(),created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
   updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
   CONSTRAINT fk_mps_review_application_review FOREIGN KEY(tenant_id,review_id) REFERENCES mps_review_due_dates(tenant_id,id) ON DELETE RESTRICT,
   CONSTRAINT fk_mps_review_application_base FOREIGN KEY(tenant_id,base_plan_id) REFERENCES mps_base_plans(tenant_id,id) ON DELETE RESTRICT,
   CONSTRAINT uq_mps_review_application UNIQUE(tenant_id,review_id,base_plan_id,applied_review_version));
   CREATE INDEX ix_mps_review_application_base ON mps_review_base_plan_links(tenant_id,base_plan_id);
   ALTER TABLE mps_review_base_plan_links ENABLE ROW LEVEL SECURITY;
   CREATE POLICY mps_review_application_tenant ON mps_review_base_plan_links USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
   CREATE FUNCTION mps_guard_review_application() RETURNS trigger AS $$
   DECLARE r record;b record;
   BEGIN
    IF TG_OP<>'INSERT' THEN RAISE EXCEPTION '评审批次应用证据不可修改或删除' USING ERRCODE='23514'; END IF;
    SELECT * INTO r FROM mps_review_due_dates WHERE tenant_id=NEW.tenant_id AND id=NEW.review_id FOR SHARE;
    SELECT * INTO b FROM mps_base_plans WHERE tenant_id=NEW.tenant_id AND id=NEW.base_plan_id FOR UPDATE;
    IF r.monthly_plan_id IS NULL OR r.monthly_plan_id IS DISTINCT FROM b.monthly_plan_id OR
       (r.order_number,r.drawing_number,r.division_id) IS DISTINCT FROM(b.order_number,b.item_code,b.division_id) OR
       r.version<>NEW.applied_review_version OR r.inbound_date IS DISTINCT FROM NEW.applied_date OR b.latest_review_due_date IS DISTINCT FROM NEW.applied_date THEN
      RAISE EXCEPTION '评审批次应用身份、版本或日期快照冲突' USING ERRCODE='23514';
    END IF;
    IF COALESCE(to_jsonb(b)->>'lifecycle_status','ACTIVE')<>'ACTIVE' OR EXISTS(SELECT 1 FROM mps_monthly_plans m WHERE m.tenant_id=NEW.tenant_id AND m.id=b.monthly_plan_id AND COALESCE(to_jsonb(m)->>'lifecycle_status','ACTIVE')<>'ACTIVE') THEN
      RAISE EXCEPTION '仅已确认ACTIVE需求和批次可应用评审' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM mps_review_base_plan_links l WHERE l.tenant_id=NEW.tenant_id AND l.base_plan_id=NEW.base_plan_id AND l.review_id<>NEW.review_id) THEN
      RAISE EXCEPTION '批次已有其他评审关系，禁止静默覆盖' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM mps_reconciliation_outbox o WHERE o.id=NEW.outbox_id AND o.tenant_id=NEW.tenant_id AND o.resource='mps-review-due-dates' AND o.record_id=NEW.review_id AND o.sync_key='base-to-weekly' AND o.scope_json->'basePlanIds' @> to_jsonb(ARRAY[NEW.base_plan_id::text])) THEN RAISE EXCEPTION '应用证据缺少对应批次同步事件' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS(SELECT 1 FROM audit_logs a JOIN users u ON u.id=a.actor_id AND u.enabled AND u.tenant_id=a.tenant_id WHERE a.tenant_id=NEW.tenant_id AND a.resource='mps-review-due-dates' AND a.record_id=NEW.review_id::text AND a.action='review.application_authorized' AND a.after_json->>'baseId'=NEW.base_plan_id::text AND a.after_json->>'reviewVersion'=NEW.applied_review_version::text AND a.after_json->>'xactId'=pg_current_xact_id()::text) THEN
      RAISE EXCEPTION '评审应用须由获权Command及同事务审计确认' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
   END;$$ LANGUAGE plpgsql;
   CREATE TRIGGER trg_mps_review_application BEFORE INSERT OR UPDATE OR DELETE ON mps_review_base_plan_links FOR EACH ROW EXECUTE FUNCTION mps_guard_review_application();
   CREATE FUNCTION mps_guard_applied_review_identity() RETURNS trigger AS $$ BEGIN
    IF EXISTS(SELECT 1 FROM mps_review_base_plan_links WHERE tenant_id=OLD.tenant_id AND review_id=OLD.id) AND
      (NEW.tenant_id,NEW.id,NEW.monthly_plan_id,NEW.division_id,NEW.order_number,NEW.batch_number,NEW.drawing_number) IS DISTINCT FROM
      (OLD.tenant_id,OLD.id,OLD.monthly_plan_id,OLD.division_id,OLD.order_number,OLD.batch_number,OLD.drawing_number) THEN
      RAISE EXCEPTION '已有应用历史的评审身份不可普通变更' USING ERRCODE='23514';
    END IF;RETURN NEW;END;$$ LANGUAGE plpgsql;
   CREATE TRIGGER trg_mps_applied_review_identity BEFORE UPDATE ON mps_review_due_dates FOR EACH ROW EXECUTE FUNCTION mps_guard_applied_review_identity();`);
    }
    async down(): Promise<void> { throw Error('Forward-only: retain application evidence and identity guards'); }
}
