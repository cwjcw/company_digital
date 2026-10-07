import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, type QueryRunner } from 'typeorm';
import { PmcRdProgressReader } from '../../integrations/e10/pmc-rd-progress.reader';
import { PmcRdProgressCalculator } from './pmc-rd-progress.calculator';
import { progressColumns, progressDataTypes } from './pmc-rd-progress.columns';
import { isAdmin, resourceCode, sourceInstant, type ProgressActor, type ProgressItem, type Watermark } from './pmc-rd-progress.types';

export function contentHash(row: ProgressItem) { return createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b]) => a.localeCompare(b))))).digest('hex'); }
@Injectable()
export class PmcRdProgressApplicationService {
  constructor(private readonly dataSource: DataSource, private readonly reader: PmcRdProgressReader, private readonly calculator: PmcRdProgressCalculator) {}
  private async begin(runner: QueryRunner, tenantId: string) { await runner.startTransaction(); await runner.query(`SELECT set_config('app.tenant_id',$1,true)`,[tenantId]); }
  async sync(mode: 'FULL' | 'INCREMENTAL', actor: ProgressActor) {
    if (!isAdmin(actor)) throw new ForbiddenException('只有内部同步主体或PMC管理员可以执行研发进度同步');
    const runner = this.dataSource.createQueryRunner(); await runner.connect(); let locked = false, runId: string | null = null, rowsRead = 0; let sourceSnapshotAt: string | null = null;
    try {
      const [lock] = await runner.query(`SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked`,[`pmc-rd-progress:${actor.tenantId}`]);
      if (!lock?.locked) throw new ConflictException('当前租户的研发进度同步正在运行'); locked = true;
      await this.begin(runner,actor.tenantId);
      // A session lock proves no earlier worker is alive. Recover a crashed RUNNING run.
      await runner.query(`UPDATE pmc_rd_progress_sync_runs SET status='FAILED',completed_at=now(),error_message='同步进程中断，水位未推进' WHERE tenant_id=$1 AND status='RUNNING'`,[actor.tenantId]);
      const [previous] = await runner.query(`SELECT watermark_after FROM pmc_rd_progress_sync_runs WHERE tenant_id=$1 AND status='SUCCESS' ORDER BY completed_at DESC,id DESC LIMIT 1`,[actor.tenantId]);
      const before = (previous?.watermark_after ?? null) as Watermark | null;
      const [{id}] = await runner.query(`INSERT INTO pmc_rd_progress_sync_runs(tenant_id,mode,watermark_before,actor_id) VALUES($1,$2,$3::jsonb,$4::uuid) RETURNING id`,[actor.tenantId,mode,JSON.stringify(before),actor.userId]); runId=id;
      const mappingsChanged: Array<{customer_code: string}> = before ? await runner.query(`SELECT customer_code FROM mps_customer_division_mappings WHERE tenant_id=$1 AND updated_at >= $2::timestamptz-interval '2 minutes'`,[actor.tenantId,sourceInstant(before.snapshotAt)]) : [];
      await runner.commitTransaction();
      const bundle = await this.reader.read(mode,before,mappingsChanged.map(row => row.customer_code));
      rowsRead = bundle.orders.length; sourceSnapshotAt = bundle.sourceSnapshotAt;
      const candidates = new Set(bundle.candidateLineIds);
      if (candidates.size !== bundle.candidateLineIds.length) throw new Error('候选订单行存在重复来源主键');
      const rows = this.calculator.calculate(bundle);
      if (rows.length !== rowsRead || rows.some(row => !row.sourceOrderLineId || !row.sourceOrderId || !candidates.has(row.sourceOrderLineId))) throw new Error('研发进度来源事实契约不完整');
      await this.begin(runner,actor.tenantId);
      const mappings: Array<{customerCode: string;divisionId: string|null;divisionName: string|null}> = await runner.query(`SELECT map.customer_code AS "customerCode",map.primary_division_id AS "divisionId",org.name AS "divisionName" FROM mps_customer_division_mappings map LEFT JOIN organization_units org ON org.id=map.primary_division_id WHERE map.tenant_id=$1 AND map.enabled=true`,[actor.tenantId]);
      const byCustomer = new Map(mappings.map(map => [map.customerCode,map]));
      for (const row of rows) { const map=byCustomer.get(String(row.customerCode ?? '')); row.divisionId=map?.divisionId ?? null; row.divisionName=map?.divisionName ?? null; row.divisionSource=map?.divisionId ? 'CUSTOMER_OWNER' : null; }
      let created=0,updated=0;
      for (let offset=0;offset<rows.length;offset+=250) {
        const chunk=rows.slice(offset,offset+250); const result=await this.upsert(runner,chunk,actor,bundle.sourceSnapshotAt);
        created+=result.created; updated+=result.updated;
      }
      const [deactivation] = await runner.query(`WITH before AS MATERIALIZED (SELECT * FROM pmc_rd_progress_items WHERE tenant_id=$1 AND is_active AND NOT(source_order_line_id=ANY($2::uuid[]))), changed AS (UPDATE pmc_rd_progress_items p SET is_active=false,source_deleted_at=now(),updated_at=now(),updated_by=$3::uuid,version=p.version+1 FROM before b WHERE p.tenant_id=$1 AND p.id=b.id RETURNING p.id), audit AS (INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by) SELECT $1,$3::uuid,$4,$5,b.id,'pmc.rd_progress.deactivated',to_jsonb(b),jsonb_build_object('isActive',false),$6,'api',$3::uuid,$3::uuid FROM before b JOIN changed c ON c.id=b.id) SELECT count(*)::int count FROM changed`,[actor.tenantId,bundle.candidateLineIds,actor.userId,actor.username,resourceCode,actor.requestId]);
      const result={runId,mode,status:'SUCCESS',sourceSnapshotAt:bundle.sourceSnapshotAt,sourceConsistency:bundle.consistency,rowsRead,rowsCreated:created,rowsUpdated:updated,rowsUnchanged:rowsRead-created-updated,rowsFailed:0,rowsDeactivated:Number(deactivation.count),affectedItemCount:bundle.affectedItemIds.length,affectedOrderCount:bundle.affectedOrderIds.length,watermark:bundle.watermark};
      await runner.query(`UPDATE pmc_rd_progress_sync_runs SET status='SUCCESS',completed_at=now(),source_snapshot_at=$3::timestamp,source_consistency=$4,rows_read=$5,rows_created=$6,rows_updated=$7,rows_unchanged=$8,rows_deactivated=$9,affected_item_count=$10,affected_order_count=$11,watermark_after=$12::jsonb WHERE tenant_id=$1 AND id=$2`,[actor.tenantId,runId,result.sourceSnapshotAt,result.sourceConsistency,rowsRead,created,updated,result.rowsUnchanged,result.rowsDeactivated,result.affectedItemCount,result.affectedOrderCount,JSON.stringify(bundle.watermark)]);
      await runner.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,after_json,request_id,source,created_by,updated_by) VALUES($1,$2::uuid,$3,$4,$5::uuid,'pmc.rd_progress.sync_succeeded',$6::jsonb,$7,'api',$2::uuid,$2::uuid)`,[actor.tenantId,actor.userId,actor.username,resourceCode,runId,JSON.stringify(result),actor.requestId]);
      await runner.commitTransaction(); return result;
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      if (runId) {
        await this.begin(runner,actor.tenantId);
        await runner.query(`UPDATE pmc_rd_progress_sync_runs SET status='FAILED',completed_at=now(),rows_read=$3,rows_failed=$4,error_message=$5,source_snapshot_at=$6::timestamp WHERE tenant_id=$1 AND id=$2`,[actor.tenantId,runId,rowsRead,rowsRead,error instanceof Error ? error.message.slice(0,1000) : '同步失败',sourceSnapshotAt]);
        await runner.commitTransaction();
      }
      throw error;
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      if (locked) await runner.query(`SELECT pg_advisory_unlock(hashtextextended($1,0))`,[`pmc-rd-progress:${actor.tenantId}`]);
      await runner.release();
    }
  }
  private async upsert(runner: QueryRunner, rows: ProgressItem[], actor: ProgressActor, snapshotAt: string) {
    const keys=Object.keys(progressDataTypes), columns=keys.map(key => progressColumns[key]!);
    const input=rows.map(row => ({...Object.fromEntries(keys.map(key => [progressColumns[key],row[key] ?? null])),content_hash:contentHash(row)}));
    const definitions=keys.map(key => `${progressColumns[key]} ${progressDataTypes[key]}`).join(',');
    const update=columns.filter(c => !['source_order_id','source_order_line_id'].includes(c)).map(c => `${c}=excluded.${c}`).join(',');
    const [result]=await runner.query(`WITH incoming AS MATERIALIZED (SELECT * FROM jsonb_to_recordset($1::jsonb) AS row(${definitions},content_hash text)), before AS MATERIALIZED (SELECT p.* FROM pmc_rd_progress_items p JOIN incoming i USING(source_order_line_id) WHERE p.tenant_id=$2), saved AS (INSERT INTO pmc_rd_progress_items(tenant_id,${columns.join(',')},content_hash,source_snapshot_at,created_by,updated_by) SELECT $2,${columns.map(c=>'i.'+c).join(',')},i.content_hash,$3::timestamp,$4::uuid,$4::uuid FROM incoming i ON CONFLICT(tenant_id,source_order_line_id) DO UPDATE SET ${update},source_order_id=excluded.source_order_id,content_hash=excluded.content_hash,source_snapshot_at=excluded.source_snapshot_at,synced_at=now(),updated_at=now(),updated_by=excluded.updated_by,is_active=true,source_deleted_at=NULL,version=pmc_rd_progress_items.version+1 WHERE pmc_rd_progress_items.content_hash IS DISTINCT FROM excluded.content_hash OR NOT pmc_rd_progress_items.is_active RETURNING *, (xmax=0) AS inserted), audit AS (INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by) SELECT $2,$4::uuid,$5,$6,s.id,CASE WHEN s.inserted THEN 'pmc.rd_progress.created' ELSE 'pmc.rd_progress.updated' END,to_jsonb(b),to_jsonb(s)-'inserted',$7,'api',$4::uuid,$4::uuid FROM saved s LEFT JOIN before b ON b.source_order_line_id=s.source_order_line_id) SELECT count(*) FILTER(WHERE inserted)::int created,count(*) FILTER(WHERE NOT inserted)::int updated FROM saved`,[JSON.stringify(input),actor.tenantId,snapshotAt,actor.userId,actor.username,resourceCode,actor.requestId]);
    return result as {created:number;updated:number};
  }
}
