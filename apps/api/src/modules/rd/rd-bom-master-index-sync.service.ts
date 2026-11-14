import { Injectable } from '@nestjs/common';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DataSource } from 'typeorm';

type SourceRecord = {
  source_bom_id: string; item_id: string | null; item_code: string | null; owner_org_id: string | null;
  version_times: string | null; approve_status: string | null; approve_date: string | null; create_date: string | null;
  modified_date: string | null; last_modified_date: string | null;
};
type WorkerEvent = { type: string; mode?: string; fromVersion?: number; toVersion?: number; scanned?: number; records?: Array<SourceRecord & { operation?: string; change_version?: number }> };
const valueRows = (rows: unknown[][]) => {
  let index = 0;
  const values = rows.flat();
  const sql = rows.map(row => `(${row.map(() => `$${++index}`).join(',')})`).join(',');
  return { sql, values };
};

@Injectable()
export class RdBomMasterIndexSyncService {
  constructor(private readonly dataSource: DataSource) {}

  async sync(tenantId: string, requestedMode: 'FULL' | 'INCREMENTAL' = 'INCREMENTAL') {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(tenantId)) throw new Error('RD_BOM_TENANT_ID_INVALID');
    const runId = randomUUID(), leaseToken = randomUUID(), generationId = randomUUID();
    const state = await this.claim(tenantId, runId, leaseToken, requestedMode);
    const mode = state.mode;
    let fromVersion: number | null = state.lastChangeVersion;
    let targetVersion: number | null = null;
    let scanned = 0, revoked = 0, deleted = 0;
    let sawBegin = false, sawEnd = false;
    let lostLease = false;
    let child: ChildProcessWithoutNullStreams | undefined;
    const heartbeat = setInterval(() => {
      void this.heartbeat(tenantId, leaseToken).then(alive => { if (!alive) lostLease = true; }).catch(() => { lostLease = true; });
    }, 60_000);
    heartbeat.unref?.();
    try {
      const script = process.env.RD_ORDER_BOM_SYNC_READER ?? path.resolve(process.cwd(), '../../data-operations/e10/rd_order_bom_sync_reader.py');
      const python = process.env.RD_E10_PYTHON ?? '/data/automation/code/work/basci/basic_code/.venv/bin/python';
      const spawned = spawn(python, [script], { env: { ...process.env, PYTHONPATH: process.env.RD_BASIC_CODE_ROOT ?? '/data/automation/code/work/basci/basic_code' }, stdio: ['pipe','pipe','pipe'] });
      child = spawned;
      let stderr = '';
      const exitPromise = new Promise<number | null>((resolve, reject) => { spawned.once('error', reject); spawned.once('close', resolve); });
      spawned.stderr.setEncoding('utf8'); spawned.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-300); });
      spawned.stdin.end(JSON.stringify({ mode, fromVersion, pageSize: 500 }));
      const lines = createInterface({ input: spawned.stdout, crlfDelay: Infinity });
      for await (const line of lines) {
        if (!line.trim()) continue;
        if (lostLease) throw new Error('RD_BOM_SYNC_LEASE_LOST');
        let event: WorkerEvent;
        try { event = JSON.parse(line) as WorkerEvent; } catch { throw new Error('RD_BOM_SYNC_PROTOCOL_INVALID'); }
        if (event.type === 'begin') {
          if (sawBegin || event.mode !== mode) throw new Error('RD_BOM_SYNC_PROTOCOL_INVALID');
          sawBegin = true;
          if (mode === 'FULL') fromVersion = Number(event.fromVersion);
          else if (Number(event.fromVersion) !== fromVersion) throw new Error('RD_BOM_SYNC_WATERMARK_CHANGED');
        } else if (event.type === 'snapshot') {
          if (mode !== 'FULL' || !sawBegin || !Array.isArray(event.records)) throw new Error('RD_BOM_SYNC_PROTOCOL_INVALID');
          await this.writeSnapshot(tenantId, generationId, event.records);
          scanned += event.records.length;
        } else if (event.type === 'changes_begin') {
          if (!sawBegin || targetVersion != null || Number(event.fromVersion) !== fromVersion) throw new Error('RD_BOM_SYNC_PROTOCOL_INVALID');
          targetVersion = Number(event.toVersion);
        } else if (event.type === 'changes') {
          if (targetVersion == null || !Array.isArray(event.records)) throw new Error('RD_BOM_SYNC_PROTOCOL_INVALID');
          const records = event.records;
          if (mode === 'FULL') {
            await this.applyChangesToGeneration(tenantId, generationId, records);
            for (const row of records) { if (row.operation === 'DELETE') deleted++; else if (row.operation === 'REVOKE') revoked++; }
          } else {
            await this.stageChanges(tenantId, runId, records);
            for (const row of records) { if (row.operation === 'DELETE') deleted++; else if (row.operation === 'REVOKE') revoked++; }
          }
          scanned += records.length;
        } else if (event.type === 'end') {
          if (sawEnd || !sawBegin || event.mode !== mode || targetVersion == null || Number(event.toVersion) !== targetVersion) throw new Error('RD_BOM_SYNC_PROTOCOL_INVALID');
          sawEnd = true;
        } else throw new Error('RD_BOM_SYNC_PROTOCOL_INVALID');
        await this.heartbeat(tenantId, leaseToken).then(alive => { if (!alive) throw new Error('RD_BOM_SYNC_LEASE_LOST'); });
      }
      const exitCode = await exitPromise;
      if (exitCode !== 0) throw new Error(this.safeErrorCode(stderr));
      if (!sawBegin || !sawEnd || targetVersion == null || lostLease) throw new Error('RD_BOM_SYNC_INCOMPLETE');
      let inserted = 0, updated = 0;
      if (mode === 'FULL') {
        inserted = await this.finishFull(tenantId, runId, leaseToken, generationId, Number(targetVersion), scanned, revoked, deleted);
      } else {
        const counts = await this.finishIncremental(tenantId, runId, leaseToken, String(state.activeGeneration), Number(targetVersion), scanned, revoked, deleted);
        inserted = counts.inserted;
        updated = counts.updated;
      }
      return { runId, mode, status: 'SUCCESS', scanned, inserted, updated, revoked, deleted, toVersion: targetVersion };
    } catch (error) {
      child?.kill('SIGTERM');
      const code = this.safeErrorCode(error instanceof Error ? error.message : 'RD_BOM_SYNC_FAILED');
      await this.fail(tenantId, runId, leaseToken, code, scanned, mode, generationId).catch(() => undefined);
      throw new Error(`RD_BOM_SYNC_FAILED:${code}`);
    } finally { clearInterval(heartbeat); }
  }

  private safeErrorCode(value: string) {
    const known = ['CHANGE_TRACKING_UNAVAILABLE','CHANGE_TRACKING_RETENTION_GAP','RD_BOM_SYNC_LEASE_LOST','RD_BOM_SYNC_PROTOCOL_INVALID','RD_BOM_SYNC_WATERMARK_CHANGED','RD_BOM_SYNC_INCOMPLETE'];
    const match = known.find(code => value.includes(code));
    return match ?? (value.startsWith('RD_BOM_') ? value.slice(0,100) : 'E10_READ_OR_SYNC_FAILURE');
  }

  private async claim(tenantId: string, runId: string, leaseToken: string, requestedMode: 'FULL'|'INCREMENTAL') {
    return this.dataSource.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
      await manager.query(`INSERT INTO rd_bom_sync_state(tenant_id) VALUES($1) ON CONFLICT(tenant_id) DO NOTHING`,[tenantId]);
      const [state] = await manager.query(`SELECT active_generation::text "activeGeneration",last_change_version "lastChangeVersion",lease_until "leaseUntil" FROM rd_bom_sync_state WHERE tenant_id=$1 FOR UPDATE`,[tenantId]);
      if (state.leaseUntil && new Date(state.leaseUntil).getTime() > Date.now()) throw new Error('RD_BOM_SYNC_ALREADY_RUNNING');
      const mode = requestedMode === 'INCREMENTAL' && !state.activeGeneration ? 'FULL' : requestedMode;
      if (mode === 'INCREMENTAL' && state.lastChangeVersion == null) throw new Error('RD_BOM_SYNC_WATERMARK_MISSING');
      await manager.query(`UPDATE rd_bom_sync_state SET lease_token=$2,lease_until=now()+interval '30 minutes',last_started_at=now(),last_status='RUNNING',last_error_code=NULL,updated_at=now() WHERE tenant_id=$1`,[tenantId,leaseToken]);
      await manager.query(`INSERT INTO rd_bom_sync_runs(id,tenant_id,mode,status,from_change_version) VALUES($1,$2,$3,'RUNNING',$4)`,[runId,tenantId,mode,state.lastChangeVersion]);
      return { mode, activeGeneration: state.activeGeneration, lastChangeVersion: state.lastChangeVersion == null ? null : Number(state.lastChangeVersion) };
    });
  }

  private heartbeat(tenantId: string, token: string) {
    return this.dataSource.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
      const result = await manager.query(`UPDATE rd_bom_sync_state SET lease_until=now()+interval '30 minutes',updated_at=now() WHERE tenant_id=$1 AND lease_token=$2 RETURNING tenant_id`,[tenantId,token]);
      return Array.isArray(result) && result.length > 0;
    });
  }

  private async writeSnapshot(tenantId: string, generationId: string, records: SourceRecord[]) {
    await this.dataSource.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
      if (!records.length) return;
      const data = valueRows(records.map(row => [tenantId,generationId,row.source_bom_id,row.item_id,row.item_code,row.owner_org_id,row.version_times,'Y',row.approve_date,row.create_date,row.modified_date,row.last_modified_date]));
      await manager.query(`INSERT INTO rd_bom_master_heads(tenant_id,generation_id,source_bom_id,item_id,item_code,owner_org_id,version_times,approve_status,approve_date,create_date,modified_date,last_modified_date)
        VALUES ${data.sql} ON CONFLICT(tenant_id,generation_id,source_bom_id) DO UPDATE SET item_id=EXCLUDED.item_id,item_code=EXCLUDED.item_code,owner_org_id=EXCLUDED.owner_org_id,version_times=EXCLUDED.version_times,approve_status='Y',approve_date=EXCLUDED.approve_date,create_date=EXCLUDED.create_date,modified_date=EXCLUDED.modified_date,last_modified_date=EXCLUDED.last_modified_date,synced_at=now()`, data.values);
    });
  }

  private async applyChangesToGeneration(tenantId: string, generationId: string, records: Array<SourceRecord & {operation?:string;change_version?:number}>) {
    await this.dataSource.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
      const active = records.filter(row => row.operation === 'UPSERT' && row.item_id);
      const inactiveIds = records.filter(row => row.operation !== 'UPSERT' || !row.item_id).map(row => row.source_bom_id);
      if (active.length) {
        const data = valueRows(active.map(row => [tenantId,generationId,row.source_bom_id,row.item_id,row.item_code,row.owner_org_id,row.version_times,'Y',row.approve_date,row.create_date,row.modified_date,row.last_modified_date,row.change_version]));
        await manager.query(`INSERT INTO rd_bom_master_heads(tenant_id,generation_id,source_bom_id,item_id,item_code,owner_org_id,version_times,approve_status,approve_date,create_date,modified_date,last_modified_date,source_change_version) VALUES ${data.sql}
          ON CONFLICT(tenant_id,generation_id,source_bom_id) DO UPDATE SET item_id=EXCLUDED.item_id,item_code=EXCLUDED.item_code,owner_org_id=EXCLUDED.owner_org_id,version_times=EXCLUDED.version_times,approve_status='Y',approve_date=EXCLUDED.approve_date,create_date=EXCLUDED.create_date,modified_date=EXCLUDED.modified_date,last_modified_date=EXCLUDED.last_modified_date,source_change_version=EXCLUDED.source_change_version,synced_at=now()`,data.values);
      }
      if (inactiveIds.length) await manager.query(`DELETE FROM rd_bom_master_heads WHERE tenant_id=$1 AND generation_id=$2 AND source_bom_id=ANY($3::uuid[])`,[tenantId,generationId,inactiveIds]);
    });
  }

  private async stageChanges(tenantId: string, runId: string, records: Array<SourceRecord & {operation?:string;change_version?:number}>) {
    await this.dataSource.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
      if (!records.length) return;
      const data = valueRows(records.map(row => [tenantId,runId,row.source_bom_id,row.operation,row.item_id,row.item_code,row.owner_org_id,row.version_times,row.approve_status,row.approve_date,row.create_date,row.modified_date,row.last_modified_date,row.change_version]));
      await manager.query(`INSERT INTO rd_bom_sync_stage(tenant_id,run_id,source_bom_id,operation,item_id,item_code,owner_org_id,version_times,approve_status,approve_date,create_date,modified_date,last_modified_date,source_change_version)
        VALUES ${data.sql} ON CONFLICT(tenant_id,run_id,source_bom_id) DO UPDATE SET operation=EXCLUDED.operation,item_id=EXCLUDED.item_id,item_code=EXCLUDED.item_code,owner_org_id=EXCLUDED.owner_org_id,version_times=EXCLUDED.version_times,approve_status=EXCLUDED.approve_status,approve_date=EXCLUDED.approve_date,create_date=EXCLUDED.create_date,modified_date=EXCLUDED.modified_date,last_modified_date=EXCLUDED.last_modified_date,source_change_version=EXCLUDED.source_change_version`,data.values);
    });
  }

  private async finishFull(tenantId:string,runId:string,token:string,generation:string,toVersion:number,scanned:number,revoked:number,deleted:number) {
    return this.dataSource.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
      const [state]=await manager.query(`SELECT lease_token::text "leaseToken" FROM rd_bom_sync_state WHERE tenant_id=$1 FOR UPDATE`,[tenantId]);
      if (state?.leaseToken!==token) throw new Error('RD_BOM_SYNC_LEASE_LOST');
      const [{ count }] = await manager.query(`SELECT count(*)::bigint count FROM rd_bom_master_heads WHERE tenant_id=$1 AND generation_id=$2`,[tenantId,generation]);
      const inserted = Number(count);
      await manager.query(`UPDATE rd_bom_sync_state SET active_generation=$2,last_change_version=$3,last_success_at=now(),last_status='SUCCESS',last_error_code=NULL,last_error_count=0,last_scanned_count=$4,last_inserted_count=$5,last_updated_count=0,last_revoked_count=$6,last_deleted_count=$7,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1`,[tenantId,generation,toVersion,scanned,inserted,revoked,deleted]);
      await manager.query(`UPDATE rd_bom_sync_runs SET status='SUCCESS',finished_at=now(),to_change_version=$2,scanned_count=$3,inserted_count=$4,updated_count=0,revoked_count=$5,deleted_count=$6,error_count=0 WHERE id=$1 AND tenant_id=$7`,[runId,toVersion,scanned,inserted,revoked,deleted,tenantId]);
      return inserted;
    });
  }

  private async finishIncremental(tenantId:string,runId:string,token:string,generation:string,toVersion:number,scanned:number,revoked:number,deleted:number) {
    return this.dataSource.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
      const [state]=await manager.query(`SELECT lease_token::text "leaseToken",active_generation::text "activeGeneration" FROM rd_bom_sync_state WHERE tenant_id=$1 FOR UPDATE`,[tenantId]);
      if (state?.leaseToken!==token || state.activeGeneration!==String(generation)) throw new Error('RD_BOM_SYNC_LEASE_LOST');
      const [counts]=await manager.query(`SELECT
        count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM rd_bom_master_heads h WHERE h.tenant_id=s.tenant_id AND h.generation_id=$3 AND h.source_bom_id=s.source_bom_id))::bigint inserted,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM rd_bom_master_heads h WHERE h.tenant_id=s.tenant_id AND h.generation_id=$3 AND h.source_bom_id=s.source_bom_id))::bigint updated
        FROM rd_bom_sync_stage s WHERE s.tenant_id=$1 AND s.run_id=$2 AND s.operation='UPSERT' AND s.item_id IS NOT NULL`,[tenantId,runId,generation]);
      const inserted=Number(counts.inserted), updated=Number(counts.updated);
      await manager.query(`DELETE FROM rd_bom_master_heads h USING rd_bom_sync_stage s WHERE s.tenant_id=$1 AND s.run_id=$2 AND h.tenant_id=s.tenant_id AND h.generation_id=$3 AND h.source_bom_id=s.source_bom_id AND s.operation IN ('REVOKE','DELETE')`,[tenantId,runId,generation]);
      await manager.query(`INSERT INTO rd_bom_master_heads(tenant_id,generation_id,source_bom_id,item_id,item_code,owner_org_id,version_times,approve_status,approve_date,create_date,modified_date,last_modified_date,source_change_version)
        SELECT tenant_id,$3,source_bom_id,item_id,item_code,owner_org_id,version_times,'Y',approve_date,create_date,modified_date,last_modified_date,source_change_version FROM rd_bom_sync_stage WHERE tenant_id=$1 AND run_id=$2 AND operation='UPSERT' AND item_id IS NOT NULL
        ON CONFLICT(tenant_id,generation_id,source_bom_id) DO UPDATE SET item_id=EXCLUDED.item_id,item_code=EXCLUDED.item_code,owner_org_id=EXCLUDED.owner_org_id,version_times=EXCLUDED.version_times,approve_status='Y',approve_date=EXCLUDED.approve_date,create_date=EXCLUDED.create_date,modified_date=EXCLUDED.modified_date,last_modified_date=EXCLUDED.last_modified_date,source_change_version=EXCLUDED.source_change_version,synced_at=now()`,[tenantId,runId,generation]);
      await manager.query(`DELETE FROM rd_bom_sync_stage WHERE tenant_id=$1 AND run_id=$2`,[tenantId,runId]);
      await manager.query(`UPDATE rd_bom_sync_state SET last_change_version=$2,last_success_at=now(),last_status='SUCCESS',last_error_code=NULL,last_error_count=0,last_scanned_count=$3,last_inserted_count=$4,last_updated_count=$5,last_revoked_count=$6,last_deleted_count=$7,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1`,[tenantId,toVersion,scanned,inserted,updated,revoked,deleted]);
      await manager.query(`UPDATE rd_bom_sync_runs SET status='SUCCESS',finished_at=now(),to_change_version=$2,scanned_count=$3,inserted_count=$4,updated_count=$5,revoked_count=$6,deleted_count=$7,error_count=0 WHERE id=$1 AND tenant_id=$8`,[runId,toVersion,scanned,inserted,updated,revoked,deleted,tenantId]);
      return { inserted, updated };
    });
  }

  private async fail(tenantId:string,runId:string,token:string,code:string,scanned:number,mode:'FULL'|'INCREMENTAL',generation:string) {
    await this.dataSource.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
      await manager.query(`UPDATE rd_bom_sync_state SET last_status='FAILED',last_error_code=$3,last_error_count=1,last_scanned_count=$4,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE tenant_id=$1 AND lease_token=$2`,[tenantId,token,code,scanned]);
      await manager.query(`UPDATE rd_bom_sync_runs SET status='FAILED',finished_at=now(),scanned_count=$3,error_count=1,error_code=$4 WHERE id=$1 AND tenant_id=$2`,[runId,tenantId,scanned,code]);
      await manager.query(`DELETE FROM rd_bom_sync_stage WHERE tenant_id=$1 AND run_id=$2`,[tenantId,runId]);
      if(mode==='FULL') await manager.query(`DELETE FROM rd_bom_master_heads WHERE tenant_id=$1 AND generation_id=$2`,[tenantId,generation]);
    });
  }
}
