import { ForbiddenException, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { stableHash, scanRows, type MaterialCandidate } from "./rd-duplicate-algorithm";
import { RdE10Reader, type E10ItemRow } from "./rd-e10-reader";
import type { RdActor } from "./rd.types";
import { canRd } from "./rd.types";

@Injectable()
export class RdApplicationService {
  constructor(private readonly dataSource: DataSource, private readonly reader: RdE10Reader) {}

  async sync(mode: "FULL" | "INCREMENTAL", actor: RdActor) {
    if (!actor.isSystemAdmin && !actor.permissions.includes("*") && !actor.moduleAdminCodes.includes("rd")) throw new ForbiddenException("只有研发中心管理员可以执行物料同步");
    const sourceDatabase = process.env.RD_E10_DATABASE ?? "E10_6.0.0.1.NEW.CHS";
    const [previous] = await this.dataSource.query(`SELECT watermark_after_at AS "at",watermark_after_id AS "id" FROM rd_sync_runs WHERE tenant_id=$1 AND status='SUCCESS' ORDER BY finished_at DESC LIMIT 1`, [actor.tenantId]);
    const run = await this.dataSource.query(`INSERT INTO rd_sync_runs(tenant_id,mode,source_database,watermark_before_at,watermark_before_id,actor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [actor.tenantId, mode, sourceDatabase, previous?.at ?? null, previous?.id ?? null, actor.userId]);
    const runId = run[0].id; let rowsRead = 0, rowsCreated = 0, rowsUpdated = 0, rowsUnchanged = 0; let watermarkAt: string | null = previous?.at ?? null, watermarkId: string | null = previous?.id ?? null;
    try {
      const buffer: E10ItemRow[] = [];
      for await (const row of this.reader.read(mode, previous ? { at: previous.at, id: previous.id } : undefined)) {
        buffer.push(row); rowsRead++; if (!watermarkAt || String(row.last_modified_at_source ?? "") > watermarkAt || (String(row.last_modified_at_source ?? "") === watermarkAt && row.source_id > String(watermarkId))) { watermarkAt = row.last_modified_at_source; watermarkId = row.source_id; }
        if (buffer.length >= 250) { const result = await this.upsertItems(buffer.splice(0), actor, sourceDatabase); rowsCreated += result.created; rowsUpdated += result.updated; rowsUnchanged += result.unchanged; }
      }
      if (buffer.length) { const result = await this.upsertItems(buffer, actor, sourceDatabase); rowsCreated += result.created; rowsUpdated += result.updated; rowsUnchanged += result.unchanged; }
      if (mode === "FULL") { const [max] = await this.dataSource.query(`SELECT max(last_modified_at_source) AS "at" FROM rd_items WHERE tenant_id=$1`, [actor.tenantId]); watermarkAt = max?.at ?? watermarkAt; }
      await this.dataSource.query(`UPDATE rd_sync_runs SET status='SUCCESS',finished_at=now(),rows_read=$2,rows_created=$3,rows_updated=$4,rows_unchanged=$5,watermark_after_at=$6,watermark_after_id=$7 WHERE id=$1 AND tenant_id=$8`, [runId, rowsRead, rowsCreated, rowsUpdated, rowsUnchanged, watermarkAt, watermarkId, actor.tenantId]);
      await this.audit(actor, "rd-items", runId, "rd.items.sync_succeeded", null, { mode, rowsRead, rowsCreated, rowsUpdated, rowsUnchanged });
      return { runId, mode, status: "SUCCESS", rowsRead, rowsCreated, rowsUpdated, rowsUnchanged, watermark: { at: watermarkAt, id: watermarkId } };
    } catch (error) {
      await this.dataSource.query(`UPDATE rd_sync_runs SET status='FAILED',finished_at=now(),rows_read=$2,rows_created=$3,rows_updated=$4,rows_unchanged=$5,error_message=$6 WHERE id=$1 AND tenant_id=$7`, [runId, rowsRead, rowsCreated, rowsUpdated, rowsUnchanged, error instanceof Error ? error.message.slice(0, 1000) : "同步失败", actor.tenantId]);
      throw error;
    }
  }

  private async upsertItems(rows: E10ItemRow[], actor: RdActor, sourceDatabase: string) {
    return this.dataSource.transaction(async (manager) => {
      let created = 0, updated = 0, unchanged = 0;
      for (const row of rows) {
        const hash = stableHash(row); const current = await manager.query(`SELECT id,content_hash FROM rd_items WHERE tenant_id=$1 AND source_system='E10' AND source_database=$2 AND source_id=$3 FOR UPDATE`, [actor.tenantId, sourceDatabase, row.source_id]);
        if (!current.length) { await manager.query(`INSERT INTO rd_items(tenant_id,source_database,source_id,item_code,item_name,specification,remark,is_group_item,status,approve_status,created_at_source,last_modified_at_source,modified_at_source,created_by_source,last_modified_by_source,modified_by_source,created_by_name,last_modified_by_name,modified_by_name,content_hash) VALUES($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::uuid,$15::uuid,$16::uuid,$17,$18,$19,$20)`, [actor.tenantId, sourceDatabase, row.source_id, row.item_code.trim(), row.item_name ?? "", row.specification ?? "", row.remark ?? "", row.is_group_item, row.status, row.approve_status, row.created_at_source, row.last_modified_at_source, row.modified_at_source, row.created_by_source, row.last_modified_by_source, row.modified_by_source, row.created_by_name, row.last_modified_by_name, row.modified_by_name, hash]); created++; }
        else if (current[0].content_hash === hash) unchanged++;
        else { await manager.query(`UPDATE rd_items SET item_code=$4,item_name=$5,specification=$6,remark=$7,is_group_item=$8,status=$9,approve_status=$10,created_at_source=$11,last_modified_at_source=$12,modified_at_source=$13,created_by_source=$14::uuid,last_modified_by_source=$15::uuid,modified_by_source=$16::uuid,created_by_name=$17,last_modified_by_name=$18,modified_by_name=$19,content_hash=$20,synced_at=now(),updated_at=now(),version=version+1 WHERE tenant_id=$1 AND source_system='E10' AND source_database=$2 AND source_id=$3::uuid`, [actor.tenantId, sourceDatabase, row.source_id, row.item_code.trim(), row.item_name ?? "", row.specification ?? "", row.remark ?? "", row.is_group_item, row.status, row.approve_status, row.created_at_source, row.last_modified_at_source, row.modified_at_source, row.created_by_source, row.last_modified_by_source, row.modified_by_source, row.created_by_name, row.last_modified_by_name, row.modified_by_name, hash]); updated++; }
      }
      return { created, updated, unchanged };
    });
  }

  async startScan(actor: RdActor) {
    if (!canRd(actor, "rd-material-duplicates", "read")) throw new ForbiddenException("当前权限组没有一物多码查看权限");
    const [current] = await this.dataSource.query(`SELECT id,status FROM rd_duplicate_scans WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 1`, [actor.tenantId]);
    if (current?.status === "RUNNING") return current;
    const [scan] = await this.dataSource.query(`INSERT INTO rd_duplicate_scans(tenant_id,status,created_by) VALUES($1,'RUNNING',$2) RETURNING id,status`, [actor.tenantId, actor.userId]);
    setImmediate(() => void this.runScan(scan.id, actor).catch(() => undefined));
    return scan;
  }

  private async runScan(scanId: string, actor: RdActor) {
    try {
      const rows: MaterialCandidate[] = await this.dataSource.query(`SELECT row_number() over (ORDER BY item_code,id)::int row,id::text AS "sourceId",item_code AS code,item_name AS name,specification AS spec FROM rd_items WHERE tenant_id=$1 ORDER BY item_code,id`, [actor.tenantId]);
      const report = scanRows(rows, (progress) => void this.dataSource.query(`UPDATE rd_duplicate_scans SET stage=$2 WHERE id=$1 AND tenant_id=$3`, [scanId, String(progress.stage ?? ""), actor.tenantId]));
      await this.dataSource.transaction(async (manager) => {
        await manager.query(`DELETE FROM rd_duplicate_groups WHERE scan_id=$1 AND tenant_id=$2`, [scanId, actor.tenantId]);
        for (const [index, group] of report.groups.entries()) {
          const [inserted] = await manager.query(`INSERT INTO rd_duplicate_groups(scan_id,tenant_id,group_no,kind,score,reason,warnings,member_count,distinct_codes,members_truncated) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) RETURNING id`, [scanId, actor.tenantId, index + 1, group.kind, group.score, group.reason, JSON.stringify(group.warnings), group.count, group.distinctCodes, group.membersTruncated]);
          for (const [memberOrder, member] of group.records.entries()) { const [item] = member.sourceId
            ? await manager.query(`SELECT id FROM rd_items WHERE tenant_id=$1 AND id=$2::uuid`, [actor.tenantId, member.sourceId])
            : await manager.query(`SELECT id FROM rd_items WHERE tenant_id=$1 AND item_code=$2 AND item_name=$3 AND specification=$4 ORDER BY id LIMIT 1`, [actor.tenantId, member.code, member.name, member.spec]); if (item) await manager.query(`INSERT INTO rd_duplicate_members(group_id,tenant_id,rd_item_id,member_order,source_row) VALUES($1,$2,$3,$4,$5)`, [inserted.id, actor.tenantId, item.id, memberOrder, member.row]); }
        }
        await manager.query(`UPDATE rd_duplicate_scans SET status='COMPLETE',stage='完成',finished_at=now(),rows=$2,compared_pairs=$3,skipped_blocks=$4,skipped_pairs=$5,counts=$6::jsonb WHERE id=$1 AND tenant_id=$7`, [scanId, report.rows, report.comparedPairs, report.skippedBlocks, report.skippedPairs, JSON.stringify(report.counts), actor.tenantId]);
      });
    } catch (error) { await this.dataSource.query(`UPDATE rd_duplicate_scans SET status='FAILED',finished_at=now(),error_message=$2 WHERE id=$1 AND tenant_id=$3`, [scanId, error instanceof Error ? error.message.slice(0, 1000) : "扫描失败", actor.tenantId]); }
  }

  private async audit(actor: RdActor, resource: string, recordId: string, action: string, before: unknown, after: unknown) {
    await this.dataSource.query(`INSERT INTO audit_logs(actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by) VALUES($1::uuid,$2,$3,$4::uuid,$5,$6::jsonb,$7::jsonb,$8,$9,$1::uuid,$1::uuid)`, [actor.userId, actor.username, resource, recordId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), actor.requestId, actor.source === "web" ? "web" : "api"]);
  }
}
