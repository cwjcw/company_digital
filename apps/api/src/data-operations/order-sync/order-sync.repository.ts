import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import type { CommitSyncBatch, StartSyncRun, SyncActor } from "./order-sync.types";

const tenant = () => process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN";

@Injectable()
export class OrderSyncRepository {
  constructor(private readonly dataSource: DataSource) {}

  private async scope(manager: EntityManager) {
    await manager.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenant()]);
  }

  async state(sourceKey?: string) {
    return this.dataSource.transaction(async (manager) => {
      await this.scope(manager);
      const values: unknown[] = [tenant()];
      const filter = sourceKey ? ` AND s.source_key=$2` : "";
      if (sourceKey) values.push(sourceKey);
      const sources = await manager.query(`SELECT s.* FROM erp_sync_sources s WHERE s.tenant_id=$1${filter} ORDER BY s.source_key`, values);
      for (const source of sources) source.cursors = await manager.query(`SELECT * FROM erp_sync_cursors WHERE tenant_id=$1 AND source_id=$2 ORDER BY phase,stream`, [tenant(), source.id]);
      return sourceKey ? sources[0] ?? null : sources;
    });
  }

  async startRun(input: StartSyncRun, actor: SyncActor) {
    return this.dataSource.transaction(async (manager) => {
      await this.scope(manager);
      const mapping = JSON.stringify(input.fieldMapping);
      const [source] = await manager.query(`INSERT INTO erp_sync_sources
        (tenant_id,source_key,source_system,source_database,source_account_name,field_mapping,status,source_snapshot_at,initialization_started_at,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,CASE WHEN $7='INITIALIZATION' THEN 'INITIALIZING' ELSE 'COMPENSATING' END,$8,CASE WHEN $7='INITIALIZATION' THEN now() ELSE NULL END,$9,$10)
        ON CONFLICT(tenant_id,source_key) DO UPDATE SET source_system=EXCLUDED.source_system,source_database=EXCLUDED.source_database,
          source_account_name=EXCLUDED.source_account_name,field_mapping=EXCLUDED.field_mapping,
          status=CASE WHEN $7='INITIALIZATION' THEN 'INITIALIZING' ELSE erp_sync_sources.status END,
          source_snapshot_at=COALESCE(erp_sync_sources.source_snapshot_at,EXCLUDED.source_snapshot_at),updated_by=$10,updated_at=now(),version=erp_sync_sources.version+1
        RETURNING *`, [tenant(), input.sourceKey, input.sourceSystem, input.sourceDatabase, input.sourceAccountName, mapping, input.runType, input.sourceSnapshotAt ?? null, actor.userId, actor.displayName]);
      const running = await manager.query(`SELECT * FROM erp_sync_runs WHERE tenant_id=$1 AND source_id=$2 AND run_type=$3 AND status='RUNNING' ORDER BY started_at DESC LIMIT 1`, [tenant(), source.id, input.runType]);
      if (running[0]) {
        const batches = await manager.query(`SELECT stream,MAX(batch_number)::integer last_batch FROM erp_sync_batches WHERE tenant_id=$1 AND run_id=$2 AND status='COMMITTED' GROUP BY stream`, [tenant(), running[0].id]);
        return { source, run: running[0], resumed: true, lastBatchByStream: Object.fromEntries(batches.map((row: any) => [row.stream, row.last_batch])) };
      }
      const effectiveSnapshot = input.runType === "INITIALIZATION" ? source.source_snapshot_at : input.sourceSnapshotAt ?? null;
      const [run] = await manager.query(`INSERT INTO erp_sync_runs(tenant_id,source_id,run_type,source_snapshot_at,scan_upper_bound,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [tenant(), source.id, input.runType, effectiveSnapshot, input.scanUpperBound ?? null, actor.userId, actor.displayName]);
      return { source, run, resumed: false, lastBatchByStream: {} };
    });
  }

  async commitBatch(input: CommitSyncBatch, actor: SyncActor) {
    return this.dataSource.transaction(async (manager) => {
      await this.scope(manager);
      const prior = await manager.query(`SELECT * FROM erp_sync_batches WHERE tenant_id=$1 AND idempotency_key=$2`, [tenant(), input.idempotencyKey]);
      if (prior[0]) return { ...prior[0], repeated: true };
      const sourceRows = await manager.query(`SELECT * FROM erp_sync_sources WHERE tenant_id=$1 AND source_key=$2 FOR UPDATE`, [tenant(), input.sourceKey]);
      const source = sourceRows[0];
      if (!source) throw new Error(`未知同步来源 ${input.sourceKey}`);
      const runRows = await manager.query(`SELECT * FROM erp_sync_runs WHERE tenant_id=$1 AND id=$2 AND source_id=$3 AND status='RUNNING' FOR UPDATE`, [tenant(), input.runId, source.id]);
      if (!runRows[0]) throw new Error("同步运行不存在或已经结束");
      const unique = new Map<string, (typeof input.records)[number]>();
      for (const row of input.records) unique.set(`${row.sourceSystem}\u0000${row.sourceDatabase}\u0000${row.sourceTable}\u0000${row.sourceId}`, row);
      const trueDuplicateCount = input.records.length - unique.size;
      const rows = [...unique.values()].map((row) => ({ ...row, tenantId: tenant(), actorId: actor.userId, actorName: actor.displayName }));
      let inserted = 0; let updated = 0;
      if (rows.length) {
        const result = await manager.query(`WITH payload AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
            "tenantId" varchar,"sourceSystem" varchar,"sourceDatabase" varchar,"sourceTable" varchar,"sourceId" varchar,"recordType" varchar,
            "sourceOrderId" varchar,"sourceOrderLineId" varchar,"orderNumber" varchar,"businessDate" date,"modifiedAt" timestamptz,
            "customerCode" varchar,"customerName" varchar,"itemCode" varchar,"itemName" varchar,"quantity" numeric,
            "deliveredQuantity" numeric,"outstandingQuantity" numeric,"deliveryDate" date,"statusCode" varchar,"statusLabel" varchar,
            "isCancelled" boolean,"isClosed" boolean,"isCompleted" boolean,"orderLinkStable" boolean,"linkRule" varchar,
            "rawPayload" jsonb,"contentHash" varchar,"actorId" uuid,"actorName" varchar)
        ) INSERT INTO erp_staging_raw_records(
          tenant_id,source_system,source_database,source_table,source_id,record_type,source_order_id,source_order_line_id,order_number,
          business_date,modified_at,customer_code,customer_name,item_code,item_name,quantity,delivered_quantity,outstanding_quantity,
          delivery_date,status_code,status_label,is_cancelled,is_closed,is_completed,order_link_stable,link_rule,raw_payload,content_hash,created_by,updated_by)
        SELECT "tenantId","sourceSystem","sourceDatabase","sourceTable","sourceId","recordType","sourceOrderId","sourceOrderLineId","orderNumber",
          "businessDate","modifiedAt","customerCode","customerName","itemCode","itemName","quantity","deliveredQuantity","outstandingQuantity",
          "deliveryDate","statusCode","statusLabel","isCancelled","isClosed","isCompleted","orderLinkStable","linkRule","rawPayload","contentHash","actorId","actorName" FROM payload
        ON CONFLICT(tenant_id,source_system,source_database,source_table,source_id) DO UPDATE SET
          record_type=EXCLUDED.record_type,source_order_id=EXCLUDED.source_order_id,source_order_line_id=EXCLUDED.source_order_line_id,
          order_number=EXCLUDED.order_number,business_date=EXCLUDED.business_date,modified_at=EXCLUDED.modified_at,
          customer_code=EXCLUDED.customer_code,customer_name=EXCLUDED.customer_name,item_code=EXCLUDED.item_code,item_name=EXCLUDED.item_name,
          quantity=EXCLUDED.quantity,delivered_quantity=EXCLUDED.delivered_quantity,outstanding_quantity=EXCLUDED.outstanding_quantity,
          delivery_date=EXCLUDED.delivery_date,status_code=EXCLUDED.status_code,status_label=EXCLUDED.status_label,is_cancelled=EXCLUDED.is_cancelled,
          is_closed=EXCLUDED.is_closed,is_completed=EXCLUDED.is_completed,order_link_stable=EXCLUDED.order_link_stable,link_rule=EXCLUDED.link_rule,
          raw_payload=EXCLUDED.raw_payload,content_hash=EXCLUDED.content_hash,source_active=true,
          version=CASE WHEN erp_staging_raw_records.content_hash<>EXCLUDED.content_hash THEN erp_staging_raw_records.version+1 ELSE erp_staging_raw_records.version END,
          updated_by=EXCLUDED.updated_by,updated_at=CASE WHEN erp_staging_raw_records.content_hash<>EXCLUDED.content_hash THEN now() ELSE erp_staging_raw_records.updated_at END
        RETURNING (xmax=0) AS inserted`, [JSON.stringify(rows)]);
        inserted = result.filter((row: any) => row.inserted).length; updated = result.length - inserted;
      }
      const overlap = rows.filter((row) => row.overlapReplay).length;
      const [batch] = await manager.query(`INSERT INTO erp_sync_batches(tenant_id,run_id,source_id,stream,source_table,batch_number,idempotency_key,status,
        read_count,inserted_count,updated_count,overlap_replay_count,true_duplicate_count,duration_ms,cursor_before,cursor_after,scan_upper_bound,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,'COMMITTED',$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18) RETURNING *`,
        [tenant(), input.runId, source.id, input.stream, input.sourceTable, input.batchNumber, input.idempotencyKey, input.records.length, inserted, updated,
          overlap, trueDuplicateCount, input.durationMs, JSON.stringify(input.cursorBefore ?? null), JSON.stringify(input.cursorAfter ?? null), input.scanUpperBound ?? null, actor.userId, actor.displayName]);
      const after = input.cursorAfter ?? {};
      await manager.query(`INSERT INTO erp_sync_cursors(tenant_id,source_id,phase,stream,source_table,
        initialization_business_date,initialization_source_pk,last_processed_modified_at,last_processed_source_pk,
        last_successful_scan_upper_bound,active_run_id,active_page_modified_at,active_page_source_pk,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $10=false THEN $11::timestamptz ELSE NULL::timestamptz END,$12,$8,$9,$13,$14)
        ON CONFLICT(tenant_id,source_id,phase,stream) DO UPDATE SET source_table=EXCLUDED.source_table,
          initialization_business_date=COALESCE(EXCLUDED.initialization_business_date,erp_sync_cursors.initialization_business_date),
          initialization_source_pk=COALESCE(EXCLUDED.initialization_source_pk,erp_sync_cursors.initialization_source_pk),
          last_processed_modified_at=COALESCE(EXCLUDED.last_processed_modified_at,erp_sync_cursors.last_processed_modified_at),
          last_processed_source_pk=COALESCE(EXCLUDED.last_processed_source_pk,erp_sync_cursors.last_processed_source_pk),
          last_successful_scan_upper_bound=COALESCE(EXCLUDED.last_successful_scan_upper_bound,erp_sync_cursors.last_successful_scan_upper_bound),
          active_run_id=EXCLUDED.active_run_id,active_page_modified_at=EXCLUDED.active_page_modified_at,active_page_source_pk=EXCLUDED.active_page_source_pk,
          updated_by=EXCLUDED.updated_by,updated_at=now(),version=erp_sync_cursors.version+1`,
        [tenant(), source.id, input.phase, input.stream, input.sourceTable,
          input.phase === "INITIALIZATION" ? after.businessDate ?? null : null,
          input.phase === "INITIALIZATION" ? after.sourcePk ?? null : null,
          input.phase === "INCREMENTAL" ? after.modifiedAt ?? null : null,
          input.phase === "INCREMENTAL" ? after.sourcePk ?? null : null,
          input.batchFull, input.scanUpperBound ?? null, input.runId, actor.userId, actor.displayName]);
      return { ...batch, repeated: false };
    });
  }

  async completeRun(runId: string, sourceKey: string, metrics: unknown, actor: SyncActor) {
    return this.dataSource.transaction(async (manager) => {
      await this.scope(manager);
      const sourceRows = await manager.query(`SELECT * FROM erp_sync_sources WHERE tenant_id=$1 AND source_key=$2 FOR UPDATE`, [tenant(), sourceKey]);
      if (!sourceRows[0]) throw new Error("同步来源不存在");
      const runRows = await manager.query(`SELECT * FROM erp_sync_runs
        WHERE tenant_id=$1 AND id=$2 AND source_id=$3 AND status='RUNNING' FOR UPDATE`, [tenant(), runId, sourceRows[0].id]);
      const run = runRows[0];
      if (!run) throw new Error("同步运行不存在或已经完成");
      const runType = run.run_type;
      if (!["INITIALIZATION","COMPENSATION","INCREMENTAL"].includes(runType)) throw new Error("同步运行类型无效");
      await manager.query(`UPDATE erp_sync_runs SET status='COMPLETED',completed_at=now(),metrics=$4::jsonb,updated_by=$5,updated_at=now(),version=version+1
        WHERE tenant_id=$1 AND id=$2 AND source_id=$3`, [tenant(), runId, sourceRows[0].id, JSON.stringify(metrics ?? {}), actor.displayName]);
      const status = runType === "INITIALIZATION" ? "COMPENSATING" : "ACTIVE";
      await manager.query(`UPDATE erp_sync_sources SET status=$3,initialization_completed_at=CASE WHEN $4 IN ('COMPENSATION','INCREMENTAL') AND initialization_completed_at IS NULL THEN now() ELSE initialization_completed_at END,
        incremental_enabled=CASE WHEN $4 IN ('COMPENSATION','INCREMENTAL') THEN true ELSE incremental_enabled END,last_sync_at=now(),updated_by=$5,updated_at=now(),version=version+1
        WHERE tenant_id=$1 AND id=$2`, [tenant(), sourceRows[0].id, status, runType, actor.displayName]);
      await manager.query(`UPDATE erp_sync_cursors SET active_run_id=NULL,active_page_modified_at=NULL,active_page_source_pk=NULL,updated_by=$3,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND source_id=$2`, [tenant(), sourceRows[0].id, actor.displayName]);
      await manager.query(`UPDATE erp_sync_cursors c SET
        last_processed_modified_at=(SELECT NULLIF(b.cursor_after->>'modifiedAt','')::timestamptz FROM erp_sync_batches b
          WHERE b.tenant_id=c.tenant_id AND b.source_id=c.source_id AND b.stream=c.stream AND b.status='COMMITTED' AND b.read_count>0
          AND b.cursor_after->>'modifiedAt' IS NOT NULL ORDER BY b.created_at DESC,b.batch_number DESC LIMIT 1),
        last_processed_source_pk=(SELECT NULLIF(b.cursor_after->>'sourcePk','') FROM erp_sync_batches b
          WHERE b.tenant_id=c.tenant_id AND b.source_id=c.source_id AND b.stream=c.stream AND b.status='COMMITTED' AND b.read_count>0
          AND b.cursor_after->>'modifiedAt' IS NOT NULL ORDER BY b.created_at DESC,b.batch_number DESC LIMIT 1),
        updated_by=$3,updated_at=now(),version=version+1
        WHERE c.tenant_id=$1 AND c.source_id=$2 AND c.phase='INCREMENTAL'`, [tenant(), sourceRows[0].id, actor.displayName]);
      return run;
    });
  }

  async failRun(runId: string, sourceKey: string, errorMessage: string, retryCount: number, actor: SyncActor) {
    return this.dataSource.transaction(async (manager) => {
      await this.scope(manager);
      const [source] = await manager.query(`SELECT * FROM erp_sync_sources WHERE tenant_id=$1 AND source_key=$2 FOR UPDATE`, [tenant(),sourceKey]);
      if (!source) throw new Error("同步来源不存在");
      const runRows = await manager.query(`SELECT * FROM erp_sync_runs
        WHERE tenant_id=$1 AND id=$2 AND source_id=$3 AND status='RUNNING' FOR UPDATE`, [tenant(), runId, source.id]);
      const run = runRows[0];
      if (run) {
        await manager.query(`UPDATE erp_sync_runs SET status='FAILED',completed_at=now(),error_message=$4,retry_count=$5,updated_by=$6,updated_at=now(),version=version+1
          WHERE tenant_id=$1 AND id=$2 AND source_id=$3`,[tenant(),runId,source.id,errorMessage.slice(0,2000),retryCount,actor.displayName]);
        await manager.query(`UPDATE erp_sync_sources SET status='FAILED',updated_by=$3,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2`,[tenant(),source.id,actor.displayName]);
      }
      return run ?? null;
    });
  }

  async report() {
    return this.dataSource.transaction(async manager=>{ await this.scope(manager);
      const sources=await manager.query(`SELECT source_key "sourceKey",source_system "sourceSystem",source_database "sourceDatabase",source_account_name "sourceAccountName",
        status,source_snapshot_at "sourceSnapshotAt",initialization_started_at "initializationStartedAt",initialization_completed_at "initializationCompletedAt",
        incremental_enabled "incrementalEnabled",last_sync_at "lastSyncAt" FROM erp_sync_sources WHERE tenant_id=$1 ORDER BY source_key`,[tenant()]);
      const runs=await manager.query(`SELECT s.source_key "sourceKey",r.id,r.run_type "runType",r.status,r.source_snapshot_at "sourceSnapshotAt",r.scan_upper_bound "scanUpperBound",
        r.started_at "startedAt",r.completed_at "completedAt",r.metrics,r.error_message "errorMessage",r.retry_count "retryCount"
        FROM erp_sync_runs r JOIN erp_sync_sources s ON s.id=r.source_id WHERE r.tenant_id=$1 ORDER BY r.started_at`,[tenant()]);
      const batches=await manager.query(`SELECT s.source_key "sourceKey",r.run_type "runType",b.stream,b.source_table "sourceTable",count(*)::integer "batchCount",
        sum(b.read_count)::integer "recordCount",sum(b.inserted_count)::integer "insertedCount",sum(b.updated_count)::integer "updatedCount",
        sum(b.overlap_replay_count)::integer "overlapReplayCount",sum(b.true_duplicate_count)::integer "trueDuplicateCount",
        round(avg(b.duration_ms),3)::text "averageDurationMs",max(b.duration_ms)::text "maxDurationMs",sum(b.retry_count)::integer "retryCount"
        FROM erp_sync_batches b JOIN erp_sync_sources s ON s.id=b.source_id JOIN erp_sync_runs r ON r.id=b.run_id WHERE b.tenant_id=$1
        GROUP BY s.source_key,r.run_type,b.stream,b.source_table ORDER BY s.source_key,r.run_type,b.stream`,[tenant()]);
      const batchDetails=await manager.query(`SELECT s.source_key "sourceKey",r.run_type "runType",r.id "runId",b.stream,b.source_table "sourceTable",
        b.batch_number "batchNumber",b.status,b.read_count "readCount",b.inserted_count "insertedCount",b.updated_count "updatedCount",
        b.overlap_replay_count "overlapReplayCount",b.true_duplicate_count "trueDuplicateCount",b.duration_ms::text "durationMs",
        b.retry_count "retryCount",b.cursor_before "cursorBefore",b.cursor_after "cursorAfter",b.scan_upper_bound "scanUpperBound",b.created_at "committedAt"
        FROM erp_sync_batches b JOIN erp_sync_sources s ON s.id=b.source_id JOIN erp_sync_runs r ON r.id=b.run_id
        WHERE b.tenant_id=$1 ORDER BY r.started_at,b.stream,b.batch_number`,[tenant()]);
      const cursors=await manager.query(`SELECT s.source_key "sourceKey",c.phase,c.stream,c.source_table "sourceTable",c.initialization_business_date "initializationBusinessDate",
        c.initialization_source_pk "initializationSourcePk",c.last_processed_modified_at "lastProcessedModifiedAt",c.last_processed_source_pk "lastProcessedSourcePk",
        c.last_successful_scan_upper_bound "lastSuccessfulScanUpperBound" FROM erp_sync_cursors c JOIN erp_sync_sources s ON s.id=c.source_id WHERE c.tenant_id=$1 ORDER BY s.source_key,c.phase,c.stream`,[tenant()]);
      return {sources,runs,batches,batchDetails,cursors};
    });
  }

  static requestHash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
}
