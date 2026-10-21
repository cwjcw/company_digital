import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Phase one installs empty, tenant-scoped structures only. No seeds, import or schedules. */
export class MpsReviewDueDates1722920102000 implements MigrationInterface {
  name = 'MpsReviewDueDates1722920102000';
  async up(r: QueryRunner) {
    await r.query(`CREATE TABLE mps_review_due_dates (
      id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,
      order_number text NOT NULL CHECK(btrim(order_number)<>''),batch_number text NOT NULL CHECK(btrim(batch_number)<>''),
      drawing_number text NOT NULL CHECK(btrim(drawing_number)<>''),inspection_time_name text NOT NULL DEFAULT '',
      inbound_date date NOT NULL,quantity numeric NOT NULL CHECK(quantity NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
      change_count integer NOT NULL DEFAULT 0 CHECK(change_count>=0),previous_inbound_date date,
      last_changed_at timestamptz,last_synced_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      updated_at timestamptz NOT NULL DEFAULT now(),updated_by varchar NOT NULL DEFAULT 'system',version integer NOT NULL DEFAULT 1 CHECK(version>0),
      UNIQUE(tenant_id,order_number,batch_number,drawing_number),UNIQUE(tenant_id,id));
      CREATE INDEX idx_mps_review_due_order ON mps_review_due_dates(tenant_id,inbound_date,order_number,batch_number,drawing_number,id);
      CREATE INDEX idx_mps_review_due_drawing ON mps_review_due_dates(tenant_id,drawing_number);
      CREATE TABLE mps_review_due_date_changes (
      id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,review_due_date_id uuid NOT NULL,
      old_inbound_date date NOT NULL,new_inbound_date date NOT NULL,change_days integer NOT NULL,
      change_direction varchar(16) NOT NULL CHECK(change_direction IN ('EARLIER','LATER')),
      changed_at timestamptz NOT NULL DEFAULT now(),changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      source_kind varchar(16) NOT NULL CHECK(source_kind IN ('SYNC','IMPORT','MANUAL')),source_batch_id varchar(128) NOT NULL,
      CHECK(old_inbound_date<>new_inbound_date AND change_days=new_inbound_date-old_inbound_date),
      CHECK((change_days>0 AND change_direction='LATER') OR (change_days<0 AND change_direction='EARLIER')),
      FOREIGN KEY(tenant_id,review_due_date_id) REFERENCES mps_review_due_dates(tenant_id,id) ON DELETE RESTRICT,
      UNIQUE(tenant_id,review_due_date_id,source_kind,source_batch_id));
      CREATE INDEX idx_mps_review_due_history ON mps_review_due_date_changes(tenant_id,review_due_date_id,changed_at DESC,id DESC);
      CREATE FUNCTION mps_review_due_immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION '评审交期历史事件不可修改或删除'; END $$;
      CREATE TRIGGER trg_mps_review_due_immutable BEFORE UPDATE OR DELETE ON mps_review_due_date_changes FOR EACH ROW EXECUTE FUNCTION mps_review_due_immutable_history();
      CREATE FUNCTION mps_review_due_guard_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF (NEW.tenant_id,NEW.order_number,NEW.batch_number,NEW.drawing_number) IS DISTINCT FROM (OLD.tenant_id,OLD.order_number,OLD.batch_number,OLD.drawing_number) THEN
          RAISE EXCEPTION '评审交期业务键不可改名，请建立新记录'; END IF;
        IF NEW.inbound_date IS DISTINCT FROM OLD.inbound_date THEN
          IF NEW.change_count<>OLD.change_count+1 OR NEW.previous_inbound_date IS DISTINCT FROM OLD.inbound_date OR NEW.last_changed_at IS NULL THEN
            RAISE EXCEPTION '交期变化必须同事务记录变更次数及上次日期'; END IF;
        ELSIF (NEW.change_count,NEW.previous_inbound_date,NEW.last_changed_at) IS DISTINCT FROM (OLD.change_count,OLD.previous_inbound_date,OLD.last_changed_at) THEN
          RAISE EXCEPTION '未变更交期不能修改交期统计'; END IF;
        RETURN NEW; END $$;
      CREATE TRIGGER trg_mps_review_due_guard_update BEFORE UPDATE ON mps_review_due_dates FOR EACH ROW EXECUTE FUNCTION mps_review_due_guard_update();
      CREATE FUNCTION mps_review_due_check_count() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE target_id uuid; target_tenant varchar; actual_count integer; stored_count integer; current_date_value date; previous_date_value date; old_date_value date; new_date_value date;
      BEGIN
        IF TG_TABLE_NAME='mps_review_due_dates' THEN target_id:=NEW.id; ELSE target_id:=NEW.review_due_date_id; END IF;
        target_tenant:=NEW.tenant_id;
        SELECT change_count,inbound_date,previous_inbound_date INTO stored_count,current_date_value,previous_date_value FROM mps_review_due_dates WHERE tenant_id=target_tenant AND id=target_id;
        SELECT count(*) INTO actual_count FROM mps_review_due_date_changes WHERE tenant_id=target_tenant AND review_due_date_id=target_id;
        IF stored_count IS DISTINCT FROM actual_count THEN RAISE EXCEPTION '评审交期变更次数与历史事件不一致'; END IF;
        IF actual_count>0 THEN
          SELECT old_inbound_date,new_inbound_date INTO old_date_value,new_date_value FROM mps_review_due_date_changes WHERE tenant_id=target_tenant AND review_due_date_id=target_id ORDER BY changed_at DESC,id DESC LIMIT 1;
          IF current_date_value IS DISTINCT FROM new_date_value OR previous_date_value IS DISTINCT FROM old_date_value THEN RAISE EXCEPTION '评审交期当前日期与最新历史不一致'; END IF;
        END IF;
        RETURN NULL;
      END $$;
      CREATE CONSTRAINT TRIGGER trg_mps_review_due_count AFTER INSERT OR UPDATE ON mps_review_due_dates DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mps_review_due_check_count();
      CREATE CONSTRAINT TRIGGER trg_mps_review_due_history_count AFTER INSERT ON mps_review_due_date_changes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mps_review_due_check_count()`);
    for (const table of ['mps_review_due_dates','mps_review_due_date_changes']) await r.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON ${table} USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true))`);
  }
  async down() { throw new Error('Retain review due-date history; roll back application without deleting business data.'); }
}
