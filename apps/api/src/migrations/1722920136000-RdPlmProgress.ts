import type {MigrationInterface,QueryRunner} from 'typeorm';
export class RdPlmProgress1722920136000 implements MigrationInterface {
 name='RdPlmProgress1722920136000';
 async up(r:QueryRunner){
  await r.query(`CREATE TABLE rd_plm_snapshot(tenant_id varchar(64) PRIMARY KEY,snapshot_id uuid,raw_summary jsonb,raw_detail jsonb,dashboard jsonb,last_status text NOT NULL DEFAULT 'NOT_INITIALIZED' CHECK(last_status IN ('NOT_INITIALIZED','RUNNING','SUCCESS','FAILED')),last_started_at timestamptz,last_success_at timestamptz,last_error_code text)`);
  await r.query(`CREATE TABLE rd_plm_sync_runs(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,status text NOT NULL CHECK(status IN ('RUNNING','SUCCESS','FAILED')),started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,system_count integer,detail_count integer,milestone_count integer,task_count integer,error_code text)`);
  await r.query('CREATE INDEX rd_plm_sync_runs_tenant_time ON rd_plm_sync_runs(tenant_id,started_at DESC)');
  for(const t of ['rd_plm_snapshot','rd_plm_sync_runs'])await r.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${t} FORCE ROW LEVEL SECURITY; CREATE POLICY ${t}_tenant ON ${t} USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')) WITH CHECK(tenant_id=NULLIF(current_setting('app.tenant_id',true),''))`);
 }
 async down():Promise<void>{throw new Error('Forward-only: retain PLM snapshots and audit; revert application and this workflow instead.');}
}
