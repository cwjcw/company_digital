import { ForbiddenException, Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import {
  materialFeatureHash,
  prepareMaterial,
  prepareMaterialFromFeatures,
  scanChangedPreparedRows,
  scanPreparedRows,
  serializeMaterialFeatures,
  type MaterialCandidate,
  type PersistedMaterialFeatures,
  type PreparedMaterialCandidate,
  type HistoryGroup,
} from "./rd-duplicate-algorithm";
import type { RdActor } from "./rd.types";
import { canRd } from "./rd.types";

export const RD_DUPLICATE_RULE_VERSION = "history-1";
export type RdScanMode = "FULL" | "INCREMENTAL";

type DbMaterial = MaterialCandidate & { version: number };
type ScanSource = {
  itemCount: number;
  maxUpdatedAt: string | null;
  watermarkAt: string | null;
  watermarkId: string | null;
  sourceVersion: string;
};
type FeatureRow = PersistedMaterialFeatures & { itemVersion: number; rdItemId: string };

const FEATURE_BATCH_SIZE = 1000;
const GROUP_BATCH_SIZE = 1000;
const MEMBER_BATCH_SIZE = 3000;

@Injectable()
export class RdHistoryScanService {
  constructor(private readonly dataSource: DataSource) {}

  async start(actor: RdActor, requestedMode: RdScanMode = "INCREMENTAL", changedItemIds?: string[]) {
    if (!canRd(actor, "rd-material-duplicates", "read")) throw new ForbiddenException("当前权限组没有一物多码查看权限");
    if (requestedMode === "FULL" && !actor.isSystemAdmin && !actor.permissions.includes("*") && !actor.moduleAdminCodes.includes("rd")) {
      throw new ForbiddenException("只有研发中心管理员可以执行全量重建");
    }
    const [current] = await this.dataSource.query(`SELECT id,status,scan_mode AS "scanMode" FROM rd_duplicate_scans WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 1`, [actor.tenantId]);
    if (current?.status === "RUNNING") return current;

    const [base] = await this.dataSource.query(`SELECT id,rule_version AS "ruleVersion",finished_at AS "finishedAt",item_count AS "itemCount",source_version AS "sourceVersion" FROM rd_duplicate_scans WHERE tenant_id=$1 AND status='COMPLETE' ORDER BY finished_at DESC LIMIT 1`, [actor.tenantId]);
    const source = await this.sourceState(actor.tenantId);
    let mode = requestedMode;
    if (mode === "INCREMENTAL" && !base) mode = "FULL";
    if (mode === "INCREMENTAL" && base?.ruleVersion !== RD_DUPLICATE_RULE_VERSION) {
      return { status: "RULE_MISMATCH", message: "查重规则已更新，请执行全量重建。", ruleVersion: RD_DUPLICATE_RULE_VERSION, previousRuleVersion: base?.ruleVersion ?? null };
    }

    const changed = mode === "INCREMENTAL"
      ? await this.changedItems(actor.tenantId, base?.finishedAt, changedItemIds)
      : [];
    if (mode === "INCREMENTAL" && changed.length === 0) {
      return { status: "NO_CHANGES", message: "当前物料数据无变化，无需重新扫描。", scanId: base?.id ?? null, itemCount: source.itemCount };
    }
    const [scan] = await this.dataSource.query(`
      INSERT INTO rd_duplicate_scans(
        tenant_id,status,scan_mode,base_scan_id,source_watermark_at,source_watermark_id,source_version,
        item_count,total_items,stage,created_by
      ) VALUES($1,'RUNNING',$2,$3,$4,$5::uuid,$6,$7,$7,'读取物料',$8)
      RETURNING id,status,scan_mode AS "scanMode",item_count AS "itemCount",total_items AS "totalItems"
    `, [actor.tenantId, mode, mode === "INCREMENTAL" ? base.id : null, source.watermarkAt, source.watermarkId, source.sourceVersion, source.itemCount, actor.userId]);
    setImmediate(() => void this.run(scan.id, actor, mode, changed, base?.id ?? null, source).catch(() => undefined));
    return { ...scan, changedItems: changed.length, message: mode === "FULL" ? "全量重建已开始。" : "查重更新已开始。" };
  }

  private async sourceState(tenantId: string): Promise<ScanSource> {
    const [[items], [watermark]] = await Promise.all([
      this.dataSource.query(`SELECT count(*)::int AS "itemCount",max(updated_at) AS "maxUpdatedAt" FROM rd_items WHERE tenant_id=$1`, [tenantId]),
      this.dataSource.query(`SELECT watermark_after_at AS "watermarkAt",watermark_after_id AS "watermarkId" FROM rd_sync_runs WHERE tenant_id=$1 AND status='SUCCESS' ORDER BY finished_at DESC LIMIT 1`, [tenantId]),
    ]);
    const itemCount = Number(items?.itemCount ?? 0);
    const maxUpdatedAt = items?.maxUpdatedAt ? new Date(items.maxUpdatedAt).toISOString() : null;
    const watermarkAt = watermark?.watermarkAt ? new Date(watermark.watermarkAt).toISOString() : null;
    const watermarkId = watermark?.watermarkId ? String(watermark.watermarkId) : null;
    return { itemCount, maxUpdatedAt, watermarkAt, watermarkId, sourceVersion: [watermarkAt ?? "", watermarkId ?? "", maxUpdatedAt ?? "", itemCount].join(":") };
  }

  private async changedItems(tenantId: string, finishedAt?: string | null, changedItemIds?: string[]) {
    if (changedItemIds?.length) {
      const rows = await this.dataSource.query(`SELECT id::text AS id FROM rd_items WHERE tenant_id=$1 AND id = ANY($2::uuid[])`, [tenantId, changedItemIds]);
      return rows.map((row: { id: string }) => row.id);
    }
    if (!finishedAt) return [];
    const rows = await this.dataSource.query(`SELECT id::text AS id FROM rd_items WHERE tenant_id=$1 AND updated_at > $2::timestamptz ORDER BY id`, [tenantId, finishedAt]);
    return rows.map((row: { id: string }) => row.id);
  }

  private async run(scanId: string, actor: RdActor, mode: RdScanMode, changedIds: string[], baseScanId: string | null, source: ScanSource) {
    try {
      await this.updateProgress(scanId, actor.tenantId, "读取物料", 0, source.itemCount, 0, 0, 1);
      const rows: DbMaterial[] = await this.dataSource.query(`SELECT row_number() over (ORDER BY item_code,id)::int row,id::text AS "sourceId",version,item_code AS code,item_name AS name,specification AS spec FROM rd_items WHERE tenant_id=$1 ORDER BY item_code,id`, [actor.tenantId]);
      await this.updateProgress(scanId, actor.tenantId, "准备特征", 0, rows.length, 0, 0, 5);
      const prepared = await this.prepareRows(actor.tenantId, rows, scanId);
      const changed = new Set(changedIds);
      const report = mode === "INCREMENTAL"
        ? scanChangedPreparedRows(prepared, changed, (progress) => void this.reportAlgorithmProgress(scanId, actor.tenantId, progress, 65))
        : scanPreparedRows(prepared, (progress) => void this.reportAlgorithmProgress(scanId, actor.tenantId, progress, 65));
      await this.updateProgress(scanId, actor.tenantId, "保存结果", rows.length, rows.length, report.skippedBlocks, report.skippedBlocks, 80);
      if (mode === "INCREMENTAL" && baseScanId) await this.persistIncremental(scanId, baseScanId, actor.tenantId, changedIds, report.groups, report, source);
      else await this.persistFull(scanId, actor.tenantId, report.groups, report, source);
    } catch (error) {
      await this.dataSource.query(`UPDATE rd_duplicate_scans SET status='FAILED',stage='失败',finished_at=now(),error_message=$2,progress_percent=0 WHERE id=$1 AND tenant_id=$3`, [scanId, error instanceof Error ? error.message.slice(0, 1000) : "扫描失败", actor.tenantId]);
    }
  }

  private async prepareRows(tenantId: string, rows: DbMaterial[], scanId: string) {
    const featureRows: FeatureRow[] = await this.dataSource.query(`
      SELECT rd_item_id::text AS "rdItemId",item_version AS "itemVersion",feature_hash AS "featureHash",
        normalized_name AS "normalizedName",normalized_spec AS "normalizedSpec",inferred_category AS "inferredCategory",
        numeric_features AS "numericFeatures",qualifiers,attributes,candidate_keys AS "candidateKeys",feature_json AS "featureJson"
      FROM rd_item_features WHERE tenant_id=$1 AND rule_version=$2
    `, [tenantId, RD_DUPLICATE_RULE_VERSION]);
    const featureMap = new Map(featureRows.map((row) => [row.rdItemId, row]));
    const prepared: PreparedMaterialCandidate[] = [];
    const pending: Array<{ item: DbMaterial; feature: PersistedMaterialFeatures }> = [];
    for (let index = 0; index < rows.length; index++) {
      const item = rows[index];
      const cached = featureMap.get(item.sourceId ?? "");
      const candidate = { row: item.row, sourceId: item.sourceId, code: item.code, name: item.name, spec: item.spec };
      if (cached && cached.itemVersion === item.version && cached.featureHash === materialFeatureHash(candidate)) prepared.push(prepareMaterialFromFeatures(candidate, cached));
      else {
        const next = prepareMaterial(candidate);
        prepared.push(next);
        pending.push({ item, feature: serializeMaterialFeatures(next) });
      }
      if (index > 0 && index % 10000 === 0) await this.updateProgress(scanId, tenantId, "准备特征", index, rows.length, 0, 0, 5 + (index / rows.length) * 35);
    }
    await this.persistFeatures(tenantId, pending);
    await this.updateProgress(scanId, tenantId, "生成候选", rows.length, rows.length, 0, 0, 45);
    return prepared;
  }

  private async persistFeatures(tenantId: string, pending: Array<{ item: DbMaterial; feature: PersistedMaterialFeatures }>) {
    for (let offset = 0; offset < pending.length; offset += FEATURE_BATCH_SIZE) {
      const payload = pending.slice(offset, offset + FEATURE_BATCH_SIZE).map(({ item, feature }) => ({
        tenant_id: tenantId, rd_item_id: item.sourceId, item_version: item.version, rule_version: RD_DUPLICATE_RULE_VERSION,
        feature_hash: feature.featureHash, normalized_name: feature.normalizedName, normalized_spec: feature.normalizedSpec,
        inferred_category: feature.inferredCategory, numeric_features: feature.numericFeatures, qualifiers: feature.qualifiers,
        attributes: feature.attributes, candidate_keys: feature.candidateKeys, feature_json: feature.featureJson,
      }));
      await this.dataSource.query(`
        INSERT INTO rd_item_features(tenant_id,rd_item_id,item_version,rule_version,feature_hash,normalized_name,normalized_spec,inferred_category,numeric_features,qualifiers,attributes,candidate_keys,feature_json)
        SELECT x.tenant_id,x.rd_item_id::uuid,x.item_version,x.rule_version,x.feature_hash,x.normalized_name,x.normalized_spec,x.inferred_category,x.numeric_features,x.qualifiers,x.attributes,x.candidate_keys,x.feature_json
        FROM jsonb_to_recordset($1::jsonb) AS x(tenant_id varchar,rd_item_id text,item_version integer,rule_version varchar,feature_hash char(64),normalized_name text,normalized_spec text,inferred_category varchar,numeric_features jsonb,qualifiers jsonb,attributes jsonb,candidate_keys jsonb,feature_json jsonb)
        ON CONFLICT (rd_item_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,item_version=EXCLUDED.item_version,rule_version=EXCLUDED.rule_version,feature_hash=EXCLUDED.feature_hash,normalized_name=EXCLUDED.normalized_name,normalized_spec=EXCLUDED.normalized_spec,inferred_category=EXCLUDED.inferred_category,numeric_features=EXCLUDED.numeric_features,qualifiers=EXCLUDED.qualifiers,attributes=EXCLUDED.attributes,candidate_keys=EXCLUDED.candidate_keys,feature_json=EXCLUDED.feature_json,updated_at=now()
      `, [JSON.stringify(payload)]);
    }
  }

  private async persistFull(scanId: string, tenantId: string, groups: HistoryGroup[], report: { rows: number; comparedPairs: number; skippedBlocks: number; skippedPairs: number; counts: Record<string, number> }, source: ScanSource) {
    await this.dataSource.transaction(async (manager) => {
      await this.insertGroupsAndMembers(manager, scanId, tenantId, groups, 1);
      await this.completeScan(manager, scanId, tenantId, report, source, report.counts);
    });
  }

  private async persistIncremental(scanId: string, baseScanId: string, tenantId: string, changedIds: string[], groups: HistoryGroup[], report: { rows: number; comparedPairs: number; skippedBlocks: number; skippedPairs: number }, source: ScanSource) {
    await this.dataSource.transaction(async (manager) => {
      await manager.query("CREATE TEMP TABLE rd_changed_items(rd_item_id uuid PRIMARY KEY) ON COMMIT DROP");
      await manager.query("INSERT INTO rd_changed_items(rd_item_id) SELECT unnest($1::uuid[])", [changedIds]);
      await manager.query("CREATE TEMP TABLE rd_duplicate_group_map(old_id uuid PRIMARY KEY,new_id uuid NOT NULL) ON COMMIT DROP");
      await manager.query(`
        INSERT INTO rd_duplicate_group_map(old_id,new_id)
        SELECT g.id,uuidv7()
        FROM rd_duplicate_groups g
        WHERE g.scan_id=$1 AND g.tenant_id=$2
          AND NOT EXISTS (SELECT 1 FROM rd_duplicate_members m JOIN rd_changed_items c ON c.rd_item_id=m.rd_item_id WHERE m.group_id=g.id)
      `, [baseScanId, tenantId]);
      await manager.query(`
        INSERT INTO rd_duplicate_groups(id,scan_id,tenant_id,group_no,kind,score,reason,warnings,member_count,distinct_codes,members_truncated)
        SELECT map.new_id,$1,g.tenant_id,g.group_no,g.kind,g.score,g.reason,g.warnings,g.member_count,g.distinct_codes,g.members_truncated
        FROM rd_duplicate_group_map map JOIN rd_duplicate_groups g ON g.id=map.old_id
      `, [scanId]);
      await manager.query(`
        INSERT INTO rd_duplicate_members(group_id,tenant_id,rd_item_id,member_order,source_row)
        SELECT map.new_id,m.tenant_id,m.rd_item_id,m.member_order,m.source_row
        FROM rd_duplicate_group_map map JOIN rd_duplicate_members m ON m.group_id=map.old_id
      `);
      const [{ maxGroupNo }] = await manager.query(`SELECT COALESCE(max(group_no),0)::int AS "maxGroupNo" FROM rd_duplicate_groups WHERE scan_id=$1`, [scanId]);
      await this.insertGroupsAndMembers(manager, scanId, tenantId, groups, Number(maxGroupNo) + 1);
      const counts = await manager.query(`SELECT kind,count(*)::int AS count FROM rd_duplicate_groups WHERE scan_id=$1 GROUP BY kind`, [scanId]);
      await this.completeScan(manager, scanId, tenantId, report, source, Object.fromEntries(counts.map((row: { kind: string; count: number }) => [row.kind, row.count])));
    });
  }

  private async insertGroupsAndMembers(manager: EntityManager, scanId: string, tenantId: string, groups: HistoryGroup[], groupNoOffset: number) {
    for (let offset = 0; offset < groups.length; offset += GROUP_BATCH_SIZE) {
      const chunk = groups.slice(offset, offset + GROUP_BATCH_SIZE);
      const payload = chunk.map((group, index) => ({ group_no: groupNoOffset + offset + index, kind: group.kind, score: group.score, reason: group.reason, warnings: group.warnings, member_count: group.count, distinct_codes: group.distinctCodes, members_truncated: group.membersTruncated }));
      const inserted = await manager.query(`
        INSERT INTO rd_duplicate_groups(scan_id,tenant_id,group_no,kind,score,reason,warnings,member_count,distinct_codes,members_truncated)
        SELECT $1,$2,x.group_no,x.kind,x.score,x.reason,x.warnings,x.member_count,x.distinct_codes,x.members_truncated
        FROM jsonb_to_recordset($3::jsonb) AS x(group_no integer,kind varchar,score numeric,reason text,warnings jsonb,member_count integer,distinct_codes integer,members_truncated boolean)
        RETURNING id,group_no
      `, [scanId, tenantId, JSON.stringify(payload)]);
      const ids = new Map(inserted.map((row: { id: string; group_no: number }) => [Number(row.group_no), row.id]));
      const members = chunk.flatMap((group, index) => group.records.map((member, memberOrder) => ({ group_id: ids.get(groupNoOffset + offset + index), tenant_id: tenantId, rd_item_id: member.sourceId, member_order: memberOrder, source_row: member.row })));
      for (let memberOffset = 0; memberOffset < members.length; memberOffset += MEMBER_BATCH_SIZE) {
        const memberPayload = members.slice(memberOffset, memberOffset + MEMBER_BATCH_SIZE);
        if (!memberPayload.length) continue;
        await manager.query(`
          INSERT INTO rd_duplicate_members(group_id,tenant_id,rd_item_id,member_order,source_row)
          SELECT x.group_id::uuid,x.tenant_id,x.rd_item_id::uuid,x.member_order,x.source_row
          FROM jsonb_to_recordset($1::jsonb) AS x(group_id text,tenant_id varchar,rd_item_id text,member_order integer,source_row integer)
        `, [JSON.stringify(memberPayload)]);
      }
    }
  }

  private async completeScan(manager: EntityManager, scanId: string, tenantId: string, report: { rows: number; comparedPairs: number; skippedBlocks: number; skippedPairs: number }, source: ScanSource, counts: Record<string, number>) {
    await manager.query(`
      UPDATE rd_duplicate_scans SET status='COMPLETE',stage='完成',finished_at=now(),rows=$2,item_count=$2,processed_items=$2,total_items=$2,
        compared_pairs=$3,skipped_blocks=$4,skipped_pairs=$5,counts=$6::jsonb,source_watermark_at=$7,source_watermark_id=$8::uuid,source_version=$9,progress_percent=100
      WHERE id=$1 AND tenant_id=$10
    `, [scanId, report.rows, report.comparedPairs, report.skippedBlocks, report.skippedPairs, JSON.stringify(counts), source.watermarkAt, source.watermarkId, source.sourceVersion, tenantId]);
  }

  private async reportAlgorithmProgress(scanId: string, tenantId: string, progress: Record<string, unknown>, basePercent: number) {
    const totalItems = Number(progress.totalItems ?? 0), processedItems = Number(progress.processedItems ?? totalItems);
    const totalBlocks = Number(progress.totalBlocks ?? 0), processedBlocks = Number(progress.processedBlocks ?? 0);
    const progressPercent = progress.stage === "完成" ? 75 : Math.min(75, basePercent + (totalBlocks ? processedBlocks / totalBlocks * 20 : processedItems / Math.max(1, totalItems) * 20));
    await this.updateProgress(scanId, tenantId, String(progress.stage ?? "相似候选比较"), processedItems, totalItems, processedBlocks, totalBlocks, progressPercent);
  }

  private async updateProgress(scanId: string, tenantId: string, stage: string, processedItems: number, totalItems: number, processedBlocks: number, totalBlocks: number, percent: number) {
    await this.dataSource.query(`UPDATE rd_duplicate_scans SET stage=$2,processed_items=$3,total_items=$4,processed_blocks=$5,total_blocks=$6,progress_percent=$7 WHERE id=$1 AND tenant_id=$8`, [scanId, stage, Math.max(0, Math.floor(processedItems)), Math.max(0, Math.floor(totalItems)), Math.max(0, Math.floor(processedBlocks)), Math.max(0, Math.floor(totalBlocks)), Math.max(0, Math.min(99, Number(percent))), tenantId]);
  }
}
