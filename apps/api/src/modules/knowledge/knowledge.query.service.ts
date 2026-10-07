import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { type EntityManager } from "typeorm";
import { SqlFilterCompiler } from "../../common/filtering/sql-filter.compiler";
import { normalizeKdosPageSize } from "../../common/pagination";
import { KnowledgeAccessService, assertKnowledgeAction, assertKnowledgeFields, canKnowledgeField, canManageKnowledge, knowledgeDataScope, knowledgeSearchClause } from "./knowledge.scope";
import { knowledgeId, knowledgeText } from "./knowledge.content";
import { categoryColumns, knowledgeExpressions, type KnowledgeActor, type KnowledgePageInput, type KnowledgeRow } from "./knowledge.types";

export function knowledgeReadExpressions(mode: "browse" | "manage") {
  return knowledgeExpressions("knowledge-articles", mode);
}
export const knowledgePublishedJoin = `JOIN knowledge_article_versions published ON published.tenant_id=record.tenant_id AND published.article_id=record.id AND published.version_no=record.published_version`;

@Injectable()
export class KnowledgeQueryService {
  constructor(private readonly access: KnowledgeAccessService) {}
  categories(actor: KnowledgeActor, manage = false) {
    assertKnowledgeAction(actor, "knowledge-categories", "read");
    if (manage && !["create", "update", "delete"].some((action) => actor.permissions.includes(`knowledge-categories:*:${action}`)) && !actor.isSystemAdmin && !actor.permissions.includes("*") && !actor.moduleAdminCodes?.includes("knowledge")) throw new ForbiddenException("当前权限组没有分类管理权限");
    return this.access.transaction(actor, async (manager) => {
      const params: unknown[] = [actor.tenantId]; const scope = knowledgeDataScope(actor, "knowledge-categories", "read", params);
      const rows = await manager.query(`SELECT ${Object.entries(categoryColumns).filter(([key]) => ["id", "version"].includes(key) || canKnowledgeField(actor, "knowledge-categories", key, "read")).map(([key, col]) => `record.${col} AS "${key}"`).join(",")} FROM knowledge_categories record WHERE record.tenant_id=$1 AND (${scope}) ${manage ? "" : `AND record.enabled=true AND (record.parent_id IS NULL OR EXISTS(SELECT 1 FROM knowledge_categories parent WHERE parent.tenant_id=record.tenant_id AND parent.id=record.parent_id AND parent.enabled=true))`} ORDER BY record.level,record.sort_order,record.name,record.id`, params);
      return rows;
    });
  }
  options(actor: KnowledgeActor) {
    if (!canManageKnowledge(actor)) throw new ForbiddenException("当前权限组没有文章编辑权限");
    return this.access.transaction(actor, async (manager) => {
      const users = await manager.query(`SELECT id,COALESCE(NULLIF(display_name,''),username) label FROM users WHERE enabled=true ORDER BY label`);
      const organizations = await manager.query(`SELECT id,name label,parent_id AS "parentId" FROM organization_units WHERE enabled=true ORDER BY level,sort_order,name`);
      const roles = await manager.query(`SELECT id,name label FROM roles WHERE permission_group_resource IS NULL ORDER BY name`);
      return { users, organizations, roles };
    });
  }
  list(input: KnowledgePageInput, actor: KnowledgeActor, mode: "browse" | "manage" = "browse") {
    assertKnowledgeAction(actor, "knowledge-articles", "read");
    return this.access.transaction(actor, async (manager) => {
      const params: unknown[] = [actor.tenantId]; const clauses = [await this.access.clause(actor, params, mode, "read", manager)];
      const expressions = knowledgeReadExpressions(mode);
      const search = knowledgeText(input.search, "搜索词", 200);
      let relevance = "0::float8";
      if (search) {
        clauses.push(knowledgeSearchClause(search, actor, params, mode));
        const matchIndex = params.length;
        relevance = `similarity(${mode === "browse" ? "published" : "record"}.search_text,trim(both '%' from $${matchIndex}))::float8`;
      }
      if (input.categoryId) { assertKnowledgeFields(actor, "knowledge-articles", ["categoryId"], "read"); const i = params.push(knowledgeId(input.categoryId)); clauses.push(`(${expressions.categoryId}=$${i}::uuid OR EXISTS(SELECT 1 FROM knowledge_categories child WHERE child.tenant_id=record.tenant_id AND child.id=${expressions.categoryId} AND child.parent_id=$${i}::uuid))`); }
      if (input.tag) { assertKnowledgeFields(actor, "knowledge-articles", ["tags"], "read"); const i = params.push(knowledgeText(input.tag, "标签", 100, true)); clauses.push(`${expressions.tags} ? $${i}::text`); }
      clauses.push(new SqlFilterCompiler(tablePermissionFieldsFor("knowledge-articles"), expressions, (key) => canKnowledgeField(actor, "knowledge-articles", key, "read"), (column) => column).compile(input.filterGroup, params));
      const page = Math.max(1, Math.floor(Number(input.page) || 1)); const pageSize = normalizeKdosPageSize(input.pageSize);
      if (!Number.isSafeInteger(page) || page > 1_000_000) throw new BadRequestException("页码无效");
      const where = clauses.join(" AND "); const from = `knowledge_articles record ${mode === "browse" ? knowledgePublishedJoin : ""}`;
      const [{ count }] = await manager.query(`SELECT count(*)::integer count FROM ${from} WHERE ${where}`, params);
      const sort = String(input.sortField ?? ""); if (sort && (!expressions[sort] || !canKnowledgeField(actor, "knowledge-articles", sort, "read") || ["content", "visibility", "attachmentIds"].includes(sort))) throw new BadRequestException("排序字段无效或无权访问");
      const select = Object.entries(expressions).filter(([key]) => ["id", "version"].includes(key) || (canKnowledgeField(actor, "knowledge-articles", key, "read") && !["content", "contentText", "visibility", "attachmentIds"].includes(key))).map(([key, expr]) => `${expr} AS "${key}"`);
      if (canKnowledgeField(actor, "knowledge-articles", "categoryId", "read")) select.push(`(SELECT name FROM knowledge_categories WHERE tenant_id=record.tenant_id AND id=${expressions.categoryId}) AS "categoryName"`, `(SELECT COALESCE(parent.name,category.name) FROM knowledge_categories category LEFT JOIN knowledge_categories parent ON parent.tenant_id=category.tenant_id AND parent.id=category.parent_id WHERE category.tenant_id=record.tenant_id AND category.id=${expressions.categoryId}) AS "rootCategoryName"`);
      if (canKnowledgeField(actor, "knowledge-articles", "publishedBy", "read")) select.push(`(SELECT display_name FROM users WHERE id=${expressions.publishedBy}) AS "publisherName"`);
      if (canKnowledgeField(actor, "knowledge-articles", "contentText", "read")) select.push(`left(${expressions.contentText},200) AS snippet`);
      select.push(`${relevance} AS relevance`);
      const paged = [...params, pageSize, (page - 1) * pageSize];
      const rows = await manager.query(`SELECT ${select.join(",")} FROM ${from} WHERE ${where} ORDER BY ${sort ? `${expressions[sort]} ${input.sortOrder === "asc" ? "ASC" : "DESC"}` : "relevance DESC,record.updated_at DESC"},record.id LIMIT $${paged.length - 1} OFFSET $${paged.length}`, paged);
      return { rows, total: Number(count), page, pageSize };
    });
  }
  detail(id: string, actor: KnowledgeActor, mode: "browse" | "manage" = "browse", publishedVersion?: number) {
    knowledgeId(id); assertKnowledgeAction(actor, "knowledge-articles", "read");
    return this.access.transaction(actor, async (manager) => {
      const params: unknown[] = [actor.tenantId]; let scope = await this.access.clause(actor, params, publishedVersion != null ? "manage" : mode, "read", manager); const i = params.push(id);
      let from = `knowledge_articles record ${mode === "browse" ? knowledgePublishedJoin : ""}`; const expressions = knowledgeReadExpressions(mode);
      if (publishedVersion != null) {
        if (!canManageKnowledge(actor) || !Number.isInteger(publishedVersion) || publishedVersion < 1) throw new ForbiddenException("当前权限组不能查看历史版本");
        // Always require current published access AND historical ACL, even when the historical ACL was wider.
        const n = params.push(publishedVersion);
        from = `knowledge_articles record ${knowledgePublishedJoin} JOIN knowledge_article_versions historical ON historical.tenant_id=record.tenant_id AND historical.article_id=record.id AND historical.version_no=$${n}`;
        scope += ` AND ${await this.access.historicalClause(actor, params, manager)}`;
        for (const [key, expression] of Object.entries(knowledgeReadExpressions("browse"))) expressions[key] = expression.replace(/^published\./, "historical.");
        expressions.publishedVersion = "historical.version_no";
      }
      const select = Object.entries(expressions).filter(([key]) => ["id", "version"].includes(key) || canKnowledgeField(actor, "knowledge-articles", key, "read")).map(([key, expr]) => `${expr} AS "${key}"`);
      if (canKnowledgeField(actor, "knowledge-articles", "content", "read")) select.push(`${publishedVersion ? "historical" : mode === "browse" ? "published" : "record"}.content_hash AS "contentHash"`);
      const [row] = await manager.query(`SELECT ${select.join(",")} FROM ${from} WHERE ${scope} AND record.id=$${i}::uuid`, params);
      if (!row) throw new NotFoundException("文章不存在或无权访问");
      if (canKnowledgeField(actor, "knowledge-articles", "categoryId", "read")) {
        const [category] = publishedVersion != null
          ? await manager.query(`SELECT category_name AS "categoryName",root_category_name AS "rootCategoryName" FROM knowledge_article_versions WHERE tenant_id=$1 AND article_id=$2 AND version_no=$3`, [actor.tenantId, id, publishedVersion])
          : await manager.query(`SELECT child.name AS "categoryName",COALESCE(parent.name,child.name) AS "rootCategoryName" FROM knowledge_categories child LEFT JOIN knowledge_categories parent ON parent.tenant_id=child.tenant_id AND parent.id=child.parent_id WHERE child.tenant_id=$1 AND child.id=$2`, [actor.tenantId, row.categoryId]);
        Object.assign(row, category);
      }
      if (canKnowledgeField(actor, "knowledge-articles", "publishedBy", "read") && row.publishedBy) { const [user] = await manager.query(`SELECT display_name AS "publisherName" FROM users WHERE id=$1`, [row.publishedBy]); Object.assign(row, user); }
      if (canKnowledgeField(actor, "knowledge-articles", "attachmentIds", "read")) {
        row.attachments = await this.attachments(manager, actor, id, mode, publishedVersion);
        row.attachmentIds = row.attachments.map((file: KnowledgeRow) => file.id);
      }
      if (mode === "browse" && !publishedVersion) {
        const [view] = await manager.query(`UPDATE knowledge_articles SET view_count=view_count+1 WHERE tenant_id=$1 AND id=$2 RETURNING view_count AS "viewCount"`, [actor.tenantId, id]);
        if (canKnowledgeField(actor, "knowledge-articles", "viewCount", "read")) row.viewCount = Number(view.viewCount);
      }
      return row;
    });
  }
  versions(id: string, actor: KnowledgeActor) {
    knowledgeId(id); return this.access.transaction(actor, async (manager) => {
      if (!canManageKnowledge(actor)) throw new ForbiddenException("当前权限组不能查看历史版本");
      assertKnowledgeFields(actor, "knowledge-articles", ["publishedVersion", "publishedAt", "publishedBy"], "read");
      const params: unknown[] = [actor.tenantId]; const scope = await this.access.clause(actor, params, "manage", "read", manager); const i = params.push(id);
      const historic = await this.access.historicalClause(actor, params, manager);
      const [record] = await manager.query(`SELECT record.id FROM knowledge_articles record WHERE ${scope} AND record.id=$${i}`, params.slice(0, i));
      if (!record) throw new NotFoundException("文章不存在或无权访问");
      return manager.query(`SELECT historical.version_no AS "publishedVersion",historical.published_at AS "publishedAt",historical.published_by AS "publishedBy" FROM knowledge_articles record JOIN knowledge_article_versions historical ON historical.tenant_id=record.tenant_id AND historical.article_id=record.id WHERE ${scope} AND record.id=$${i} AND (${historic}) ORDER BY historical.version_no DESC`, params);
    });
  }
  attachment(id: string, actor: KnowledgeActor, mode: "browse" | "manage" = "browse", publishedVersion?: number) {
    knowledgeId(id); assertKnowledgeFields(actor, "knowledge-articles", ["attachmentIds"], "read");
    return this.access.transaction(actor, async (manager) => {
      const params: unknown[] = [actor.tenantId]; const scope = await this.access.clause(actor, params, mode, "read", manager); const i = params.push(id);
      const [row] = await manager.query(`SELECT file.id,file.article_id AS "articleId",file.storage_key AS key,file.original_name AS "originalName",file.content_type AS "contentType" FROM knowledge_articles record ${mode === "browse" ? knowledgePublishedJoin : ""} JOIN knowledge_attachments file ON file.tenant_id=record.tenant_id AND file.article_id=record.id WHERE ${scope} AND file.id=$${i}`, params);
      if (!row) throw new NotFoundException("附件不存在或无权访问");
      if (publishedVersion) {
        if (!canManageKnowledge(actor) || !Number.isInteger(publishedVersion) || publishedVersion < 1) throw new ForbiddenException("当前权限组不能查看历史附件");
        const p: unknown[] = [actor.tenantId, row.articleId, publishedVersion, id]; const historic = await this.access.historicalClause(actor, p, manager);
        const found = await manager.query(`SELECT 1 FROM knowledge_article_versions historical JOIN knowledge_version_attachments link ON link.tenant_id=historical.tenant_id AND link.version_id=historical.id AND link.article_id=historical.article_id WHERE historical.tenant_id=$1 AND historical.article_id=$2 AND historical.version_no=$3 AND link.attachment_id=$4 AND (${historic})`, p);
        if (!found.length) throw new NotFoundException("附件不属于此发布版本或无权访问");
      } else if (!(await this.attachments(manager, actor, row.articleId, mode)).some((file: KnowledgeRow) => file.id === id)) throw new NotFoundException("附件不属于当前文章版本");
      return row;
    });
  }
  private attachments(manager: EntityManager, actor: KnowledgeActor, articleId: string, mode: "browse" | "manage", version?: number) {
    const relation = mode === "manage" && !version ? `JOIN knowledge_articles article ON article.tenant_id=file.tenant_id AND article.id=file.article_id AND article.attachment_ids ? file.id::text` : `JOIN knowledge_version_attachments link ON link.tenant_id=file.tenant_id AND link.article_id=file.article_id AND link.attachment_id=file.id JOIN knowledge_article_versions snapshot ON snapshot.tenant_id=link.tenant_id AND snapshot.article_id=link.article_id AND snapshot.id=link.version_id JOIN knowledge_articles article ON article.tenant_id=snapshot.tenant_id AND article.id=snapshot.article_id AND snapshot.version_no=${version ? "$3" : "article.published_version"}`;
    return manager.query(`SELECT file.id,file.article_id AS "articleId",file.original_name AS "originalName",file.content_type AS "contentType",file.size,file.sha256,file.created_at AS "createdAt" FROM knowledge_attachments file ${relation} WHERE file.tenant_id=$1 AND file.article_id=$2 ORDER BY file.created_at,file.id`, version ? [actor.tenantId, articleId, version] : [actor.tenantId, articleId]);
  }
}
