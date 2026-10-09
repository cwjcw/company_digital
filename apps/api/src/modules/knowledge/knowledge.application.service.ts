import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import type { EntityManager } from "typeorm";
import type { KnowledgeAccessEntry, KnowledgePageInput } from "@kdos/contracts";
import { AuditLog } from "../../entities";
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from "../../storage/object-storage";
import {
  KnowledgeAuthorizationService,
  knowledgeAdministrator,
  assertKnowledgeAction,
  assertKnowledgeFields,
  knowledgeDataScope,
} from "./knowledge.scope";
import {
  canonicalKnowledgeContent,
  knowledgeId,
  knowledgeTags,
  knowledgeText,
} from "./knowledge.content";
import { knowledgeFile } from "./knowledge.file";
import {
  publishedJoin,
  type KnowledgeActor,
  type KnowledgeMode,
  type KnowledgeRow,
} from "./knowledge.types";

const pageFields = ["title", "content", "tags", "sortOrder", "description"];
const spaceFields = [
  "code",
  "name",
  "description",
  "icon",
  "sortOrder",
  "status",
];
@Injectable()
export class KnowledgeApplicationService {
  private readonly logger = new Logger(KnowledgeApplicationService.name);
  constructor(
    private readonly access: KnowledgeAuthorizationService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}
  accessTransaction<T>(actor: KnowledgeActor, work: (m: EntityManager) => Promise<T>) { return this.access.transaction(actor, work); }
  command<T>(actor: KnowledgeActor, work: (m: EntityManager) => Promise<T>, uniqueRetries = 0): Promise<T> {
    return this.access
      .transaction(actor, async (m) => {
        await m.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `knowledge-tree:${actor.tenantId}`,
        ]);
        return work(m);
      })
      .catch((e: { code?: string }) => {
        if (e.code === "23505" && uniqueRetries > 0)
          return this.command(actor, work, uniqueRetries - 1);
        if (e.code === "23505")
          throw new BadRequestException("知识空间编码、页面路径或标签重复");
        if (["23503", "23514", "22P02"].includes(e.code ?? ""))
          throw new BadRequestException("知识库关联或树结构无效");
        throw e;
      });
  }
  createSpace(input: Record<string, unknown>, actor: KnowledgeActor) {
    assertKnowledgeAction(actor, "knowledge-spaces", "create");
    this.keys(input, spaceFields.filter((field) => !["code", "status"].includes(field)));
    assertKnowledgeFields(actor, "knowledge-spaces", Object.keys(input));
    return this.command(actor, async (m) => {
      const id = uuidv7(),
        code = `SPACE_${id.replace(/-/g, "")}`,
        name = knowledgeText(input.name, "空间名称", 100, true);
      const [{ nextOrder }] = await m.query(
        'SELECT COALESCE(max(sort_order),0)+10 AS "nextOrder" FROM knowledge_spaces WHERE tenant_id=$1',
        [actor.tenantId],
      );
      await m.query(
        `INSERT INTO knowledge_spaces(id,tenant_id,code,name,description,icon,sort_order,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::uuid,$8::text)`,
        [
          id,
          actor.tenantId,
          code,
          name,
          knowledgeText(input.description, "说明", 2000),
          knowledgeText(input.icon ?? "book", "图标", 50),
          this.sort(input.sortOrder ?? nextOrder),
          actor.userId,
        ],
      );
      // The creator can manage the new space; this does not grant platform actions.
      if (actor.userId)
        await m.query(
          `INSERT INTO knowledge_space_access(tenant_id,space_id,subject_type,subject_id,access_level,created_by,updated_by) VALUES($1,$2,'USER',$3::uuid,'FULL_ACCESS',$3::uuid,$3::text)`,
          [actor.tenantId, id, actor.userId],
        );
      const params: unknown[] = [actor.tenantId, id];
      const scope = knowledgeDataScope(
        actor,
        "knowledge-spaces",
        "create",
        params,
      );
      if (
        !(
          await m.query(
            `SELECT 1 FROM knowledge_spaces record WHERE tenant_id=$1 AND id=$2 AND (${scope})`,
            params,
          )
        ).length
      )
        throw new BadRequestException("新空间不在授权数据范围内");
      await this.audit(m, actor, "knowledge-spaces", id, "space.created", {
        code,
        name,
      });
      return { id, version: 1 };
    }, 2);
  }
  updateSpace(
    id: string,
    input: Record<string, unknown>,
    actor: KnowledgeActor,
  ) {
    this.keys(input, [...spaceFields, "expectedVersion"]);
    assertKnowledgeFields(
      actor,
      "knowledge-spaces",
      Object.keys(input).filter((k) => k !== "expectedVersion"),
    );
    return this.command(actor, async (m) => {
      const row = await this.lockSpace(m, id, actor, "update", 3);
      this.version(row.version, input.expectedVersion);
      const merged = {
        ...Object.fromEntries(
          spaceFields.map((k) => [
            k,
            k === "sortOrder" ? row.sort_order : row[k],
          ]),
        ),
        ...input,
      };
      const code = knowledgeText(merged.code, "空间编码", 64, true);
      if (!/^[A-Za-z0-9_-]+$/.test(code))
        throw new BadRequestException("空间编码无效");
      const status = merged.status;
      if (!["ACTIVE", "ARCHIVED"].includes(String(status)))
        throw new BadRequestException("空间状态无效");
      await m.query(
        `UPDATE knowledge_spaces SET code=$3,name=$4,description=$5,icon=$6,sort_order=$7,status=$8,version=version+1,updated_by=$9,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [
          actor.tenantId,
          id,
          code,
          knowledgeText(merged.name, "空间名称", 100, true),
          knowledgeText(merged.description, "说明", 2000),
          knowledgeText(merged.icon, "图标", 50),
          this.sort(merged.sortOrder),
          status,
          actor.userId,
        ],
      );
      if ("name" in input) await this.rebuildSearch(m, actor, undefined, id);
      await this.audit(m, actor, "knowledge-spaces", id, "space.updated", {
        changedFields: Object.keys(input).filter(
          (k) => k !== "expectedVersion",
        ),
        status,
      });
      return { id, version: row.version + 1 };
    });
  }
  archiveSpace(
    id: string,
    input: Record<string, unknown>,
    actor: KnowledgeActor,
  ) {
    this.keys(input, ["expectedVersion"]);
    assertKnowledgeFields(actor, "knowledge-spaces", ["status"]);
    return this.command(actor, async (m) => {
      const row = await this.lockSpace(m, id, actor, "delete", 3);
      this.version(row.version, input.expectedVersion);
      await m.query(
        "UPDATE knowledge_spaces SET status='ARCHIVED',version=version+1,updated_by=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, id, actor.userId],
      );
      await this.audit(m, actor, "knowledge-spaces", id, "space.archived", {
        retainedPages: true,
      });
      return { id, version: row.version + 1, status: "ARCHIVED" };
    });
  }
  setAccess(
    kind: "space" | "page",
    id: string,
    input: Record<string, unknown>,
    actor: KnowledgeActor,
  ) {
    this.keys(input, ["entries", "restricted", "expectedVersion"]);
    const resource = kind === "space" ? "knowledge-spaces" : "knowledge-pages";
    assertKnowledgeFields(actor, resource, ["access"]);
    return this.command(actor, async (m) => {
      const row =
        kind === "space"
          ? await this.lockSpace(m, id, actor, "update", 3)
          : await this.lockPage(m, id, actor, "update", 3);
      this.version(row.version, input.expectedVersion);
      const entries = await this.accessEntries(m, input.entries);
      if (kind === "page" && typeof input.restricted !== "boolean")
        throw new BadRequestException("请指定继承或限制页面权限");
      const table =
          kind === "space" ? "knowledge_space_access" : "knowledge_page_access",
        column = kind === "space" ? "space_id" : "page_id";
      await m.query(
        `DELETE FROM ${table} WHERE tenant_id=$1 AND ${column}=$2`,
        [actor.tenantId, id],
      );
      if (kind === "space" || input.restricted)
        for (const e of entries)
          await m.query(
            `INSERT INTO ${table}(tenant_id,${column},subject_type,subject_id,access_level,created_by,updated_by) VALUES($1,$2,$3,$4::uuid,$5,$6::uuid,$6::text)`,
            [
              actor.tenantId,
              id,
              e.subjectType,
              e.subjectId,
              e.accessLevel,
              actor.userId,
            ],
          );
      await m.query(
        `UPDATE ${kind === "space" ? "knowledge_spaces" : "knowledge_pages"} SET ${kind === "page" ? "access_restricted=$4," : ""}version=version+1,updated_by=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        kind === "space"
          ? [actor.tenantId, id, actor.userId]
          : [actor.tenantId, id, actor.userId, input.restricted],
      );
      await this.audit(m, actor, resource, id, `${kind}.access_changed`, {
        restricted: input.restricted,
        entries,
      });
      return { id, version: row.version + 1 };
    });
  }
  createPage(input: KnowledgePageInput, actor: KnowledgeActor) {
    return this.command(actor, (m) => this.createPageIn(m, input, actor));
  }
  async createPageIn(
    m: EntityManager,
    input: KnowledgePageInput,
    actor: KnowledgeActor,
    action = "create",
  ) {
    assertKnowledgeAction(actor, "knowledge-pages", action);
    assertKnowledgeFields(actor, "knowledge-pages", [
      "spaceId",
      ...Object.keys(input).filter(
        (k) => pageFields.includes(k) || k === "parentId",
      ),
    ]);
    this.keys(input, ["spaceId", "parentId", "contentMode", ...pageFields]);
    if (input.contentMode && !["RICH_TEXT", "FILE"].includes(input.contentMode)) throw new BadRequestException("内容模式无效");
    const space = await this.lockSpace(
      m,
      knowledgeId(input.spaceId),
      actor,
      "read",
      2,
    );
    if (space.status !== "ACTIVE") throw new BadRequestException("空间已归档");
    const parentId =
      input.parentId == null ? null : knowledgeId(input.parentId);
    if (parentId) {
      const parent = await this.lockPage(m, parentId, actor, action, 2);
      if (parent.space_id !== space.id)
        throw new BadRequestException("父页面必须属于同一空间");
    }
    const id = uuidv7(),
      title = knowledgeText(input.title ?? "未命名页面", "标题", 300, true),
      canonical = canonicalKnowledgeContent(
        input.content ?? { type: "doc", content: [] },
      );
    if (canonical.imageIds.length)
      throw new BadRequestException("新页面图片须先上传到该页面");
    await m.query(
      `INSERT INTO knowledge_pages(id,tenant_id,space_id,parent_id,title,slug,sort_order,working_content,working_content_text,working_content_hash,created_by,updated_by,content_mode,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::uuid,$11::text,$12,$13)`,
      [
        id,
        actor.tenantId,
        space.id,
        parentId,
        title,
        `page-${id}`,
        this.sort(input.sortOrder),
        JSON.stringify(canonical.content),
        canonical.contentText,
        canonical.contentHash,
        actor.userId,
        input.contentMode ?? "RICH_TEXT",
        knowledgeText(input.description, "说明", 4000),
      ],
    );
    await this.tags(m, id, knowledgeTags(input.tags ?? []), actor);
    await this.lockPage(m, id, actor, action, 2);
    await this.audit(m, actor, "knowledge-pages", id, "page.created", {
      spaceId: space.id,
      parentId,
      title,
      contentHash: canonical.contentHash,
    });
    return { id, version: 1 };
  }
  updatePage(
    id: string,
    input: Record<string, unknown>,
    actor: KnowledgeActor,
  ) {
    this.keys(input, [...pageFields, "expectedVersion"]);
    assertKnowledgeFields(
      actor,
      "knowledge-pages",
      Object.keys(input).filter((k) => k !== "expectedVersion"),
    );
    return this.command(actor, (m) => this.updatePageIn(m, id, input, actor));
  }
  async updatePageIn(
    m: EntityManager,
    id: string,
    input: Record<string, unknown>,
    actor: KnowledgeActor,
  ) {
    const row = await this.lockPage(m, id, actor, "update", 2);
    this.version(row.version, input.expectedVersion);
    const canonical = canonicalKnowledgeContent(
      input.content ?? row.working_content,
    );
    await this.validateImages(m, id, canonical.imageIds, actor);
    const title = knowledgeText(input.title ?? row.title, "标题", 300, true);
    const sort =
      input.sortOrder == null ? row.sort_order : this.sort(input.sortOrder);
    await m.query(
      `UPDATE knowledge_pages SET title=$3,sort_order=$4,working_content=$5::jsonb,working_content_text=$6,working_content_hash=$7,description=$9,version=version+1,updated_by=$8,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
      [
        actor.tenantId,
        id,
        title,
        sort,
        JSON.stringify(canonical.content),
        canonical.contentText,
        canonical.contentHash,
        actor.userId,
        knowledgeText(input.description ?? row.description, "说明", 4000),
      ],
    );
    if ("tags" in input)
      await this.tags(m, id, knowledgeTags(input.tags), actor);
    await this.lockPage(m, id, actor, "update", 2);
    await this.audit(m, actor, "knowledge-pages", id, "page.edited", {
      contentHash: canonical.contentHash,
      changedFields: Object.keys(input).filter((k) => k !== "expectedVersion"),
    });
    return { id, version: row.version + 1 };
  }
  publish(id: string, input: Record<string, unknown>, actor: KnowledgeActor) {
    this.keys(input, ["expectedVersion"]);
    assertKnowledgeFields(actor, "knowledge-pages", ["status"]);
    assertKnowledgeFields(
      actor,
      "knowledge-pages",
      ["title", "content", "contentText", "tags", "attachmentIds"],
      "read",
    );
    return this.command(actor, async (m) => {
      const row = await this.lockPage(m, id, actor, "update", 2);
      this.version(row.version, input.expectedVersion);
      const canonical = canonicalKnowledgeContent(row.working_content);
      const primary = await m.query("SELECT asset.sha256 FROM knowledge_page_files link JOIN knowledge_file_assets asset ON asset.tenant_id=link.tenant_id AND asset.id=link.file_id WHERE link.tenant_id=$1 AND link.page_id=$2 AND link.role='PRIMARY'", [actor.tenantId,id]);
      if (row.content_mode === "FILE" && primary.length !== 1) throw new BadRequestException("文件页面必须上传主文件后再发布");
      await this.validateImages(m, id, canonical.imageIds, actor);
      if (row.content_mode === "FILE") canonical.contentHash = createHash("sha256").update(JSON.stringify({content:canonical.contentHash,description:row.description,fileSha256:primary[0].sha256})).digest("hex");
      const ancestry = await this.access.ancestors(m, id, actor);
      if (
        ancestry.some(
          (p: KnowledgeRow) => p.id !== id && p.status !== "PUBLISHED",
        )
      )
        throw new BadRequestException("请先发布上级页面，再发布子页面");
      const [space] = await m.query(
        "SELECT id,name FROM knowledge_spaces WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, row.space_id],
      );
      const breadcrumb = [
        { id: space.id, title: space.name },
        ...ancestry.map((p: KnowledgeRow) => ({
          id: p.id,
          title: p.id === id ? row.title : p.published_title,
        })),
      ];
      const grants = await m.query(
        `SELECT subject_type AS "subjectType",subject_id AS "subjectId",access_level AS "accessLevel" FROM knowledge_space_access WHERE tenant_id=$1 AND space_id=$2`,
        [actor.tenantId, row.space_id],
      );
      const restricted = ancestry
        .filter((p: KnowledgeRow) => p.access_restricted)
        .map((p: KnowledgeRow) => p.id);
      const pageGrants = restricted.length
        ? await m.query(
            `SELECT page_id,subject_type AS "subjectType",subject_id AS "subjectId",access_level AS "accessLevel" FROM knowledge_page_access WHERE tenant_id=$1 AND page_id=ANY($2::uuid[])`,
            [actor.tenantId, restricted],
          )
        : [];
      const snapshot = [
        grants,
        ...restricted.map((pageId: string) =>
          pageGrants
            .filter((g: KnowledgeRow) => g.page_id === pageId)
            .map((g: KnowledgeRow) => ({
              subjectType: g.subjectType,
              subjectId: g.subjectId,
              accessLevel: g.accessLevel,
            })),
        ),
      ];
      const [{ n }] = await m.query(
        "SELECT COALESCE(max(version_no),0)+1 n FROM knowledge_page_versions WHERE tenant_id=$1 AND page_id=$2",
        [actor.tenantId, id],
      );
      const tags = await this.tagNames(m, id, actor),
        versionId = uuidv7();
      const searchText = [
        row.title,
        canonical.contentText,
        ...tags,
        ...breadcrumb.map((b) => b.title),
      ].join("\n");
      await m.query(
        `INSERT INTO knowledge_page_versions(id,tenant_id,page_id,version_no,title,content,content_text,content_hash,tags,breadcrumb,access_snapshot,search_text,published_by,created_by,updated_by,content_mode,description) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13::uuid,$13::uuid,$13::text,$14,$15)`,
        [
          versionId,
          actor.tenantId,
          id,
          n,
          row.title,
          JSON.stringify(canonical.content),
          canonical.contentText,
          canonical.contentHash,
          JSON.stringify(tags),
          JSON.stringify(breadcrumb),
          JSON.stringify(snapshot),
          searchText,
          actor.userId,
          row.content_mode,
          row.description,
        ],
      );
      await m.query(
        `INSERT INTO knowledge_page_version_files(tenant_id,page_id,version_id,file_id,role,created_by,updated_by) SELECT tenant_id,page_id,$3::uuid,file_id,role,$4::uuid,$4::text FROM knowledge_page_files WHERE tenant_id=$1 AND page_id=$2`,
        [actor.tenantId, id, versionId, actor.userId],
      );
      await m.query(
        `UPDATE knowledge_pages SET status='PUBLISHED',published_version_id=$3,version=version+1,updated_by=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [actor.tenantId, id, versionId, actor.userId],
      );
      await this.rebuildSearch(m, actor, id);
      await this.audit(m, actor, "knowledge-pages", id, "page.published", {
        versionId,
        versionNo: n,
        contentHash: canonical.contentHash,
      });
      return {
        id,
        version: row.version + 1,
        publishedVersion: n,
        publishedVersionId: versionId,
      };
    });
  }
  move(id: string, input: Record<string, unknown>, actor: KnowledgeActor) {
    this.keys(input, ["parentId", "spaceId", "sortOrder", "expectedVersion"]);
    assertKnowledgeFields(actor, "knowledge-pages", [
      "parentId",
      "spaceId",
      "sortOrder",
    ]);
    return this.command(actor, async (m) => {
      const row = await this.lockPage(m, id, actor, "update", 2);
      this.version(row.version, input.expectedVersion);
      const spaceId =
          input.spaceId == null ? row.space_id : knowledgeId(input.spaceId),
        parentId = input.parentId == null ? null : knowledgeId(input.parentId);
      if (parentId === id)
        throw new BadRequestException("不能将页面移到自己下面");
      const descendants = await this.descendants(m, id, actor),
        ids = descendants.map((r: KnowledgeRow) => r.id);
      if (parentId && ids.includes(parentId))
        throw new BadRequestException("不能将页面移到自己的后代下面");
      const destination = await this.lockSpace(m, spaceId, actor, "read", 2);
      if (destination.status !== "ACTIVE")
        throw new BadRequestException("目标空间已归档");
      if (parentId) {
        const parent = await this.lockPage(m, parentId, actor, "create", 2);
        if (parent.space_id !== spaceId)
          throw new BadRequestException("目标父页面不属于目标空间");
      }
      const sourceParams: unknown[] = [actor.tenantId, ids],
        sourceScope = await this.access.clause(
          actor,
          sourceParams,
          "working",
          "update",
          2,
          m,
        );
      if (
        (
          await m.query(
            `SELECT record.id FROM knowledge_pages record ${publishedJoin} WHERE record.id=ANY($2::uuid[]) AND (${sourceScope})`,
            sourceParams,
          )
        ).length !== ids.length
      )
        throw new BadRequestException("移动需要整个子树的编辑权限");
      if (spaceId !== row.space_id) {
        assertKnowledgeAction(actor, "knowledge-pages", "create");
        const params: unknown[] = [actor.tenantId, ids];
        const allowed = await this.access.clause(
          actor,
          params,
          "working",
          "update",
          3,
          m,
        );
        const visible = await m.query(
          `SELECT record.id FROM knowledge_pages record ${publishedJoin} WHERE record.id=ANY($2::uuid[]) AND (${allowed})`,
          params,
        );
        if (visible.length !== ids.length)
          throw new BadRequestException("跨空间移动需要整个子树的完全管理权限");
        await this.lockSpace(m, spaceId, actor, "read", 3);
      }
      await m.query(
        `UPDATE knowledge_pages SET parent_id=$3,sort_order=$4,version=version+1,updated_by=$5,updated_at=now() WHERE tenant_id=$1 AND id=$2`,
        [
          actor.tenantId,
          id,
          parentId,
          this.sort(input.sortOrder ?? row.sort_order),
          actor.userId,
        ],
      );
      if (spaceId !== row.space_id)
        await m.query(
          `UPDATE knowledge_pages SET space_id=$3,version=version+1,updated_by=$4,updated_at=now() WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,
          [actor.tenantId, ids, spaceId, actor.userId],
        );
      await this.lockPage(m, id, actor, "update", 2);
      // Enforce destination platform scopes for the whole moved subtree, not just the root.
      if (spaceId !== row.space_id) {
        const params: unknown[] = [actor.tenantId, ids];
        const scope = await this.access.clause(
          actor,
          params,
          "working",
          "create",
          2,
          m,
        );
        if (
          (
            await m.query(
              `SELECT record.id FROM knowledge_pages record ${publishedJoin} WHERE record.id=ANY($2::uuid[]) AND (${scope})`,
              params,
            )
          ).length !== ids.length
        )
          throw new BadRequestException("目标子树不在授权数据范围内");
      }
      await this.rebuildSearch(m, actor, id);
      await this.audit(m, actor, "knowledge-pages", id, "page.moved", {
        fromSpaceId: row.space_id,
        toSpaceId: spaceId,
        parentId,
        affectedCount: ids.length,
      });
      return {
        id,
        version: row.version + 1 + (spaceId !== row.space_id ? 1 : 0),
      };
    });
  }
  transition(
    id: string,
    kind: "archive" | "unarchive" | "trash" | "restore",
    input: Record<string, unknown>,
    actor: KnowledgeActor,
  ) {
    this.keys(input, ["expectedVersion"]);
    const action = kind === "trash" ? "delete" : "update";
    assertKnowledgeFields(actor, "knowledge-pages", ["status"]);
    return this.command(actor, async (m) => {
      const mode = kind === "restore" ? "trash" : "working";
      const row = await this.lockPage(m, id, actor, action, 3, mode);
      this.version(row.version, input.expectedVersion);
      if (kind === "unarchive" && row.status !== "ARCHIVED")
        throw new BadRequestException("仅归档页面可以恢复发布状态");
      const descendants = await this.descendants(m, id, actor);
      // Restore only nodes trashed by this batch; earlier separately trashed children stay in Trash.
      const targets =
        kind === "restore"
          ? descendants.filter(
              (r: KnowledgeRow) =>
                r.status === "TRASHED" &&
                r.trash_batch_id === row.trash_batch_id,
            )
          : descendants.filter((r: KnowledgeRow) => r.status !== "TRASHED");
      const ids = targets.map((r: KnowledgeRow) => r.id),
        params: unknown[] = [actor.tenantId, ids];
      const scope = await this.access.clause(actor, params, mode, action, 3, m);
      const allowed = await m.query(
        `SELECT record.id FROM knowledge_pages record ${publishedJoin} WHERE record.id=ANY($2::uuid[]) AND (${scope})`,
        params,
      );
      if (allowed.length !== targets.length)
        throw new BadRequestException("操作需要整个受影响子树的完全管理权限");
      if (
        kind === "archive" &&
        targets.some((r: KnowledgeRow) => r.status !== "PUBLISHED")
      )
        throw new BadRequestException(
          "仅已发布的完整子树可以归档，请先发布草稿",
        );
      if ((kind === "restore" || kind === "unarchive") && row.parent_id) {
        const parent = await this.lockPage(
          m,
          row.parent_id,
          actor,
          "update",
          3,
        );
        if (kind === "unarchive" && parent.status !== "PUBLISHED")
          throw new BadRequestException("请先恢复上级页面的发布状态");
      }
      const state =
        kind === "archive"
          ? "status='ARCHIVED'"
          : kind === "unarchive"
            ? "status=CASE WHEN status='ARCHIVED' THEN 'PUBLISHED' ELSE status END"
            : kind === "trash"
              ? "status_before_trash=status,status='TRASHED',trashed_at=now(),trash_batch_id=$4::uuid"
              : "status=COALESCE(status_before_trash,'DRAFT'),status_before_trash=NULL,trashed_at=NULL,trash_batch_id=NULL";
      await m.query(
        `UPDATE knowledge_pages SET ${state},version=version+1,updated_by=$3,updated_at=now() WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,
        kind === "trash"
          ? [actor.tenantId, ids, actor.userId, uuidv7()]
          : [actor.tenantId, ids, actor.userId],
      );
      await this.audit(m, actor, "knowledge-pages", id, `page.${kind}`, {
        affectedCount: targets.length,
      });
      return { id, version: row.version + 1 };
    });
  }
  async purge(
    id: string,
    input: Record<string, unknown>,
    actor: KnowledgeActor,
  ) {
    this.keys(input, ["expectedVersion"]);
    const keys: string[] = [];
    const result = await this.command(actor, async (m) => {
      const row = await this.lockPage(m, id, actor, "delete", 3, "trash");
      this.version(row.version, input.expectedVersion);
      const ids = (await this.descendants(m, id, actor)).map(
        (r: KnowledgeRow) => r.id,
      );
      const params: unknown[] = [actor.tenantId, ids];
      const scope = await this.access.clause(
        actor,
        params,
        "trash",
        "delete",
        3,
        m,
      );
      if (
        (
          await m.query(
            `SELECT record.id FROM knowledge_pages record ${publishedJoin} WHERE record.id=ANY($2::uuid[]) AND (${scope})`,
            params,
          )
        ).length !== ids.length
      )
        throw new BadRequestException("只能永久删除整个已授权的回收站子树");
      const files = await m.query(
        "SELECT storage_key FROM knowledge_file_assets WHERE tenant_id=$1 AND page_id=ANY($2::uuid[]) UNION SELECT preview.storage_key FROM knowledge_file_previews preview JOIN knowledge_file_assets asset ON asset.tenant_id=preview.tenant_id AND asset.id=preview.file_id WHERE asset.tenant_id=$1 AND asset.page_id=ANY($2::uuid[]) AND preview.storage_key IS NOT NULL",
        [actor.tenantId, ids],
      );
      keys.push(...files.map((f: KnowledgeRow) => f.storage_key));
      await m.query(
        "SELECT set_config('app.knowledge_purge','authorized',true)",
      );
      await m.query(
        "DELETE FROM knowledge_page_version_files WHERE tenant_id=$1 AND page_id=ANY($2::uuid[])",
        [actor.tenantId, ids],
      );
      await m.query(
        "UPDATE knowledge_pages SET published_version_id=NULL WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
        [actor.tenantId, ids],
      );
      await m.query(
        "DELETE FROM knowledge_pages WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
        [actor.tenantId, ids],
      );
      await this.enqueueCleanup(m, keys, actor);
      await this.audit(
        m,
        actor,
        "knowledge-pages",
        id,
        "page.permanently_deleted",
        { pageCount: ids.length, storageObjects: keys.length },
      );
      return { id };
    });
    const cleanup = await this.processCleanup(actor);
    return { ...result, cleanupPending: cleanup.pending };
  }
  async uploadIn(
    m: EntityManager,
    id: string,
    file: Express.Multer.File,
    actor: KnowledgeActor,
  ) {
    const [{ count }] = await m.query(
      "SELECT count(*)::int count FROM knowledge_page_files WHERE tenant_id=$1 AND page_id=$2",
      [actor.tenantId, id],
    );
    if (count >= 20) throw new BadRequestException("每页面最多20个附件");
    const f = await knowledgeFile(file),
      attachmentId = uuidv7();
    let key: string | undefined;
    try {
      key = (
        await this.storage.put({
          key: `knowledge/${Buffer.from(actor.tenantId).toString("hex")}/${id}/${attachmentId}`,
          body: f.body,
          contentType: f.contentType,
          visibility: "private",
        })
      ).key;
      const sha256 = createHash("sha256").update(f.body).digest("hex");
      const [row] = await m.query(
        `INSERT INTO knowledge_file_assets(id,tenant_id,page_id,original_name,storage_key,content_type,size,sha256,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid,$9::text) RETURNING created_at AS "createdAt"`,
        [
          attachmentId,
          actor.tenantId,
          id,
          f.name,
          key,
          f.contentType,
          f.body.length,
          sha256,
          actor.userId,
        ],
      );
      await m.query("INSERT INTO knowledge_page_files(tenant_id,page_id,file_id,role) VALUES($1,$2,$3,$4)", [actor.tenantId,id,attachmentId,f.contentType.startsWith("image/")?"INLINE":"SUPPLEMENTAL"]);
      await this.audit(m, actor, "knowledge-pages", id, "attachment.uploaded", {
        attachmentId,
        originalName: f.name,
        size: f.body.length,
        sha256,
      });
      return {
        key,
        attachment: {
          id: attachmentId,
          pageId: id,
          originalName: f.name,
          contentType: f.contentType,
          size: f.body.length,
          sha256,
          createdAt: row.createdAt,
        },
      };
    } catch (e) {
      if (key)
        await this.storage
          .delete(key)
          .catch(() => this.logger.error("知识附件创建失败清理异常"));
      throw e;
    }
  }
  removeAttachment(
    id: string,
    input: Record<string, unknown>,
    actor: KnowledgeActor,
  ) {
    this.keys(input, ["expectedVersion"]);
    assertKnowledgeFields(actor, "knowledge-pages", ["attachmentIds"]);
    return this.command(actor, async (m) => {
      const [file] = await m.query(
        "SELECT * FROM knowledge_file_assets WHERE tenant_id=$1 AND id=$2 AND EXISTS(SELECT 1 FROM knowledge_page_files link WHERE link.tenant_id=knowledge_file_assets.tenant_id AND link.file_id=knowledge_file_assets.id)",
        [actor.tenantId, knowledgeId(id)],
      );
      if (!file) throw new NotFoundException("附件不存在");
      const page = await this.lockPage(m, file.page_id, actor, "update", 2);
      this.version(page.version, input.expectedVersion);
      if (canonicalKnowledgeContent(page.working_content).imageIds.includes(id))
        throw new BadRequestException(
          "请先从正文移除图片并等待自动保存，再移除附件",
        );
      if ((await m.query("SELECT 1 FROM knowledge_page_files WHERE tenant_id=$1 AND file_id=$2 AND role='PRIMARY'",[actor.tenantId,id])).length) throw new BadRequestException("请替换主文件，不能直接移除");
      await m.query("DELETE FROM knowledge_page_files WHERE tenant_id=$1 AND file_id=$2", [actor.tenantId,id]);
      await m.query(
        "UPDATE knowledge_file_assets SET updated_by=$3,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, id, actor.userId],
      );
      await m.query(
        "UPDATE knowledge_pages SET version=version+1,updated_at=now(),updated_by=$3 WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, page.id, actor.userId],
      );
      await this.audit(
        m,
        actor,
        "knowledge-pages",
        page.id,
        "attachment.detached",
        { attachmentId: id, retainedForHistory: true },
      );
      return { id, version: page.version + 1 };
    });
  }
  async cleanOrphans(actor: KnowledgeActor) {
    assertKnowledgeAction(actor, "knowledge-pages", "delete");
    const keys = await this.command(actor, async (m) => {
      const params: unknown[] = [actor.tenantId];
      const scope = await this.access.clause(
        actor,
        params,
        "working",
        "delete",
        3,
        m,
      );
      const files = await m.query(
        `SELECT file.id,file.storage_key,record.id page_id FROM knowledge_file_assets file JOIN knowledge_pages record ON record.tenant_id=file.tenant_id AND record.id=file.page_id ${publishedJoin}
        WHERE (${scope}) AND NOT EXISTS(SELECT 1 FROM knowledge_page_files current_file WHERE current_file.tenant_id=file.tenant_id AND current_file.file_id=file.id) AND NOT EXISTS(SELECT 1 FROM knowledge_page_version_files link WHERE link.tenant_id=file.tenant_id AND link.file_id=file.id) FOR UPDATE OF file`,
        params,
      );
      const derived = files.length ? await m.query("SELECT preview.storage_key FROM knowledge_file_previews preview WHERE preview.tenant_id=$1 AND preview.file_id=ANY($2::uuid[]) AND preview.storage_key IS NOT NULL", [actor.tenantId,files.map((f: KnowledgeRow)=>f.id)]) : [];
      await this.enqueueCleanup(m, derived.map((f: KnowledgeRow)=>f.storage_key),actor);
      if (files.length)
        await m.query(
          "DELETE FROM knowledge_file_assets WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
          [actor.tenantId, files.map((f: KnowledgeRow) => f.id)],
        );
      await this.enqueueCleanup(
        m,
        files.map((f: KnowledgeRow) => f.storage_key),
        actor,
      );
      await this.audit(
        m,
        actor,
        "knowledge-pages",
        null,
        "attachment.orphans_cleaned",
        { count: files.length },
      );
      return files.map((f: KnowledgeRow) => f.storage_key) as string[];
    });
    await this.reconcileStorageOrphans(actor);
    const cleanup = await this.processCleanup(actor);
    return { removed: keys.length, cleanupPending: cleanup.pending };
  }
  /** Mutable search projection references immutable published bodies; draft text never enters it. */
  async rebuildSearch(
    m: EntityManager,
    actor: KnowledgeActor,
    pageId?: string,
    spaceId?: string,
  ) {
    await m.query(
      `WITH RECURSIVE targets AS (
      SELECT id FROM knowledge_pages WHERE tenant_id=$1 AND ($2::uuid IS NULL OR id=$2) AND ($3::uuid IS NULL OR space_id=$3)
      UNION ALL SELECT child.id FROM knowledge_pages child JOIN targets parent ON child.parent_id=parent.id WHERE child.tenant_id=$1 AND $2::uuid IS NOT NULL)
      UPDATE knowledge_pages page SET published_search_text=concat_ws(E'\n',v.title,v.content_text,v.description,(SELECT string_agg(asset.original_name,E'\n') FROM knowledge_page_version_files link JOIN knowledge_file_assets asset ON asset.tenant_id=link.tenant_id AND asset.id=link.file_id WHERE link.tenant_id=v.tenant_id AND link.version_id=v.id AND link.role='PRIMARY'),(SELECT string_agg(tag,E'\n') FROM jsonb_array_elements_text(v.tags) tag),space.name,
        (WITH RECURSIVE ancestors AS (SELECT parent_id FROM knowledge_pages WHERE tenant_id=page.tenant_id AND id=page.id UNION ALL SELECT p.parent_id FROM knowledge_pages p JOIN ancestors a ON p.id=a.parent_id WHERE p.tenant_id=page.tenant_id)
        SELECT string_agg(published.title,E'\n') FROM ancestors a JOIN knowledge_pages p ON p.tenant_id=page.tenant_id AND p.id=a.parent_id JOIN knowledge_page_versions published ON published.tenant_id=p.tenant_id AND published.id=p.published_version_id))
      FROM knowledge_page_versions v,knowledge_spaces space WHERE page.tenant_id=$1 AND page.id IN (SELECT id FROM targets) AND v.tenant_id=page.tenant_id AND v.id=page.published_version_id AND space.tenant_id=page.tenant_id AND space.id=page.space_id`,
      [actor.tenantId, pageId ?? null, spaceId ?? null],
    );
  }
  async enqueueCleanup(
    m: EntityManager,
    keys: string[],
    actor: KnowledgeActor,
  ) {
    if (keys.length)
      await m.query(
        `INSERT INTO knowledge_storage_cleanup(tenant_id,storage_key,created_by,updated_by) SELECT $1::varchar,key,$3::uuid,$3::text FROM unnest($2::text[]) key ON CONFLICT(storage_key) DO NOTHING`,
        [actor.tenantId, keys, actor.userId],
      );
  }
  async processCleanup(actor: KnowledgeActor) {
    return this.access.transaction(actor, async (m) => {
      const p: unknown[] = [actor.tenantId];
      const own = knowledgeAdministrator(actor)
        ? "true"
        : `created_by=$${p.push(actor.userId)}::uuid`;
      const entries = await m.query(
        `SELECT id,storage_key FROM knowledge_storage_cleanup WHERE tenant_id=$1 AND (${own}) ORDER BY created_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`,
        p,
      );
      let removed = 0;
      for (const row of entries) {
        try {
          await this.storage.delete(row.storage_key);
          await m.query(
            "DELETE FROM knowledge_storage_cleanup WHERE tenant_id=$1 AND id=$2",
            [actor.tenantId, row.id],
          );
          removed++;
        } catch {
          await m.query(
            "UPDATE knowledge_storage_cleanup SET attempts=attempts+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",
            [actor.tenantId, row.id],
          );
          this.logger.warn("知识库私有对象清理失败，任务已保留待重试");
        }
      }
      const [{ pending }] = await m.query(
        `SELECT count(*)::int pending FROM knowledge_storage_cleanup WHERE tenant_id=$1 AND (${own})`,
        p,
      );
      return { removed, pending };
    });
  }
  async reconcileStorageOrphans(actor: KnowledgeActor) {
    if (!knowledgeAdministrator(actor) || !this.storage.listPrivateKeys)
      return { queued: 0 };
    return this.command(actor, async (m) => {
      const known = new Set<string>(
        (
          await m.query(
            "SELECT storage_key FROM knowledge_file_assets WHERE tenant_id=$1 UNION SELECT storage_key FROM knowledge_storage_cleanup WHERE tenant_id=$1",
            [actor.tenantId],
          )
        ).map((r: KnowledgeRow) => r.storage_key),
      );
      let queued = 0;
      let batch: string[] = [];
      const flush = async () => {
        if (batch.length) {
          await this.enqueueCleanup(m, batch, actor);
          queued += batch.length;
          batch = [];
        }
      };
      // This tenant lock excludes in-flight uploads, whose storage object may precede its DB insert.
      for await (const key of this.storage.listPrivateKeys!(
        `knowledge/${Buffer.from(actor.tenantId).toString("hex")}`,
      )) {
        if (known.has(key)) continue;
        known.add(key);
        batch.push(key);
        if (batch.length === 200) await flush();
      }
      await flush();
      if (queued)
        await this.audit(
          m,
          actor,
          "knowledge-pages",
          null,
          "attachment.storage_orphans_reconciled",
          { count: queued },
        );
      return { queued };
    });
  }
  @Interval(60000)
  async retryStorageCleanup() {
    const actor: KnowledgeActor = {
      tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN",
      userId: null,
      username: "knowledge-cleanup",
      permissions: ["*"],
      isSystemAdmin: true,
      requestId: "knowledge-storage-cleanup",
      source: "api",
    };
    try {
      await this.reconcileStorageOrphans(actor);
      await this.processCleanup(actor);
    } catch {
      this.logger.warn("知识库清理任务暂不可用，将稍后重试");
    }
  }
  async lockSpace(
    m: EntityManager,
    id: string,
    actor: KnowledgeActor,
    action: string,
    minimum: number,
  ) {
    knowledgeId(id);
    const params: unknown[] = [actor.tenantId, id];
    const scope = await this.access.spaceClause(
      actor,
      params,
      action,
      minimum,
      m,
    );
    const [row] = await m.query(
      `SELECT record.* FROM knowledge_spaces record WHERE record.id=$2 AND (${scope}) FOR UPDATE`,
      params,
    );
    if (!row) throw new NotFoundException("知识空间不存在或不在授权范围内");
    return row as KnowledgeRow;
  }
  async lockPage(
    m: EntityManager,
    id: string,
    actor: KnowledgeActor,
    action: string,
    minimum: number,
    mode: KnowledgeMode = "working",
  ) {
    knowledgeId(id);
    const params: unknown[] = [actor.tenantId, id];
    const scope = await this.access.clause(
      actor,
      params,
      mode,
      action,
      minimum,
      m,
    );
    const [row] = await m.query(
      `SELECT record.* FROM knowledge_pages record ${publishedJoin} WHERE record.id=$2 AND (${scope}) FOR UPDATE OF record`,
      params,
    );
    if (!row) throw new NotFoundException("页面不存在或不在授权范围内");
    return row as KnowledgeRow;
  }
  descendants(m: EntityManager, id: string, actor: KnowledgeActor) {
    return m.query(
      `WITH RECURSIVE descendants AS (SELECT *,ARRAY[id] visited FROM knowledge_pages WHERE tenant_id=$1 AND id=$2
    UNION ALL SELECT p.*,d.visited||p.id FROM knowledge_pages p JOIN descendants d ON p.parent_id=d.id AND p.tenant_id=d.tenant_id WHERE NOT p.id=ANY(d.visited)) SELECT * FROM descendants`,
      [actor.tenantId, id],
    );
  }
  async validateImages(
    m: EntityManager,
    id: string,
    ids: string[],
    actor: KnowledgeActor,
  ) {
    if (!ids.length) return;
    const files = await m.query(
      "SELECT id FROM knowledge_file_assets WHERE tenant_id=$1 AND page_id=$2 AND id=ANY($3::uuid[]) AND EXISTS(SELECT 1 FROM knowledge_page_files pf WHERE pf.tenant_id=knowledge_file_assets.tenant_id AND pf.page_id=knowledge_file_assets.page_id AND pf.file_id=knowledge_file_assets.id) AND content_type IN ('image/png','image/jpeg','image/webp')",
      [actor.tenantId, id, ids],
    );
    if (files.length !== ids.length)
      throw new BadRequestException("正文图片必须是当前页面的有效私有图片");
  }
  async tags(
    m: EntityManager,
    id: string,
    tags: string[],
    actor: KnowledgeActor,
  ) {
    await m.query(
      "DELETE FROM knowledge_page_tags WHERE tenant_id=$1 AND page_id=$2",
      [actor.tenantId, id],
    );
    if (!tags.length) return;
    await m.query(
      `INSERT INTO knowledge_tags(tenant_id,name,created_by,updated_by) SELECT $1::varchar,name,$3::uuid,$3::text FROM unnest($2::text[]) name ON CONFLICT(tenant_id,name) DO NOTHING`,
      [actor.tenantId, tags, actor.userId],
    );
    await m.query(
      `INSERT INTO knowledge_page_tags(tenant_id,page_id,tag_id,created_by,updated_by) SELECT $1::varchar,$2::uuid,id,$4::uuid,$4::text FROM knowledge_tags WHERE tenant_id=$1 AND name=ANY($3::text[])`,
      [actor.tenantId, id, tags, actor.userId],
    );
  }
  async tagNames(
    m: EntityManager,
    id: string,
    actor: KnowledgeActor,
  ): Promise<string[]> {
    return (
      await m.query(
        "SELECT tag.name FROM knowledge_page_tags link JOIN knowledge_tags tag ON tag.tenant_id=link.tenant_id AND tag.id=link.tag_id WHERE link.tenant_id=$1 AND link.page_id=$2 ORDER BY tag.name",
        [actor.tenantId, id],
      )
    ).map((r: KnowledgeRow) => r.name);
  }
  async accessEntries(
    m: EntityManager,
    value: unknown,
  ): Promise<KnowledgeAccessEntry[]> {
    if (!Array.isArray(value) || value.length > 200)
      throw new BadRequestException("权限成员列表无效或过长");
    const entries: KnowledgeAccessEntry[] = [];
    const seen = new Set<string>();
    for (const raw of value) {
      if (
        !raw ||
        typeof raw !== "object" ||
        !["ALL", "USER", "ROLE", "ORGANIZATION"].includes(raw.subjectType) ||
        !["VIEWER", "EDITOR", "FULL_ACCESS"].includes(raw.accessLevel)
      )
        throw new BadRequestException("权限成员无效");
      const id = raw.subjectType === "ALL" ? null : knowledgeId(raw.subjectId);
      const key = raw.subjectType + id;
      if (seen.has(key)) throw new BadRequestException("权限成员重复");
      seen.add(key);
      entries.push({
        subjectType: raw.subjectType,
        subjectId: id,
        accessLevel: raw.accessLevel,
      });
    }
    for (const type of ["USER", "ROLE", "ORGANIZATION"]) {
      const ids = entries
        .filter((e) => e.subjectType === type)
        .map((e) => e.subjectId);
      if (!ids.length) continue;
      const table =
          type === "USER"
            ? "users"
            : type === "ROLE"
              ? "roles"
              : "organization_units",
        valid =
          type === "ROLE"
            ? "permission_group_resource IS NULL"
            : "enabled=true";
      if (
        (
          await m.query(
            `SELECT id FROM ${table} WHERE id=ANY($1::uuid[]) AND ${valid}`,
            [ids],
          )
        ).length !== ids.length
      )
        throw new BadRequestException("权限成员不存在、已停用或不是普通角色");
    }
    return entries;
  }
  sort(value: unknown = 0) {
    if (!Number.isInteger(value) || Math.abs(Number(value)) > 1000000)
      throw new BadRequestException("排序无效");
    return Number(value);
  }
  version(current: number, expected: unknown) {
    const n = Number(expected);
    if (
      !["number", "string"].includes(typeof expected) ||
      !Number.isInteger(n) ||
      n < 1
    )
      throw new BadRequestException("缺少有效数据版本");
    if (n !== current)
      throw new ConflictException({
        message: "数据已被其他人修改，请保留本地修改并重新加载",
        currentVersion: current,
      });
  }
  keys(input: unknown, allowed: string[]) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some((k) => !allowed.includes(k))
    )
      throw new BadRequestException("请求包含不支持的字段");
  }
  audit(
    m: EntityManager,
    actor: KnowledgeActor,
    resource: string,
    id: string | null,
    action: string,
    after: unknown,
  ) {
    return m.save(AuditLog, {
      tenantId: actor.tenantId,
      actorId: actor.userId,
      actorName: actor.displayName ?? actor.username,
      resource,
      recordId: id,
      action: `knowledge.${action}`,
      afterJson: after,
      requestId: actor.requestId,
      source: actor.source ?? "web",
      updatedBy: actor.userId ?? actor.username,
    });
  }
}
