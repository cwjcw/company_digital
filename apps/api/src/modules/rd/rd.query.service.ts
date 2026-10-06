import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { normalizeKdosPageSize } from "../../common/pagination";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import type { RdActor } from "./rd.types";
import { canReadRd } from "./rd.types";
import { prepareMaterial, rankPreparedCancellable, type MaterialCandidate, type PreparedMaterialCandidate } from "./rd-duplicate-algorithm";

@Injectable()
export class RdQueryService {
  private readonly libraryCache = new Map<string, { signature: string; rows?: PreparedMaterialCandidate[]; loading?: Promise<PreparedMaterialCandidate[]> }>();

  constructor(private readonly dataSource: DataSource) {}

  private async fullLibrary(tenantId: string) {
    const [state] = await this.dataSource.query(`SELECT count(*)::int AS count,COALESCE(max(updated_at),'epoch'::timestamptz) AS "maxUpdatedAt" FROM rd_items WHERE tenant_id=$1`, [tenantId]);
    const signature = `${state?.count ?? 0}:${state?.maxUpdatedAt ?? "epoch"}`;
    const cached = this.libraryCache.get(tenantId);
    if (cached?.signature === signature && cached.rows) return cached.rows;
    if (cached?.signature === signature && cached.loading) return cached.loading;
    const loading = this.dataSource.query(`SELECT id::text AS "sourceId",version,0::int row,item_code AS code,item_name AS name,specification AS spec FROM rd_items WHERE tenant_id=$1`, [tenantId])
      .then((rows: MaterialCandidate[]) => rows.map(prepareMaterial));
    this.libraryCache.set(tenantId, { signature, loading });
    try {
      const rows = await loading;
      this.libraryCache.set(tenantId, { signature, rows });
      return rows;
    } catch (error) {
      if (this.libraryCache.get(tenantId)?.loading === loading) this.libraryCache.delete(tenantId);
      throw error;
    }
  }

  async listItems(input: Record<string, unknown>, actor: RdActor) {
    if (!canReadRd(actor, "rd-items")) throw new ForbiddenException("当前权限组没有物料数据查看权限");
    const visible = new Set(tablePermissionFieldsFor("rd-items").filter((field) => actor.isSystemAdmin || actor.moduleAdminCodes.includes("rd") || actor.permissions.includes("*") || actor.permissions.includes(`rd-items:${field.key}:read`)).map((field) => field.key));
    const page = Math.max(1, Number(input.page) || 1), pageSize = normalizeKdosPageSize(Number(input.pageSize) || 100), params: unknown[] = [actor.tenantId];
    const clauses = ["item.tenant_id=$1"];
    const search = String(input.search ?? "").trim();
    if (search) { params.push(`%${search}%`); clauses.push(`(item.item_code ILIKE $${params.length} OR item.item_name ILIKE $${params.length} OR item.specification ILIKE $${params.length})`); }
    const where = clauses.join(" AND ");
    const [{ count }] = await this.dataSource.query(`SELECT count(*)::int count FROM rd_items item WHERE ${where}`, params);
    const selected = ["item.id", "item.version", "item.item_code AS \"itemCode\"", "item.item_name AS \"itemName\"", "item.specification", "item.remark", "item.is_group_item AS \"isGroupItem\"", "item.status", "item.created_at_source AS \"sourceCreatedAt\"", "item.last_modified_at_source AS \"sourceLastModifiedAt\"", "item.modified_at_source AS \"sourceModifiedAt\"", "item.created_by_name AS \"createdByName\"", "item.last_modified_by_name AS \"lastModifiedByName\"", "item.modified_by_name AS \"modifiedByName\""].filter((entry) => entry.includes("item.id") || entry.includes("item.version") || [...visible].some((key) => entry.includes(`"${key}"`) || entry.endsWith(`.${key}`)));
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await this.dataSource.query(`SELECT ${selected.join(",")} FROM rd_items item WHERE ${where} ORDER BY item.item_code,item.id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { rows, total: Number(count), page, pageSize };
  }

  async status(actor: RdActor) {
    if (!canReadRd(actor, "rd-items")) throw new ForbiddenException("当前权限组没有物料数据查看权限");
    const [row] = await this.dataSource.query(`SELECT count(*)::int AS "activeItemCount", max(CASE WHEN status IN ('1','2') OR status IS NULL THEN synced_at END) AS "lastSuccessfulSyncAt" FROM rd_items WHERE tenant_id=$1`, [actor.tenantId]);
    const [run] = await this.dataSource.query(`SELECT id,mode,status,started_at AS "startedAt",finished_at AS "finishedAt",rows_read AS "rowsRead",rows_created AS "rowsCreated",rows_updated AS "rowsUpdated",rows_unchanged AS "rowsUnchanged",error_message AS "errorMessage" FROM rd_sync_runs WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 1`, [actor.tenantId]);
    return { ...(row ?? { activeItemCount: 0, lastSuccessfulSyncAt: null }), latestSync: run ?? null };
  }

  async latestScan(actor: RdActor) {
    if (!canReadRd(actor, "rd-material-duplicates")) throw new ForbiddenException("当前权限组没有一物多码查看权限");
    const [scan] = await this.dataSource.query(`SELECT id,status,stage,scan_mode AS "scanMode",started_at AS "startedAt",finished_at AS "finishedAt",rows,item_count AS "itemCount",compared_pairs AS "comparedPairs",skipped_blocks AS "skippedBlocks",skipped_pairs AS "skippedPairs",counts,rule_version AS "ruleVersion",source_watermark_at AS "sourceWatermarkAt",source_watermark_id AS "sourceWatermarkId",source_version AS "sourceVersion",processed_items AS "processedItems",total_items AS "totalItems",processed_blocks AS "processedBlocks",total_blocks AS "totalBlocks",progress_percent AS "progressPercent",error_message AS "errorMessage" FROM rd_duplicate_scans WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 1`, [actor.tenantId]);
    return scan ?? null;
  }

  async scanStatus(scanId: string, actor: RdActor) {
    if (!canReadRd(actor, "rd-material-duplicates")) throw new ForbiddenException("当前权限组没有一物多码查看权限");
    const [scan] = await this.dataSource.query(`SELECT id,status,stage,scan_mode AS "scanMode",started_at AS "startedAt",finished_at AS "finishedAt",rows,item_count AS "itemCount",compared_pairs AS "comparedPairs",skipped_blocks AS "skippedBlocks",skipped_pairs AS "skippedPairs",counts,rule_version AS "ruleVersion",source_watermark_at AS "sourceWatermarkAt",source_watermark_id AS "sourceWatermarkId",source_version AS "sourceVersion",processed_items AS "processedItems",total_items AS "totalItems",processed_blocks AS "processedBlocks",total_blocks AS "totalBlocks",progress_percent AS "progressPercent",error_message AS "errorMessage" FROM rd_duplicate_scans WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, scanId]);
    if (!scan) throw new BadRequestException("扫描记录不存在");
    return scan;
  }

  async check(input: { itemName?: string; specification?: string; limit?: number }, actor: RdActor, signal?: AbortSignal) {
    if (!canReadRd(actor, "rd-material-duplicates")) throw new ForbiddenException("当前权限组没有一物多码查看权限");
    const itemName = String(input.itemName ?? "").trim(), specification = String(input.specification ?? "").trim();
    if (!itemName && !specification) throw new BadRequestException("请输入品名或规格");
    if (itemName.length > 200 || specification.length > 500) throw new BadRequestException("品名最多200字，规格最多500字");
    // The candidate source is the complete tenant-scoped material library. The
    // limit is only the number of ranked results returned to the caller.
    const rows = await this.fullLibrary(actor.tenantId);
    const limit = Math.min(20, Math.max(1, Number(input.limit) || 5));
    return { rowsScanned: rows.length, limit, results: await rankPreparedCancellable(itemName, specification, rows, limit, signal), note: "实验性匹配分，不是重复概率；未找到候选不代表可以新建。" };
  }

  async scan(scanId: string, input: Record<string, unknown>, actor: RdActor) {
    if (!canReadRd(actor, "rd-material-duplicates")) throw new ForbiddenException("当前权限组没有一物多码查看权限");
    const [scan] = await this.dataSource.query(`SELECT id,status,stage,scan_mode AS "scanMode",started_at AS "startedAt",finished_at AS "finishedAt",rows,item_count AS "itemCount",compared_pairs AS "comparedPairs",skipped_blocks AS "skippedBlocks",skipped_pairs AS "skippedPairs",counts,rule_version AS "ruleVersion",source_watermark_at AS "sourceWatermarkAt",source_watermark_id AS "sourceWatermarkId",source_version AS "sourceVersion",processed_items AS "processedItems",total_items AS "totalItems",processed_blocks AS "processedBlocks",total_blocks AS "totalBlocks",progress_percent AS "progressPercent",error_message AS "errorMessage" FROM rd_duplicate_scans WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, scanId]);
    if (!scan) throw new BadRequestException("扫描记录不存在");
    if (scan.status !== "COMPLETE") return scan;
    const page = Math.max(1, Number(input.page) || 1), pageSize = [20, 50, 100].includes(Number(input.pageSize)) ? Number(input.pageSize) : 50;
    const kind = String(input.kind ?? "all"), minScore = Number(input.minScore) || 0;
    const groupParams: unknown[] = [scanId, actor.tenantId];
    const groupFilterClauses = ["g.scan_id=$1", "g.tenant_id=$2", `COALESCE(g.score,0)>=$${groupParams.push(minScore)}`];
    const memberFilters = ["fm.group_id=g.id", "fm.tenant_id=g.tenant_id", "i.tenant_id=g.tenant_id"];
    const itemClauses = ["i.tenant_id=$1"];
    const itemParams: unknown[] = [actor.tenantId];
    for (const [field, column, itemColumn] of [["code", "i.item_code", "item_code"], ["name", "i.item_name", "item_name"], ["spec", "i.specification", "specification"]] as const) {
      const value = String(input[field] ?? "").trim();
      if (!value) continue;
      groupParams.push(`%${value}%`);
      memberFilters.push(`${column} ILIKE $${groupParams.length}`);
      itemParams.push(`%${value}%`);
      itemClauses.push(`i.${itemColumn} ILIKE $${itemParams.length}`);
    }
    if (memberFilters.length > 3) groupFilterClauses.push(`EXISTS (SELECT 1 FROM rd_duplicate_members fm JOIN rd_items i ON i.id=fm.rd_item_id WHERE ${memberFilters.join(" AND ")})`);
    const [{ count: materialMatchCount }] = await this.dataSource.query(`SELECT count(*)::int AS count FROM rd_items i WHERE ${itemClauses.join(" AND ")}`, itemParams);
    const [groupCountsRow] = await this.dataSource.query(`SELECT count(*)::int AS "all",count(*) FILTER (WHERE g.kind='similar')::int AS similar,count(*) FILTER (WHERE g.kind='exact')::int AS exact,count(*) FILTER (WHERE g.kind='missing')::int AS missing,count(*) FILTER (WHERE g.kind='code')::int AS code FROM rd_duplicate_groups g WHERE ${groupFilterClauses.join(" AND ")}`, groupParams);
    const groupCounts = {
      all: Number(groupCountsRow?.all ?? 0),
      similar: Number(groupCountsRow?.similar ?? 0),
      exact: Number(groupCountsRow?.exact ?? 0),
      missing: Number(groupCountsRow?.missing ?? 0),
      code: Number(groupCountsRow?.code ?? 0)
    };
    const listParams = [...groupParams];
    const listClauses = [...groupFilterClauses];
    if (kind !== "all") { listParams.push(kind); listClauses.push(`g.kind=$${listParams.length}`); }
    let totalGroups = groupCounts.all;
    if (kind !== "all") {
      const [filteredCount] = await this.dataSource.query(`SELECT count(*)::int AS count FROM rd_duplicate_groups g WHERE ${listClauses.join(" AND ")}`, listParams);
      totalGroups = Number(filteredCount?.count ?? 0);
    }
    listParams.push(pageSize, (page - 1) * pageSize);
    const groups = await this.dataSource.query(`SELECT g.id,g.group_no AS "groupNo",g.kind,g.score,g.reason,g.warnings,g.member_count AS "memberCount",g.distinct_codes AS "distinctCodes",g.members_truncated AS "membersTruncated",COALESCE(jsonb_agg(jsonb_build_object('row',m.source_row,'code',i.item_code,'name',i.item_name,'spec',i.specification) ORDER BY m.member_order) FILTER (WHERE i.id IS NOT NULL),'[]'::jsonb) records FROM rd_duplicate_groups g LEFT JOIN rd_duplicate_members m ON m.group_id=g.id AND m.tenant_id=g.tenant_id LEFT JOIN rd_items i ON i.id=m.rd_item_id AND i.tenant_id=g.tenant_id WHERE ${listClauses.join(" AND ")} GROUP BY g.id ORDER BY CASE g.kind WHEN 'exact' THEN 0 WHEN 'similar' THEN 1 WHEN 'missing' THEN 2 ELSE 3 END,g.score DESC NULLS LAST,g.group_no LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`, listParams);
    return { ...scan, totalGroups, materialMatchCount: Number(materialMatchCount ?? 0), groupCounts, page, pageSize, pages: Math.max(1, Math.ceil(totalGroups / pageSize)), groups };
  }
}
