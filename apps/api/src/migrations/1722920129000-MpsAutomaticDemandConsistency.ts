import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Provenance-only recovery: plan/execution identities and quantities are not changed by this capability. */
export class MpsAutomaticDemandConsistency1722920129000 implements MigrationInterface {
  name='MpsAutomaticDemandConsistency1722920129000';
  async up(q:QueryRunner):Promise<void>{
    await q.query(`CREATE FUNCTION mps_allocation_source_recovery_allowed(previous jsonb,following jsonb) RETURNS boolean AS $$
      DECLARE old_source record; new_source record;
      BEGIN
        IF previous->>'allocation_id' IS NOT DISTINCT FROM following->>'allocation_id'
          OR (previous-ARRAY['allocation_id','updated_at','updated_by','version']) IS DISTINCT FROM
             (following-ARRAY['allocation_id','updated_at','updated_by','version']) THEN RETURN false; END IF;
        SELECT * INTO old_source FROM mps_order_allocations WHERE tenant_id=previous->>'tenant_id' AND id=(previous->>'allocation_id')::uuid FOR SHARE;
        SELECT * INTO new_source FROM mps_order_allocations WHERE tenant_id=previous->>'tenant_id' AND id=(following->>'allocation_id')::uuid FOR SHARE;
        IF old_source.id IS NULL OR old_source.archived_at IS NULL OR old_source.allocated_quantity<>0
          OR (old_source.monthly_plan_id IS NOT NULL AND old_source.monthly_plan_id<>(previous->>'id')::uuid)
          OR new_source.id IS NULL OR new_source.archived_at IS NOT NULL OR new_source.order_status<>'已审核' OR NOT new_source.manually_maintained
          OR (old_source.order_number,old_source.item_code,old_source.division_id::text,old_source.customer_code)
            IS DISTINCT FROM (previous->>'order_number',previous->>'item_code',previous->>'division_id',previous->>'customer_code')
          OR (new_source.order_number,new_source.item_code,new_source.division_id::text,new_source.customer_code)
            IS DISTINCT FROM (previous->>'order_number',previous->>'item_code',previous->>'division_id',previous->>'customer_code') THEN RETURN false; END IF;
        IF EXISTS(SELECT 1 FROM mps_order_allocations a WHERE a.tenant_id=new_source.tenant_id
          AND (a.order_number,a.item_code,a.division_id)=(new_source.order_number,new_source.item_code,new_source.division_id)
          AND a.archived_at IS NULL AND a.order_status='已审核' AND (NOT a.manually_maintained OR a.allocated_quantity<0
            OR a.customer_code IS DISTINCT FROM new_source.customer_code OR (a.monthly_plan_id IS NOT NULL AND a.monthly_plan_id<>(previous->>'id')::uuid)))
          OR EXISTS(SELECT 1 FROM mps_base_plans b WHERE b.tenant_id=new_source.tenant_id AND b.monthly_plan_id=(previous->>'id')::uuid
            AND (b.order_number,b.item_code,b.division_id,b.customer_code) IS DISTINCT FROM
              (new_source.order_number,new_source.item_code,new_source.division_id,new_source.customer_code)) THEN RETURN false; END IF;
        RETURN EXISTS(SELECT 1 FROM audit_logs l JOIN users u ON u.id=l.actor_id
          WHERE l.tenant_id=previous->>'tenant_id' AND l.resource='mps-monthly-plans' AND l.record_id=previous->>'id'
            AND l.action='allocation.source_recovery_authorized'
            AND l.after_json->>'oldSourceId'=previous->>'allocation_id' AND l.after_json->>'newSourceId'=following->>'allocation_id'
            AND l.after_json->>'expectedVersion'=previous->>'version' AND l.after_json->>'xactId'=pg_current_xact_id()::text
            AND (u.enabled OR (u.username='__kdos_system__' AND u.id='0199e000-0000-7000-8000-000000000001'::uuid AND NOT u.enabled)));
      END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public`);
    for(const name of ['mps_guard_demand_parent','mps_guard_executed_plan_identity']){
      const [row]=await q.query('SELECT pg_get_functiondef($1::regprocedure) definition',[name+'()']);
      if(!row?.definition||!/BEGIN/.test(row.definition)||row.definition.includes('mps_allocation_source_recovery_allowed'))throw new Error('Incompatible source recovery guard: '+name);
      await q.query(row.definition.replace(/BEGIN/,`BEGIN
        IF TG_TABLE_NAME='mps_monthly_plans' AND current_user='mps_demand_link_service'
          AND mps_allocation_source_recovery_allowed(to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;`));
    }
    await q.query(`GRANT UPDATE(allocation_id) ON mps_monthly_plans TO mps_demand_link_service;
      GRANT EXECUTE ON FUNCTION mps_allocation_source_recovery_allowed(jsonb,jsonb) TO mps_demand_link_service;
      ALTER TABLE mps_reconciliation_outbox ADD COLUMN superseded_by uuid REFERENCES mps_reconciliation_outbox(id),ADD COLUMN superseded_at timestamptz;
      CREATE TABLE mps_consistency_checkpoints(tenant_id varchar(64) PRIMARY KEY,source_updated_at timestamptz NOT NULL DEFAULT 'epoch',
        source_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',sweep_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
        sweep_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),last_sweep_at timestamptz,metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),version integer NOT NULL DEFAULT 1);
      ALTER TABLE mps_consistency_checkpoints ENABLE ROW LEVEL SECURITY;
      ALTER TABLE mps_consistency_checkpoints FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON mps_consistency_checkpoints USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
      CREATE INDEX ix_mps_allocation_consistency_incremental ON mps_order_allocations(tenant_id,updated_at,id);
      CREATE INDEX ix_mps_outbox_consistency_resource ON mps_reconciliation_outbox(tenant_id,resource,record_id,created_at DESC);`);
  }
  async down():Promise<void>{throw new Error('Forward-only: preserve provenance recovery audits and consistency checkpoints');}
}
