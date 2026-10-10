import { knowledgeUnpublishedChanges } from "./knowledge-publication";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { EntityManager } from "typeorm";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { SqlFilterCompiler } from "../../common/filtering/sql-filter.compiler";
import {
  KnowledgeAuthorizationService,
  assertKnowledgeAction,
  assertKnowledgeFields,
  canKnowledge,
  canKnowledgeField,
  knowledgeDataScope,
} from "./knowledge.scope";
import { knowledgeId, knowledgeText } from "./knowledge.content";
import {
  knowledgeExpressions,
  publishedJoin,
  type KnowledgeActor,
  type KnowledgeMode,
  type KnowledgeRow,
} from "./knowledge.types";

@Injectable()
export class KnowledgeQueryService {
  constructor(private readonly access: KnowledgeAuthorizationService) {}
  /** Navigation capabilities derive from the same resource/field/data/ACL boundaries as commands. */
  capabilities(actor: KnowledgeActor) {
    assertKnowledgeAction(actor, "knowledge-pages", "read");
    assertKnowledgeAction(actor, "knowledge-spaces", "read");
    return this.access.transaction(actor, async (m) => {
      const editable = (resource: "knowledge-pages" | "knowledge-spaces", fields: string[]) =>
        fields.some((field) => canKnowledgeField(actor, resource, field, "read") && canKnowledgeField(actor, resource, field, "update"));
      const pageTarget = async (action: string, minimum: number, mode: KnowledgeMode = "working") => {
        if (!canKnowledge(actor, "knowledge-pages", action)) return false;
        const p: unknown[] = [actor.tenantId];
        const scope = await this.access.clause(actor, p, mode, action, minimum, m);
        const readScope = knowledgeDataScope(actor, "knowledge-pages", "read", p, knowledgeExpressions("knowledge-pages", mode));
        return (await m.query(`SELECT 1 FROM knowledge_pages record ${publishedJoin} WHERE (${scope}) AND (${readScope}) LIMIT 1`, p)).length > 0;
      };
      let canCreatePages = false, canManageSpaces = false;
      if (canKnowledge(actor, "knowledge-pages", "create") &&
          ["title", "spaceId", "parentId"].every((field) => canKnowledgeField(actor, "knowledge-pages", field, "read") && canKnowledgeField(actor, "knowledge-pages", field, "update"))) {
        const p: unknown[] = [actor.tenantId];
        const scope = await this.access.spaceClause(actor, p, "read", 2, m);
        const creator = p.push(actor.userId);
        const expressions = Object.fromEntries(Object.keys(knowledgeExpressions("knowledge-pages")).map((key) => [key, "NULL"]));
        Object.assign(expressions, { createdBy: `$${creator}::uuid`, spaceId: "record.id", parentId: "NULL::uuid", status: "'DRAFT'", title: "''::text" });
        const createScope = knowledgeDataScope(actor, "knowledge-pages", "create", p, expressions);
        canCreatePages = (await m.query(`SELECT 1 FROM knowledge_spaces record WHERE (${scope}) AND record.status='ACTIVE' AND $${creator}::uuid IS NOT NULL AND (${createScope}) LIMIT 1`, p)).length > 0;
        if (!canCreatePages) canCreatePages = await pageTarget("create", 2);
      }
      if (canKnowledge(actor, "knowledge-spaces", "update") && editable("knowledge-spaces", ["name", "description", "icon", "sortOrder", "status", "access"])) {
        const p: unknown[] = [actor.tenantId];
        const scope = await this.access.spaceClause(actor, p, "update", 3, m);
        const readScope = knowledgeDataScope(actor, "knowledge-spaces", "read", p);
        canManageSpaces = (await m.query(`SELECT 1 FROM knowledge_spaces record WHERE (${scope}) AND (${readScope}) LIMIT 1`, p)).length > 0;
      }
      const canCreateSpaces = canKnowledge(actor, "knowledge-spaces", "create") && editable("knowledge-spaces", ["name"]);
      const canEditPages = editable("knowledge-pages", ["title", "content", "description", "tags", "attachmentIds", "parentId", "sortOrder", "status"]) && await pageTarget("update", 2);
      const canManagePages = editable("knowledge-pages", ["access"]) && await pageTarget("update", 3);
      const canArchive = editable("knowledge-pages", ["status"]) && await pageTarget("update", 3);
      const canTrash = await pageTarget("delete", 3) || await pageTarget("delete", 3, "trash");
      return { canManage: canCreatePages || canEditPages || canManagePages || canCreateSpaces || canManageSpaces || canArchive || canTrash,
        canCreatePages, canEditPages, canManagePages, canCreateSpaces, canManageSpaces, canArchive, canTrash };
    });
  }
  spaces(actor: KnowledgeActor, includeArchived = false) {
    return this.access.transaction(actor, async (m) => {
      const params: unknown[] = [actor.tenantId];
      const scope = await this.access.spaceClause(actor, params, "read", 1, m);
      const membership = await this.access.membership(actor, m);
      const rank = this.access.spaceRank(actor, membership, params);
      const fields = Object.entries(
        knowledgeExpressions("knowledge-spaces"),
      ).filter(
        ([k]) =>
          ["id", "version"].includes(k) ||
          canKnowledgeField(actor, "knowledge-spaces", k, "read"),
      );
      const rows = await m.query(
        `SELECT ${fields.map(([k, v]) => `${v} AS "${k}"`).join(",")},${rank} effective_rank FROM knowledge_spaces record WHERE (${scope}) ${includeArchived ? "" : "AND record.status='ACTIVE'"} ORDER BY record.sort_order,record.name,record.id`,
        params,
      );
      return rows.map((r: KnowledgeRow) => {
        const { effective_rank, ...row } = r;
        return {
          ...row,
          accessLevel: ["", "VIEWER", "EDITOR", "FULL_ACCESS"][effective_rank],
          canManage:
            effective_rank >= 3 &&
            canKnowledge(actor, "knowledge-spaces", "update"),
          canCreate:
            effective_rank >= 2 &&
            canKnowledge(actor, "knowledge-pages", "create"),
        };
      });
    });
  }
  spaceAccess(id: string, actor: KnowledgeActor) {
    return this.access.transaction(actor, async (m) => {
      assertKnowledgeFields(actor, "knowledge-spaces", ["access"], "read");
      const p: unknown[] = [actor.tenantId, knowledgeId(id)];
      const scope = await this.access.spaceClause(actor, p, "read", 3, m);
      if (
        !(
          await m.query(
            `SELECT 1 FROM knowledge_spaces record WHERE record.id=$2 AND (${scope})`,
            p,
          )
        ).length
      )
        throw new NotFoundException("空间不存在或不可管理");
      return m.query(
        `SELECT subject_type AS "subjectType",subject_id AS "subjectId",access_level AS "accessLevel" FROM knowledge_space_access WHERE tenant_id=$1 AND space_id=$2 ORDER BY subject_type,subject_id`,
        [actor.tenantId, id],
      );
    });
  }
  options(actor: KnowledgeActor) {
    assertKnowledgeAction(actor, "knowledge-spaces", "read");
    if (
      !(["knowledge-spaces", "knowledge-pages"] as const).some(
        (resource) =>
          canKnowledge(actor, resource, "update") &&
          canKnowledgeField(actor, resource, "access", "read") &&
          canKnowledgeField(actor, resource, "access", "update"),
      )
    )
      throw new BadRequestException("无成员配置权限");
    return this.access.transaction(actor, async (m) => ({
      organizations: await m.query(
        "SELECT id,name AS label FROM organization_units WHERE enabled=true ORDER BY name,id",
      ),
      roles: await m.query(
        "SELECT id,name AS label FROM roles WHERE permission_group_resource IS NULL ORDER BY name,id",
      ),
      users: await m.query(
        "SELECT id,display_name AS label FROM users WHERE enabled=true ORDER BY display_name,id",
      ),
    }));
  }
  tree(spaceId: string, input: Record<string, unknown>, actor: KnowledgeActor) {
    return this.list(
      { ...input, spaceId: knowledgeId(spaceId), tree: true },
      actor,
    );
  }
  async locations(spaceId: string, input: Record<string, unknown>, actor: KnowledgeActor) {
    assertKnowledgeAction(actor, "knowledge-pages", "read");
    assertKnowledgeFields(actor, "knowledge-pages", ["title", "spaceId", "parentId"], "read");
    assertKnowledgeFields(actor, "knowledge-spaces", ["name"], "read");
    const search = knowledgeText(input.search, "搜索词", 200);
    const result = await this.list({
      spaceId: knowledgeId(spaceId), mode: "working", page: input.page,
      pageSize: input.pageSize, parentId: input.parentId,
      tree: !search && !input.selectedId,
      ...(input.selectedId ? { ids: [knowledgeId(input.selectedId)] } : {}),
      ...(search ? { filterGroup: { logic: "AND", rules: [{ field: "title", operator: "contains", value: search }] } } : {}),
    }, actor, "create", input.excludeId ? knowledgeId(input.excludeId) : undefined);
    return { ...result, rows: result.rows.map((row: KnowledgeRow) => ({
      id: row.id, title: row.title, parentId: row.parentId,
      breadcrumb: row.breadcrumb, hasChildren: row.hasChildren,
    })) };
  }
  list(input: Record<string, unknown>, actor: KnowledgeActor, action = "read", excludeSubtree?: string) {
    const search = knowledgeText(input.search, "搜索词", 200);
    const mode = search ? "published" : this.mode(input.mode);
    if (search) {
      assertKnowledgeFields(
        actor,
        "knowledge-pages",
        ["title", "contentText", "description", "attachmentIds", "tags", "parentId"],
        "read",
      );
      assertKnowledgeFields(actor, "knowledge-spaces", ["name"], "read");
    }
    const page = Number(input.page ?? 1),
      pageSize = Number(input.pageSize ?? 100);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000000 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 1000
    )
      throw new BadRequestException("分页无效");
    return this.access.transaction(actor, async (m) => {
      const params: unknown[] = [actor.tenantId],
        clauses = [
          await this.access.clause(actor, params, mode, action, undefined, m),
        ];
      const expressions = knowledgeExpressions("knowledge-pages", mode);
      if (excludeSubtree) {
        const index = params.push(excludeSubtree);
        clauses.push(`NOT EXISTS (${this.access.chain()} SELECT 1 FROM chain WHERE id=$${index}::uuid)`);
      }
      if (input.spaceId) {
        assertKnowledgeFields(actor, "knowledge-pages", ["spaceId"], "read");
        clauses.push(
          `record.space_id=$${params.push(knowledgeId(input.spaceId))}::uuid`,
        );
      }
      if (input.tree) {
        assertKnowledgeFields(
          actor,
          "knowledge-pages",
          ["parentId", "title"],
          "read",
        );
        if (input.parentId)
          clauses.push(
            `record.parent_id=$${params.push(knowledgeId(input.parentId))}::uuid`,
          );
        else clauses.push("record.parent_id IS NULL");
      }
      if (input.status) {
        assertKnowledgeFields(actor, "knowledge-pages", ["status"], "read");
        if (
          !["DRAFT", "PUBLISHED", "ARCHIVED", "TRASHED"].includes(
            String(input.status),
          )
        )
          throw new BadRequestException("页面状态无效");
        clauses.push(`record.status=$${params.push(input.status)}`);
      } else if (mode === "published")
        clauses.push("record.status='PUBLISHED'");
      if (input.tag) {
        assertKnowledgeFields(actor, "knowledge-pages", ["tags"], "read");
        clauses.push(
          `${expressions.tags} ? $${params.push(knowledgeText(input.tag, "标签", 100, true))}::text`,
        );
      }
      if (input.ids) {
        if (!Array.isArray(input.ids))
          throw new BadRequestException("页面列表无效");
        clauses.push(
          `record.id=ANY($${params.push(input.ids.map(knowledgeId))}::uuid[])`,
        );
      }
      if (search) {
        const keyword = `%${search.replace(/[\\%_]/g, (v) => `\\${v}`)}%`;
        clauses.push(
          `record.published_search_text ILIKE $${params.push(keyword)}`,
        );
      }
      clauses.push(
        new SqlFilterCompiler(
          tablePermissionFieldsFor("knowledge-pages"),
          expressions,
          (k) => canKnowledgeField(actor, "knowledge-pages", k, "read"),
          (column) => column,
        ).compile(input.filterGroup, params),
      );
      const from = `knowledge_pages record ${publishedJoin}`,
        where = clauses.map((c) => `(${c})`).join(" AND ");
      const [{ total }] = await m.query(
        `SELECT count(*)::int total FROM ${from} WHERE ${where}`,
        params,
      );
      const fields = this.select(actor, expressions, false);
      if (canKnowledgeField(actor, "knowledge-pages", "attachmentIds", "read"))
        fields.push(`(SELECT jsonb_build_object('id',file.id,'pageId',file.page_id,'originalName',file.original_name,'contentType',file.content_type,'size',file.size,'sha256',file.sha256,'createdAt',file.created_at,'role',link.role)
          FROM knowledge_file_assets file JOIN ${mode === "published" ? "knowledge_page_version_files" : "knowledge_page_files"} link
          ON link.tenant_id=file.tenant_id AND link.page_id=file.page_id AND link.file_id=file.id
          WHERE file.tenant_id=record.tenant_id AND file.page_id=record.id AND link.role='PRIMARY'
          ${mode === "published" ? "AND link.version_id=record.published_version_id" : ""} LIMIT 1) AS "primaryFile"`);
      if (canKnowledgeField(actor, "knowledge-pages", "contentText", "read"))
        fields.push(`left(${expressions.contentText},200) AS snippet`);
      if (
        canKnowledgeField(actor, "knowledge-pages", "title", "read") &&
        canKnowledgeField(actor, "knowledge-pages", "parentId", "read") &&
        canKnowledgeField(actor, "knowledge-pages", "spaceId", "read") &&
        canKnowledgeField(actor, "knowledge-spaces", "name", "read")
      )
        fields.push(
          `${this.breadcrumbExpression(mode)} AS breadcrumb`,
          `(SELECT name FROM knowledge_spaces WHERE tenant_id=record.tenant_id AND id=record.space_id) AS "spaceName"`,
        );
      if (canKnowledgeField(actor, "knowledge-pages", "publishedBy", "read"))
        fields.push(
          `(SELECT display_name FROM users WHERE id=published.published_by) AS "publisherName"`,
        );
      if (search)
        fields.push(
          `similarity(record.published_search_text,$${params.push(search)}) AS relevance`,
        );
      let order = input.tree
        ? "record.sort_order,record.id"
        : search
          ? `relevance DESC,record.id`
          : mode === "published" ? "published.published_at DESC,record.id" : "record.updated_at DESC,record.id";
      if (input.sortField) {
        const key = String(input.sortField);
        if (
          !expressions[key] ||
          !["asc", "desc"].includes(String(input.sortOrder))
        )
          throw new BadRequestException("排序无效");
        assertKnowledgeFields(actor, "knowledge-pages", [key], "read");
        order = `${expressions[key]} ${input.sortOrder},record.id`;
      }
      const limit = params.push(pageSize),
        offset = params.push((page - 1) * pageSize);
      const rows = await m.query(
        `SELECT ${fields.join(",")},false AS "hasChildren" FROM ${from} WHERE ${where} ORDER BY ${order} LIMIT $${limit} OFFSET $${offset}`,
        params,
      );
      // Never disclose the existence of unauthorized children in the lazy tree.
      if (input.tree && rows.length) {
        const p: unknown[] = [
          actor.tenantId,
          rows.map((r: KnowledgeRow) => r.id),
        ];
        const childScope = await this.access.clause(
          actor,
          p,
          mode,
          action,
          undefined,
          m,
        );
        const children = await m.query(
          `SELECT DISTINCT record.parent_id FROM knowledge_pages record ${publishedJoin} WHERE record.parent_id=ANY($2::uuid[]) AND (${childScope}) ${mode === "published" ? "AND record.status='PUBLISHED'" : ""}`,
          p,
        );
        const parents = new Set(children.map((r: KnowledgeRow) => r.parent_id));
        for (const row of rows) row.hasChildren = parents.has(row.id);
      }
      return { rows, total, page, pageSize };
    });
  }
  detail(
    id: string,
    input: Record<string, unknown>,
    actor: KnowledgeActor,
    action = "read",
  ) {
    const mode = this.mode(input.mode),
      versionId = input.versionId == null ? null : knowledgeId(input.versionId);
    return this.access.transaction(actor, async (m) => {
      const params: unknown[] = [actor.tenantId, knowledgeId(id)];
      const scope = await this.access.clause(
        actor,
        params,
        mode,
        action,
        undefined,
        m,
      );
      let join = publishedJoin,
        expressions = knowledgeExpressions("knowledge-pages", mode),
        historic = "1=1";
      if (versionId) {
        assertKnowledgeFields(
          actor,
          "knowledge-pages",
          ["publishedVersion", "content"],
          "read",
        );
        const v = params.push(versionId);
        join = `${publishedJoin} JOIN knowledge_page_versions historical ON historical.tenant_id=record.tenant_id AND historical.page_id=record.id AND historical.id=$${v}`;
        historic = this.access.historicalClause(
          actor,
          await this.access.membership(actor, m),
          params,
        );
        expressions = Object.fromEntries(
          Object.entries(
            knowledgeExpressions("knowledge-pages", "published"),
          ).map(([k, v]) => [k, v.replace(/published\./g, "historical.")]),
        );
      }
      const expr = versionId
        ? "historical"
        : mode !== "published"
          ? "record"
          : "published";
      const fields = this.select(actor, expressions, true);
      if (
        !versionId &&
        canKnowledge(actor, "knowledge-pages", "update") &&
        canKnowledgeField(actor, "knowledge-pages", "status", "update") &&
        ["status", "title", "content", "contentText", "tags", "attachmentIds"].every(
          (field) => canKnowledgeField(actor, "knowledge-pages", field, "read"),
        )
      )
        fields.push(`${knowledgeUnpublishedChanges} AS "hasUnpublishedChanges"`);
      if (canKnowledgeField(actor, "knowledge-pages", "content", "read"))
        fields.push(
          `${expr}.${expr === "record" ? "working_content_hash" : "content_hash"} AS "contentHash"`,
        );
      fields.push(
        'record.published_version_id AS "internalPublishedVersionId"',
      );
      if (canKnowledgeField(actor, "knowledge-pages", "publishedBy", "read"))
        fields.push(
          `(SELECT display_name FROM users WHERE id=${versionId ? "historical" : "published"}.published_by) AS "publisherName"`,
        );
      const [row] = await m.query(
        `SELECT ${fields.join(",")} FROM knowledge_pages record ${join} WHERE record.id=$2 AND (${scope}) AND (${historic})`,
        params,
      );
      if (!row) throw new NotFoundException("页面不存在或不在授权范围内");
      if (
        canKnowledgeField(actor, "knowledge-pages", "title", "read") &&
        canKnowledgeField(actor, "knowledge-pages", "parentId", "read") &&
        canKnowledgeField(actor, "knowledge-pages", "spaceId", "read") &&
        canKnowledgeField(actor, "knowledge-spaces", "name", "read")
      ) {
        const ancestors = await this.access.ancestors(m, id, actor),
          [space] = await m.query(
            "SELECT id,name FROM knowledge_spaces WHERE tenant_id=$1 AND id=$2",
            [actor.tenantId, row.spaceId],
          );
        row.spaceName = space.name;
        row.breadcrumb = [
          { id: space.id, title: space.name },
          ...ancestors.map((p: KnowledgeRow) => ({
            id: p.id,
            title:
              p.id === id
                ? row.title
                : mode !== "published"
                  ? p.title
                  : p.published_title,
          })),
        ];
      }
      if (
        canKnowledgeField(actor, "knowledge-pages", "tags", "read") &&
        mode !== "published" &&
        !versionId
      )
        row.tags = await this.tagNames(m, id, actor);
      if (canKnowledgeField(actor, "knowledge-pages", "attachmentIds", "read"))
        row.attachments = await this.files(
          m,
          id,
          actor,
          versionId ? "published" : mode,
          versionId ?? row.internalPublishedVersionId,
        );
      if (row.attachments) row.primaryFile = row.attachments.find((f: KnowledgeRow) => f.role === "PRIMARY") ?? null;
      row.canEdit = await this.allowed(m, id, actor, "update", 2);
      if (!row.canEdit) delete row.hasUnpublishedChanges;
      row.canManage = await this.allowed(
        m,
        id,
        actor,
        "update",
        3,
        mode === "trash" ? "trash" : "working",
      );
      if (
        row.canManage &&
        canKnowledgeField(actor, "knowledge-pages", "access", "read")
      ) {
        const [r] = await m.query(
          "SELECT access_restricted FROM knowledge_pages WHERE tenant_id=$1 AND id=$2",
          [actor.tenantId, id],
        );
        row.accessRestricted = r.access_restricted;
        row.access = await m.query(
          'SELECT subject_type AS "subjectType",subject_id AS "subjectId",access_level AS "accessLevel" FROM knowledge_page_access WHERE tenant_id=$1 AND page_id=$2',
          [actor.tenantId, id],
        );
      }
      if (
        canKnowledgeField(actor, "knowledge-pages", "publishedVersion", "read")
      )
        row.publishedVersionId = versionId ?? row.internalPublishedVersionId;
      delete row.internalPublishedVersionId;
      return row;
    });
  }
  versions(id: string, actor: KnowledgeActor, rawMode: unknown = "published") {
    assertKnowledgeFields(
      actor,
      "knowledge-pages",
      ["publishedVersion", "publishedAt", "publishedBy", "title"],
      "read",
    );
    return this.access.transaction(actor, async (m) => {
      const p: unknown[] = [actor.tenantId, knowledgeId(id)];
      const mode = this.mode(rawMode);
      const scope = await this.access.clause(
          actor,
          p,
          mode,
          "read",
          undefined,
          m,
        ),
        historical = this.access.historicalClause(
          actor,
          await this.access.membership(actor, m),
          p,
        );
      const rows = await m.query(
        `SELECT historical.id,historical.version_no AS "publishedVersion",historical.title,historical.published_at AS "publishedAt",historical.published_by AS "publishedBy",u.display_name AS "publisherName" FROM knowledge_pages record ${publishedJoin} JOIN knowledge_page_versions historical ON historical.tenant_id=record.tenant_id AND historical.page_id=record.id LEFT JOIN users u ON u.id=historical.published_by WHERE record.id=$2 AND (${scope}) AND (${historical}) ORDER BY historical.version_no DESC`,
        p,
      );
      return rows;
    });
  }
  attachment(
    id: string,
    input: Record<string, unknown>,
    actor: KnowledgeActor,
  ) {
    assertKnowledgeFields(actor, "knowledge-pages", ["attachmentIds"], "read");
    const mode = this.mode(input.mode);
    return this.access.transaction(actor, async (m) => {
      const p: unknown[] = [actor.tenantId, knowledgeId(id)];
      const scope = await this.access.clause(
        actor,
        p,
        mode,
        "read",
        undefined,
        m,
      );
      let relation = "EXISTS(SELECT 1 FROM knowledge_page_files current_file WHERE current_file.tenant_id=file.tenant_id AND current_file.page_id=file.page_id AND current_file.file_id=file.id)";
      const join = publishedJoin;
      if (mode !== "working" || input.versionId) {
        const index = p.push(
          input.versionId ? knowledgeId(input.versionId) : null,
        );
        const historical = input.versionId
          ? this.access.historicalClause(
              actor,
              await this.access.membership(actor, m),
              p,
            )
          : "true";
        relation = `EXISTS(SELECT 1 FROM knowledge_page_version_files link JOIN knowledge_page_versions historical ON historical.tenant_id=link.tenant_id AND historical.id=link.version_id WHERE link.tenant_id=file.tenant_id AND link.page_id=file.page_id AND link.file_id=file.id AND historical.id=COALESCE($${index}::uuid,record.published_version_id) AND (${historical}))`;
      }
      const [file] = await m.query(
        `SELECT file.storage_key AS key,file.original_name AS "originalName",file.content_type AS "contentType",file.id,file.page_id AS "pageId",file.sha256,file.size FROM knowledge_file_assets file JOIN knowledge_pages record ON record.tenant_id=file.tenant_id AND record.id=file.page_id ${join} WHERE file.tenant_id=$1 AND file.id=$2 AND (${scope}) AND (${relation})`,
        p,
      );
      if (!file) throw new NotFoundException("附件不存在或不在授权范围内");
      return file;
    });
  }
  private breadcrumbExpression(mode: KnowledgeMode) {
    return `(jsonb_build_array(jsonb_build_object('id',record.space_id,'title',(SELECT name FROM knowledge_spaces WHERE tenant_id=record.tenant_id AND id=record.space_id))) ||
    (${this.access.chain()} SELECT COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'title',${mode !== "published" ? "p.title" : "v.title"}) ORDER BY cardinality(chain.visited) DESC),'[]'::jsonb)
      FROM chain JOIN knowledge_pages p ON p.tenant_id=chain.tenant_id AND p.id=chain.id LEFT JOIN knowledge_page_versions v ON v.tenant_id=p.tenant_id AND v.id=p.published_version_id))`;
  }
  private select(
    actor: KnowledgeActor,
    expressions: Record<string, string>,
    detail: boolean,
  ) {
    return Object.entries(expressions)
      .filter(
        ([k]) =>
          ["id", "version"].includes(k) ||
          (canKnowledgeField(actor, "knowledge-pages", k, "read") &&
            (detail ||
              !["content", "contentText", "attachmentIds"].includes(k))),
      )
      .map(([k, v]) => `${v} AS "${k}"`);
  }
  private async allowed(
    m: EntityManager,
    id: string,
    actor: KnowledgeActor,
    action: string,
    minimum: number,
    mode: KnowledgeMode = "working",
  ) {
    if (
      !canKnowledge(actor, "knowledge-pages", action) ||
      !canKnowledge(actor, "knowledge-spaces", "read")
    )
      return false;
    const p: unknown[] = [actor.tenantId, id],
      scope = await this.access.clause(actor, p, mode, action, minimum, m);
    return (
      (
        await m.query(
          `SELECT 1 FROM knowledge_pages record ${publishedJoin} WHERE record.id=$2 AND (${scope})`,
          p,
        )
      ).length > 0
    );
  }
  private files(
    m: EntityManager,
    id: string,
    actor: KnowledgeActor,
    mode: KnowledgeMode,
    versionId: string | null,
  ) {
    const working = mode !== "published";
    return m.query(
      `SELECT file.id,file.page_id AS "pageId",file.original_name AS "originalName",file.content_type AS "contentType",file.size,file.sha256,file.created_at AS "createdAt",link.role
      FROM knowledge_file_assets file JOIN ${working ? "knowledge_page_files" : "knowledge_page_version_files"} link ON link.tenant_id=file.tenant_id AND link.page_id=file.page_id AND link.file_id=file.id
      WHERE file.tenant_id=$1 AND file.page_id=$2 ${working ? "" : "AND link.version_id=$3::uuid"} ORDER BY file.created_at,file.id`,
      working ? [actor.tenantId,id] : [actor.tenantId,id,versionId]);
  }

  private async tagNames(m: EntityManager, id: string, actor: KnowledgeActor) {
    return (
      await m.query(
        "SELECT tag.name FROM knowledge_page_tags link JOIN knowledge_tags tag ON tag.tenant_id=link.tenant_id AND tag.id=link.tag_id WHERE link.tenant_id=$1 AND link.page_id=$2 ORDER BY tag.name",
        [actor.tenantId, id],
      )
    ).map((r: KnowledgeRow) => r.name);
  }
  mode(raw: unknown): KnowledgeMode {
    if (raw == null || raw === "published") return "published";
    if (raw === "working" || raw === "trash") return raw;
    throw new BadRequestException("知识库读取模式无效");
  }
}
