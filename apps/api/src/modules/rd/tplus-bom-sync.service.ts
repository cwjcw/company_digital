import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { DataSource } from 'typeorm';

export const TPLUS_BOM_DATABASES = { 'tplus-kejia': 'UFTData418971_000003', 'tplus-kainan': 'UFTData741219_000012' } as const;
export type TplusBomSource = keyof typeof TPLUS_BOM_DATABASES;
const SOURCES = Object.keys(TPLUS_BOM_DATABASES) as TplusBomSource[];
type SourceHead = { source_bom_id: number; item_id: number | null; item_code: string | null; bom_version: string | null;
  voucher_state: number | null; disabled: boolean; is_default: boolean; source_created_at: string | null; source_modified_at: string | null; source_audited_at: string | null };

/** Application command for the two read-only source mirrors. No notifications. */
@Injectable()
export class TplusBomSyncService {
  constructor(private readonly db: DataSource) {}

  async reconcile(tenant: string, source: TplusBomSource) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(tenant) || !SOURCES.includes(source)) throw Error('TPLUS_BOM_SCOPE_INVALID');
    const r = this.db.createQueryRunner(); await r.connect();
    let locked = false, run: { id: string; generation: string } | undefined;
    let child: ReturnType<typeof spawn> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await r.query("SELECT set_config('app.tenant_id',$1,false)", [tenant]);
      const [lock] = await r.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked', [`tplus-bom:${tenant}:${source}`]);
      locked = lock.locked;
      if (!locked) throw Error('TPLUS_BOM_ALREADY_RUNNING');
      await r.startTransaction();
      try {
        // A crashed process releases the session lock; retain its unfinished run as failed audit.
        await r.query("UPDATE rd_tplus_bom_sync_runs SET status='FAILED',finished_at=now(),error_code='TPLUS_BOM_INTERRUPTED' WHERE tenant_id=$1 AND source=$2 AND status='RUNNING'", [tenant,source]);
        await r.query(`INSERT INTO rd_tplus_bom_sync_state(tenant_id,source,source_database) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [tenant,source,TPLUS_BOM_DATABASES[source]]);
        [run] = await r.query(`INSERT INTO rd_tplus_bom_sync_runs(tenant_id,source,generation_id,status) VALUES($1,$2,uuidv7(),'RUNNING') RETURNING id::text,generation_id::text generation`, [tenant,source]);
        await r.query("UPDATE rd_tplus_bom_sync_state SET last_status='RUNNING',last_started_at=now(),last_error_code=NULL WHERE tenant_id=$1 AND source=$2", [tenant,source]);
        await r.commitTransaction();
      } catch (e) { await r.rollbackTransaction(); throw e; }
      const script = process.env.RD_TPLUS_BOM_READER ?? path.resolve(process.cwd(),'../../data-operations/tplus/bom-index-reader.py');
      child = spawn(process.env.RD_E10_PYTHON ?? '/data/automation/code/work/basci/basic_code/.venv/bin/python', [script], {
        env: { ...process.env, PYTHONPATH: process.env.RD_BASIC_CODE_ROOT ?? '/data/automation/code/work/basci/basic_code' }, stdio: ['pipe','pipe','pipe']
      });
      const proc = child;
      const exited = new Promise<number | null>(resolve => { proc.once('error',()=>resolve(-1)); proc.once('close',resolve); });
      timer = setTimeout(()=>proc.kill('SIGTERM'), 600_000);
      proc.stderr!.resume(); proc.stdin!.on('error',()=>undefined);
      proc.stdin!.end(JSON.stringify({ source, pageSize: 500 }));
      let begin = false, end = false, scanned = 0, valid = 0, lastId = 0;
      let evidence: any;
      for await (const line of createInterface({ input: proc.stdout!, crlfDelay: Infinity })) {
        if (!line.trim()) continue;
        if (line.length > 2_000_000 || end) throw Error('TPLUS_BOM_PROTOCOL_INVALID');
        const e = JSON.parse(line);
        if (e.type === 'begin' && !begin && e.source === source && e.database === TPLUS_BOM_DATABASES[source]) { begin = true; evidence = e.evidence; }
        else if (e.type === 'page' && begin && Array.isArray(e.records) && e.records.length <= 1000) {
          const records = e.records as SourceHead[];
          for (const h of records) {
            if (!Number.isSafeInteger(h.source_bom_id) || h.source_bom_id <= lastId || typeof h.disabled !== 'boolean' || typeof h.is_default !== 'boolean') throw Error('TPLUS_BOM_PROTOCOL_INVALID');
            lastId = h.source_bom_id;
            if (h.voucher_state === 189 && !h.disabled) valid++;
          }
          if (scanned + records.length > 200000) throw Error('TPLUS_BOM_LIMIT_EXCEEDED');
          if (records.length) {
            // Typed recordset avoids SQL interpolation and PostgreSQL parameter-count limits.
            await r.query(`INSERT INTO rd_tplus_bom_heads(tenant_id,source,source_database,generation_id,source_bom_id,item_id,item_code,bom_version,voucher_state,disabled,is_default,source_created_at,source_modified_at,source_audited_at)
              SELECT $1,$2,$3,$4::uuid,h.* FROM jsonb_to_recordset($5::jsonb) AS h(source_bom_id integer,item_id integer,item_code text,bom_version text,voucher_state integer,disabled boolean,is_default boolean,source_created_at timestamp,source_modified_at timestamp,source_audited_at timestamp)`,
              [tenant,source,TPLUS_BOM_DATABASES[source],run!.generation,JSON.stringify(records)]);
          }
          scanned += records.length;
        } else if (e.type === 'end' && begin && e.source === source && e.scanned === scanned && e.valid === valid && JSON.stringify(e.evidence) === JSON.stringify(evidence)) end = true;
        else throw Error('TPLUS_BOM_PROTOCOL_INVALID');
      }
      if (await exited !== 0 || !begin || !end) throw Error('TPLUS_BOM_INCOMPLETE');
      await r.startTransaction();
      try {
        const [counts] = await r.query(`SELECT count(*)::int total,count(*) FILTER(WHERE voucher_state=189 AND NOT disabled)::int valid FROM rd_tplus_bom_heads WHERE tenant_id=$1 AND source=$2 AND generation_id=$3`, [tenant,source,run!.generation]);
        if (counts.total !== scanned || counts.valid !== valid || Number(evidence.total) !== scanned || Number(evidence.valid ?? 0) !== valid) throw Error('TPLUS_BOM_COUNT_MISMATCH');
        await r.query(`UPDATE rd_tplus_bom_sync_state SET active_generation=$3,last_status='SUCCESS',last_success_at=now(),last_error_code=NULL,scanned_count=$4,valid_count=$5 WHERE tenant_id=$1 AND source=$2`, [tenant,source,run!.generation,scanned,valid]);
        await r.query("UPDATE rd_tplus_bom_sync_runs SET status='SUCCESS',finished_at=now(),scanned_count=$3,valid_count=$4,source_evidence=$5::jsonb WHERE id=$1 AND tenant_id=$2", [run!.id,tenant,scanned,valid,JSON.stringify(evidence)]);
        await r.commitTransaction();
      } catch (e) { await r.rollbackTransaction(); throw e; }
      return { source, status: 'SUCCESS', runId: run!.id, activeGeneration: run!.generation, scanned, valid, sourceVerified: true };
    } catch (e) {
      child?.kill('SIGTERM');
      if (run) {
        await r.startTransaction();
        try {
          await r.query("UPDATE rd_tplus_bom_sync_state SET last_status='FAILED',last_error_code='TPLUS_BOM_RECONCILIATION_FAILED' WHERE tenant_id=$1 AND source=$2", [tenant,source]);
          await r.query("UPDATE rd_tplus_bom_sync_runs SET status='FAILED',finished_at=now(),error_code='TPLUS_BOM_RECONCILIATION_FAILED' WHERE id=$1 AND tenant_id=$2", [run.id,tenant]);
          await r.commitTransaction();
        } catch { await r.rollbackTransaction(); }
      }
      throw Error(e instanceof Error && e.message.startsWith('TPLUS_BOM_') ? e.message : 'TPLUS_BOM_RECONCILIATION_FAILED');
    } finally {
      if (timer) clearTimeout(timer);
      try { if (locked) await r.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`tplus-bom:${tenant}:${source}`]); }
      finally { await r.query('RESET app.tenant_id').catch(()=>undefined); await r.release(); }
    }
  }

  async activate(tenant: string) {
    return this.db.transaction(async m => {
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      const states = await m.query("SELECT source,active_generation,last_status,scanned_count,valid_count FROM rd_tplus_bom_sync_state WHERE tenant_id=$1 ORDER BY source FOR UPDATE",[tenant]);
      if (states.length !== 2 || states.some((s: any)=>!SOURCES.includes(s.source) || !s.active_generation || s.last_status!=='SUCCESS' || s.scanned_count <= 0)) throw Error('TPLUS_BOM_ACTIVATION_NOT_READY');
      for (const s of states) {
        const [count] = await m.query('SELECT count(*)::int total,count(*) FILTER(WHERE voucher_state=189 AND NOT disabled)::int valid FROM rd_tplus_bom_heads WHERE tenant_id=$1 AND source=$2 AND generation_id=$3',[tenant,s.source,s.active_generation]);
        if (count.total!==s.scanned_count || count.valid!==s.valid_count) throw Error('TPLUS_BOM_COUNT_MISMATCH');
        await m.query("INSERT INTO rd_tplus_bom_sync_runs(tenant_id,source,generation_id,status,finished_at) VALUES($1,$2,$3,'ACTIVATED',now())",[tenant,s.source,s.active_generation]);
      }
      await m.query('UPDATE rd_tplus_bom_sync_state SET report_enabled=true WHERE tenant_id=$1',[tenant]);
      return { status:'SUCCESS', mode:'ACTIVATE', sources:states.map((s:any)=>({source:s.source,activeGeneration:s.active_generation,valid:s.valid_count})) };
    });
  }
}
