import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RdAllocationBomTracking1722920138000 implements MigrationInterface {
  name = 'RdAllocationBomTracking1722920138000';
  async up(r: QueryRunner): Promise<void> {
    await r.query('LOCK TABLE mps_order_allocations IN SHARE ROW EXCLUSIVE MODE');
    await r.query(`CREATE TABLE rd_allocation_bom_capture (
      tenant_id varchar(64) PRIMARY KEY, enabled boolean NOT NULL DEFAULT false,
      activated_at timestamptz, historical_count integer NOT NULL DEFAULT 0)`);
    await r.query(`CREATE TABLE rd_allocation_bom_state (
      tenant_id varchar(64) NOT NULL, allocation_id uuid NOT NULL,
      initial_capture_eligible boolean NOT NULL DEFAULT false,
      allocation_date date, allocation_date_basis text,
      initial_bom_status text CHECK(initial_bom_status IN ('Y','N')),
      initial_bom_checked_at timestamptz, initial_capture_delay_seconds integer,
      first_eligible_at timestamptz, current_bom_status text CHECK(current_bom_status IN ('Y','N')),
      first_completed_at timestamptz, first_completed_date date, first_completed_waiting_days integer CHECK(first_completed_waiting_days>=0),
      latest_completed_at timestamptz, latest_completed_date date, locked_waiting_days integer CHECK(locked_waiting_days>=0),
      waiting_basis text, last_status_changed_at timestamptz, last_checked_at timestamptz,
      last_attempt_at timestamptz, last_error text, pending boolean NOT NULL DEFAULT true,
      last_evidence jsonb, version integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(tenant_id,allocation_id),
      FOREIGN KEY(tenant_id,allocation_id) REFERENCES mps_order_allocations(tenant_id,id),
      CHECK(initial_capture_eligible OR initial_bom_status IS NULL))`);
    await r.query(`CREATE INDEX rd_allocation_bom_pending_idx ON rd_allocation_bom_state(tenant_id,allocation_id) WHERE pending`);
    await r.query(`CREATE TABLE rd_allocation_bom_history (
      id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, allocation_id uuid NOT NULL,
      state_version integer NOT NULL, previous_status text CHECK(previous_status IN ('Y','N')),
      bom_status text NOT NULL CHECK(bom_status IN ('Y','N')), observed_at timestamptz NOT NULL,
      observed_date date NOT NULL, waiting_days integer CHECK(waiting_days>=0), event_kind text NOT NULL,
      evidence jsonb NOT NULL, UNIQUE(tenant_id,allocation_id,state_version),
      FOREIGN KEY(tenant_id,allocation_id) REFERENCES rd_allocation_bom_state(tenant_id,allocation_id))`);
    for (const table of ['rd_allocation_bom_capture','rd_allocation_bom_state','rd_allocation_bom_history']) {
      await r.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY ${table}_tenant ON ${table} USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),''))
        WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),''))`);
    }
    const tenants: Array<{tenant_id:string}> = await r.query('SELECT DISTINCT tenant_id FROM mps_order_allocations');
    for (const {tenant_id:tenant} of tenants) {
      await r.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      await r.query('INSERT INTO rd_allocation_bom_capture(tenant_id) VALUES($1)',[tenant]);
      await r.query(`WITH evidence AS (
        SELECT record_id,
          bool_or(action IN ('mps-order-allocations.created','mps-order-allocations.import_created') AND NULLIF(after_json->>'divisionId','') IS NOT NULL) created_assigned,
          min(created_at) FILTER(WHERE before_json IS NOT NULL AND NULLIF(before_json->>'divisionId','') IS NULL AND NULLIF(after_json->>'divisionId','') IS NOT NULL) assigned_at
        FROM audit_logs WHERE tenant_id=$1 AND resource='mps-order-allocations' GROUP BY record_id
      ) INSERT INTO rd_allocation_bom_state(tenant_id,allocation_id,allocation_date,allocation_date_basis,first_eligible_at)
      SELECT a.tenant_id,a.id,
        (CASE WHEN e.created_assigned THEN a.created_at ELSE e.assigned_at END AT TIME ZONE 'Asia/Shanghai')::date,
        CASE WHEN e.created_assigned THEN 'CREATED_ASSIGNED_AUDIT' WHEN e.assigned_at IS NOT NULL THEN 'FIRST_ASSIGNMENT_AUDIT' ELSE 'UNKNOWN' END,
        CASE WHEN a.archived_at IS NULL AND a.order_status='已审核' THEN now() END
      FROM mps_order_allocations a LEFT JOIN evidence e ON e.record_id=a.id::text WHERE a.tenant_id=$1`,[tenant]);
    }
    await r.query(`CREATE FUNCTION rd_allocation_bom_event() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE capture_enabled boolean; first_day date;
      BEGIN
        IF TG_OP='INSERT' THEN
          INSERT INTO rd_allocation_bom_capture(tenant_id) VALUES(NEW.tenant_id) ON CONFLICT DO NOTHING;
          SELECT enabled INTO capture_enabled FROM rd_allocation_bom_capture WHERE tenant_id=NEW.tenant_id;
          INSERT INTO rd_allocation_bom_state(tenant_id,allocation_id,initial_capture_eligible,allocation_date,allocation_date_basis,first_eligible_at)
          VALUES(NEW.tenant_id,NEW.id,capture_enabled,
            CASE WHEN NEW.division_id IS NOT NULL THEN (clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date END,
            CASE WHEN NEW.division_id IS NOT NULL THEN 'CREATED_ASSIGNED_EVENT' ELSE 'UNASSIGNED' END,
            CASE WHEN NEW.archived_at IS NULL AND NEW.order_status='已审核' THEN clock_timestamp() END);
        ELSE
          first_day:=CASE WHEN OLD.division_id IS NULL AND NEW.division_id IS NOT NULL THEN (clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date END;
          UPDATE rd_allocation_bom_state SET
            allocation_date=COALESCE(allocation_date,first_day),
            allocation_date_basis=CASE WHEN allocation_date IS NULL AND first_day IS NOT NULL THEN 'FIRST_ASSIGNMENT_EVENT' ELSE allocation_date_basis END,
            first_eligible_at=COALESCE(first_eligible_at,CASE WHEN NEW.archived_at IS NULL AND NEW.order_status='已审核' THEN clock_timestamp() END),
            pending=true,updated_at=now() WHERE tenant_id=NEW.tenant_id AND allocation_id=NEW.id;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER rd_allocation_bom_event AFTER INSERT OR UPDATE ON mps_order_allocations FOR EACH ROW EXECUTE FUNCTION rd_allocation_bom_event()`);
    await r.query(`CREATE FUNCTION rd_allocation_bom_index_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.last_status='SUCCESS' THEN
          UPDATE rd_allocation_bom_state SET pending=true WHERE tenant_id=NEW.tenant_id;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER rd_allocation_bom_index_event AFTER UPDATE ON rd_bom_sync_state FOR EACH ROW EXECUTE FUNCTION rd_allocation_bom_index_event();
      CREATE TRIGGER rd_allocation_bom_index_event AFTER UPDATE ON rd_tplus_bom_sync_state FOR EACH ROW EXECUTE FUNCTION rd_allocation_bom_index_event()`);
    await r.query(`CREATE FUNCTION rd_allocation_bom_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.initial_capture_eligible IS DISTINCT FROM OLD.initial_capture_eligible
          OR (OLD.initial_bom_status IS NOT NULL AND (NEW.initial_bom_status IS DISTINCT FROM OLD.initial_bom_status OR NEW.initial_bom_checked_at IS DISTINCT FROM OLD.initial_bom_checked_at))
          OR (OLD.allocation_date IS NOT NULL AND NEW.allocation_date IS DISTINCT FROM OLD.allocation_date)
          OR (OLD.first_completed_at IS NOT NULL AND (NEW.first_completed_at IS DISTINCT FROM OLD.first_completed_at OR NEW.first_completed_date IS DISTINCT FROM OLD.first_completed_date OR NEW.first_completed_waiting_days IS DISTINCT FROM OLD.first_completed_waiting_days))
        THEN RAISE EXCEPTION 'RD_BOM_IMMUTABLE_HISTORY' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER rd_allocation_bom_immutable BEFORE UPDATE ON rd_allocation_bom_state FOR EACH ROW EXECUTE FUNCTION rd_allocation_bom_immutable()`);
  }
  async down(): Promise<void> { throw new Error('Forward-only: preserve allocation BOM state/history and capture boundary. Roll back application only.'); }
}
