import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import sharp from "sharp";
import type { EntityManager } from "typeorm";
import type { KnowledgeArticleInput, KnowledgeVisibility } from "@kdos/contracts";
import { AuditLog } from "../../entities";
import { OBJECT_STORAGE, type ObjectStorage } from "../../storage/object-storage";
import { KnowledgeAccessService, assertKnowledgeAction, assertKnowledgeFields, knowledgeDataScope } from "./knowledge.scope";
import { canonicalKnowledgeContent, knowledgeId, knowledgeIds, knowledgeTags, knowledgeText, knowledgeVisibility } from "./knowledge.content";
import { articleColumns, type KnowledgeActor, type KnowledgeRow } from "./knowledge.types";

const articleFields = ["title", "summary", "categoryId", "content", "tags", "visibility", "attachmentIds"];
const categoryFields = ["name", "description", "sortOrder", "enabled"];
@Injectable()
export class KnowledgeApplicationService {
  private readonly logger = new Logger(KnowledgeApplicationService.name);
  constructor(private readonly access: KnowledgeAccessService, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}
  createCategory(input: Record<string, unknown>, actor: KnowledgeActor) {
    assertKnowledgeAction(actor, "knowledge-categories", "create"); this.keys(input, [...categoryFields, "parentId"]);
    return this.command(actor, async (manager) => {
      const parentId = knowledgeId(input.parentId); const parent = await this.lockCategory(manager, parentId, actor, "read");
      if (parent.level !== 1 || !parent.enabled) throw new BadRequestException("只能在启用的一级分类下新增二级分类");
      const value = this.categoryInput(input); const id = uuidv7();
      await manager.query(`INSERT INTO knowledge_categories(id,tenant_id,parent_id,level,code,name,description,sort_order,enabled,created_by,updated_by) VALUES($1,$2,$3,2,$4,$5,$6,$7,$8,$9::uuid,$9::text)`, [id, actor.tenantId, parentId, `CAT-${id}`, value.name, value.description, value.sortOrder, value.enabled, actor.userId]);
      await this.assertCategoryScope(manager, id, actor, "create");
      await this.audit(manager, actor, "knowledge-categories", id, "category.created", null, value); return { id, version: 1 };
    });
  }
  updateCategory(id: string, input: Record<string, unknown>, actor: KnowledgeActor) {
    assertKnowledgeAction(actor, "knowledge-categories", "update"); this.keys(input, [...categoryFields, "expectedVersion"]);
    return this.command(actor, async (manager) => {
      const row = await this.lockCategory(manager, id, actor, "update"); this.version(row.version, input.expectedVersion);
      const changed = categoryFields.filter((key) => key in input); assertKnowledgeFields(actor, "knowledge-categories", changed);
      const value = this.categoryInput({ name: row.name, description: row.description, sortOrder: row.sort_order, enabled: row.enabled, ...input });
      await manager.query(`UPDATE knowledge_categories SET name=$3,description=$4,sort_order=$5,enabled=$6,version=version+1,updated_by=$7,updated_at=now() WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id, value.name, value.description, value.sortOrder, value.enabled, actor.userId]);
      await this.assertCategoryScope(manager, id, actor, "update");
      await this.audit(manager, actor, "knowledge-categories", id, value.enabled !== row.enabled ? "category.enabled_changed" : "category.updated", { name: row.name, enabled: row.enabled, version: row.version }, value); return { id, version: row.version + 1 };
    });
  }
  deleteCategory(id: string, input: { expectedVersion?: unknown }, actor: KnowledgeActor) {
    assertKnowledgeAction(actor, "knowledge-categories", "delete");
    this.keys(input, ["expectedVersion"]);
    return this.command(actor, async (manager) => {
      const row = await this.lockCategory(manager, id, actor, "delete"); this.version(row.version, input.expectedVersion);
      const used = await manager.query(`SELECT 1 FROM knowledge_categories WHERE tenant_id=$1 AND parent_id=$2 UNION ALL SELECT 1 FROM knowledge_articles WHERE tenant_id=$1 AND category_id=$2 UNION ALL SELECT 1 FROM knowledge_article_versions WHERE tenant_id=$1 AND category_id=$2 LIMIT 1`, [actor.tenantId, id]);
      if (used.length || row.level === 1) throw new BadRequestException("一级分类或已使用分类不能删除，请停用");
      await manager.query(`DELETE FROM knowledge_categories WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id]); await this.audit(manager, actor, "knowledge-categories", id, "category.deleted", { name: row.name }, null); return { id };
    });
  }
  createArticle(input: KnowledgeArticleInput, actor: KnowledgeActor) {
    assertKnowledgeAction(actor, "knowledge-articles", "create"); this.keys(input, articleFields);
    return this.command(actor, async (manager) => {
      const id = uuidv7(); const value = await this.articleInput(manager, id, input, actor);
      if (value.attachmentIds.length) throw new BadRequestException("请先保存草稿再上传附件");
      await manager.query(`INSERT INTO knowledge_articles(id,tenant_id,category_id,title,summary,content,content_text,content_hash,search_text,visibility,attachment_ids,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11::jsonb,$12::uuid,$12::text)`, [id, actor.tenantId, value.categoryId, value.title, value.summary, JSON.stringify(value.content), value.contentText, value.contentHash, value.searchText, JSON.stringify(value.visibility), "[]", actor.userId]);
      await this.tags(manager, id, value.tags, actor); await this.lockArticle(manager, id, actor, "create");
      await this.audit(manager, actor, "knowledge-articles", id, "article.created", null, this.summary(value)); return { id, version: 1 };
    });
  }
  updateArticle(id: string, input: Partial<KnowledgeArticleInput>, actor: KnowledgeActor) {
    assertKnowledgeAction(actor, "knowledge-articles", "update"); this.keys(input, [...articleFields, "expectedVersion"]);
    return this.command(actor, async (manager) => {
      const row = await this.lockArticle(manager, id, actor, "update"); this.version(row.version, input.expectedVersion);
      const fields = articleFields.filter((key) => key in input); assertKnowledgeFields(actor, "knowledge-articles", fields);
      const oldTags = await this.tagNames(manager, id, actor);
      const value = await this.articleInput(manager, id, { ...this.workingInput(row), tags: oldTags, ...input } as KnowledgeArticleInput, actor);
      await manager.query(`UPDATE knowledge_articles SET category_id=$3,title=$4,summary=$5,content=$6::jsonb,content_text=$7,content_hash=$8,search_text=$9,visibility=$10::jsonb,attachment_ids=$11::jsonb,version=version+1,working_revision=working_revision+1,updated_by=$12,updated_at=now() WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id, value.categoryId, value.title, value.summary, JSON.stringify(value.content), value.contentText, value.contentHash, value.searchText, JSON.stringify(value.visibility), JSON.stringify(value.attachmentIds), actor.userId]);
      await this.tags(manager, id, value.tags, actor); await this.lockArticle(manager, id, actor, "update");
      const before = { title: row.title, contentHash: row.content_hash, version: row.version, status: row.status, workingRevision: row.working_revision };
      await this.audit(manager, actor, "knowledge-articles", id, "article.working_copy_updated", before, { ...this.summary(value), version: row.version + 1, changedFields: fields });
      if (fields.includes("visibility")) await this.audit(manager, actor, "knowledge-articles", id, "article.visibility_updated", row.visibility, value.visibility);
      return { id, version: row.version + 1 };
    });
  }
  publish(id: string, input: { expectedVersion?: unknown }, actor: KnowledgeActor) {
    assertKnowledgeAction(actor, "knowledge-articles", "update"); assertKnowledgeFields(actor, "knowledge-articles", ["status"]);
    assertKnowledgeFields(actor, "knowledge-articles", articleFields, "read");
    this.keys(input, ["expectedVersion"]);
    return this.command(actor, async (manager) => {
      const row = await this.lockArticle(manager, id, actor, "update"); this.version(row.version, input.expectedVersion);
      const value = await this.articleInput(manager, id, { ...this.workingInput(row), tags: await this.tagNames(manager, id, actor) }, actor);
      if (!value.contentText) throw new BadRequestException("发布前请填写正文");
      if (row.status === "PUBLISHED") {
        const [previous] = await manager.query(`SELECT working_revision FROM knowledge_article_versions WHERE tenant_id=$1 AND article_id=$2 AND version_no=$3`, [actor.tenantId, id, row.published_version]);
        if (previous?.working_revision === row.working_revision) throw new BadRequestException("工作副本未变化，无需重新发布");
      }
      const number = Number(row.published_version ?? 0) + 1; const versionId = uuidv7();
      const [category] = await manager.query(`SELECT child.name,COALESCE(parent.name,child.name) root FROM knowledge_categories child LEFT JOIN knowledge_categories parent ON parent.tenant_id=child.tenant_id AND parent.id=child.parent_id WHERE child.tenant_id=$1 AND child.id=$2`, [actor.tenantId, value.categoryId]);
      await manager.query(`INSERT INTO knowledge_article_versions(id,tenant_id,article_id,version_no,working_revision,category_id,category_name,root_category_name,title,summary,content,content_text,content_hash,search_text,tags,visibility,published_by,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15::jsonb,$16::jsonb,$17::uuid,$17::uuid,$17::text)`, [versionId, actor.tenantId, id, number, row.working_revision, value.categoryId, category.name, category.root, value.title, value.summary, JSON.stringify(value.content), value.contentText, value.contentHash, value.searchText, JSON.stringify(value.tags), JSON.stringify(value.visibility), actor.userId]);
      for (const attachmentId of value.attachmentIds) await manager.query(`INSERT INTO knowledge_version_attachments(tenant_id,article_id,version_id,attachment_id,created_by,updated_by) VALUES($1,$2,$3,$4,$5::uuid,$5::text)`, [actor.tenantId, id, versionId, attachmentId, actor.userId]);
      await manager.query(`UPDATE knowledge_articles SET status='PUBLISHED',published_version=$3,published_by=$4::uuid,published_at=now(),version=version+1,updated_by=$4::text,updated_at=now() WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id, number, actor.userId]);
      await this.audit(manager, actor, "knowledge-articles", id, number === 1 ? "article.published" : "article.republished", { status: row.status, publishedVersion: row.published_version }, { ...this.summary(value), publishedVersion: number, versionId });
      return { id, version: row.version + 1, publishedVersion: number };
    });
  }
  disable(id: string, input: { expectedVersion?: unknown }, actor: KnowledgeActor) {
    assertKnowledgeAction(actor, "knowledge-articles", "update"); assertKnowledgeFields(actor, "knowledge-articles", ["status"]);
    this.keys(input, ["expectedVersion"]);
    return this.command(actor, async (manager) => {
      const row = await this.lockArticle(manager, id, actor, "update"); this.version(row.version, input.expectedVersion);
      if (row.status !== "PUBLISHED") throw new BadRequestException("只有已发布文章可以停用");
      await manager.query(`UPDATE knowledge_articles SET status='DISABLED',version=version+1,updated_by=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id, actor.userId]);
      await this.audit(manager, actor, "knowledge-articles", id, "article.disabled", { status: row.status }, { status: "DISABLED", version: row.version + 1 }); return { id, version: row.version + 1 };
    });
  }
  deleteArticle(id: string, input: { expectedVersion?: unknown }, actor: KnowledgeActor) {
    assertKnowledgeAction(actor, "knowledge-articles", "delete");
    this.keys(input, ["expectedVersion"]);
    return this.command(actor, async (manager) => {
      const row = await this.lockArticle(manager, id, actor, "delete"); this.version(row.version, input.expectedVersion);
      if (row.published_version != null || row.status !== "DRAFT") throw new BadRequestException("已发布过的文章不能删除，请停用");
      // Tombstone retains attachment ownership/audit; no public or orphaned files are created.
      await manager.query(`UPDATE knowledge_articles SET deleted_at=now(),version=version+1,updated_by=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id, actor.userId]);
      await this.audit(manager, actor, "knowledge-articles", id, "article.draft_deleted", { title: row.title, contentHash: row.content_hash }, { attachmentRetention: "private-owned-tombstone" }); return { id };
    });
  }
  async upload(id: string, input: { expectedVersion?: unknown }, file: Express.Multer.File, actor: KnowledgeActor) {
    assertKnowledgeAction(actor, "knowledge-articles", "update"); assertKnowledgeFields(actor, "knowledge-articles", ["attachmentIds"]);
    this.keys(input, ["expectedVersion"]);
    let key: string | undefined;
    try {
      return await this.command(actor, async (manager) => {
        const row = await this.lockArticle(manager, id, actor, "update"); this.version(row.version, input.expectedVersion);
        if (row.attachment_ids.length >= 20) throw new BadRequestException("每篇文章最多 20 个附件");
        const value = await this.file(file); const attachmentId = uuidv7();
        const stored = await this.storage.put({ key: `knowledge/${Buffer.from(actor.tenantId).toString("hex")}/${id}/${attachmentId}`, body: value.body, contentType: value.contentType, visibility: "private" }); key = stored.key;
        const sha256 = createHash("sha256").update(value.body).digest("hex");
        const [metadata] = await manager.query(`INSERT INTO knowledge_attachments(id,tenant_id,article_id,original_name,storage_key,content_type,size,sha256,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid,$9::text) RETURNING created_at AS "createdAt"`, [attachmentId, actor.tenantId, id, value.name, key, value.contentType, value.body.length, sha256, actor.userId]);
        await manager.query(`UPDATE knowledge_articles SET attachment_ids=attachment_ids || $3::jsonb,version=version+1,working_revision=working_revision+1,updated_by=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id, JSON.stringify([attachmentId]), actor.userId]);
        await this.audit(manager, actor, "knowledge-articles", id, "attachment.uploaded", null, { attachmentId, originalName: value.name, size: value.body.length, sha256 });
        return { attachment: { id: attachmentId, articleId: id, originalName: value.name, contentType: value.contentType, size: value.body.length, sha256, createdAt: metadata.createdAt }, version: row.version + 1 };
      });
    } catch (error) {
      if (key) try { await this.storage.delete(key); } catch { this.logger.error("知识附件事务回滚后的存储清理失败，请检查私有存储"); }
      throw error;
    }
  }
  removeAttachment(id: string, attachmentId: string, input: { expectedVersion?: unknown }, actor: KnowledgeActor) {
    assertKnowledgeAction(actor, "knowledge-articles", "update"); assertKnowledgeFields(actor, "knowledge-articles", ["attachmentIds"]); knowledgeId(attachmentId);
    this.keys(input, ["expectedVersion"]);
    return this.command(actor, async (manager) => {
      const row = await this.lockArticle(manager, id, actor, "update"); this.version(row.version, input.expectedVersion);
      if (!row.attachment_ids.includes(attachmentId)) throw new NotFoundException("附件不存在于工作副本");
      if (canonicalKnowledgeContent(row.content).imageIds.includes(attachmentId)) throw new BadRequestException("请先从正文移除图片并保存，再移除附件");
      await manager.query(`UPDATE knowledge_articles SET attachment_ids=attachment_ids - $3::text,version=version+1,working_revision=working_revision+1,updated_by=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, id, attachmentId, actor.userId]);
      await manager.query(`UPDATE knowledge_attachments SET detached_at=now(),updated_by=$3,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2 AND article_id=$4`, [actor.tenantId, attachmentId, actor.userId, id]);
      await this.audit(manager, actor, "knowledge-articles", id, "attachment.removed_from_working_copy", { attachmentId }, { retainedForPublishedHistory: true }); return { id, version: row.version + 1 };
    });
  }
  private command<T>(actor: KnowledgeActor, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.access.transaction(actor, work).catch((error: { code?: string }) => {
      if (error.code === "23505") throw new BadRequestException("同一父分类下名称重复或业务编码已存在");
      if (["23503", "23514", "22P02"].includes(error.code ?? "")) throw new BadRequestException("知识库数据引用或业务规则无效"); throw error;
    });
  }
  private async lockArticle(manager: EntityManager, id: string, actor: KnowledgeActor, action: string) {
    knowledgeId(id); const params: unknown[] = [actor.tenantId]; const scope = await this.access.clause(actor, params, "manage", action, manager); const i = params.push(id);
    const [row] = await manager.query(`SELECT record.* FROM knowledge_articles record WHERE ${scope} AND record.id=$${i}::uuid FOR UPDATE`, params);
    if (!row) throw new NotFoundException("文章不存在或不在当前权限范围内"); return row as KnowledgeRow;
  }
  private async lockCategory(manager: EntityManager, id: string, actor: KnowledgeActor, action: string) {
    knowledgeId(id); assertKnowledgeAction(actor, "knowledge-categories", action); const params: unknown[] = [actor.tenantId]; const scope = knowledgeDataScope(actor, "knowledge-categories", action, params); const i = params.push(id);
    const [row] = await manager.query(`SELECT record.* FROM knowledge_categories record WHERE record.tenant_id=$1 AND record.id=$${i} AND (${scope}) FOR UPDATE`, params);
    if (!row) throw new NotFoundException("分类不存在或不在当前权限范围内"); return row as KnowledgeRow;
  }
  private async assertCategoryScope(manager: EntityManager, id: string, actor: KnowledgeActor, action: string) {
    const params: unknown[] = [actor.tenantId]; const scope = knowledgeDataScope(actor, "knowledge-categories", action, params); const i = params.push(id);
    const rows = await manager.query(`SELECT 1 FROM knowledge_categories record WHERE record.tenant_id=$1 AND record.id=$${i} AND (${scope})`, params);
    if (!rows.length) throw new BadRequestException("分类不在当前操作的数据范围内");
  }
  private async articleInput(manager: EntityManager, id: string, input: KnowledgeArticleInput, actor: KnowledgeActor) {
    const categoryId = knowledgeId(input.categoryId);
    const [category] = await manager.query(`SELECT child.enabled,parent.enabled AS parent_enabled FROM knowledge_categories child LEFT JOIN knowledge_categories parent ON parent.tenant_id=child.tenant_id AND parent.id=child.parent_id WHERE child.tenant_id=$1 AND child.id=$2 FOR SHARE OF child`, [actor.tenantId, categoryId]);
    if (!category?.enabled || category.parent_enabled === false) throw new BadRequestException("所属分类不存在或已停用");
    // Lock the parent too, preventing a concurrent disable between validation and publish.
    const parent = await manager.query(`SELECT parent.enabled FROM knowledge_categories parent JOIN knowledge_categories child ON child.tenant_id=parent.tenant_id AND child.parent_id=parent.id WHERE child.tenant_id=$1 AND child.id=$2 FOR SHARE OF parent`, [actor.tenantId, categoryId]);
    if (parent[0]?.enabled === false) throw new BadRequestException("一级分类已停用");
    const title = knowledgeText(input.title, "标题", 300, true); const summary = knowledgeText(input.summary, "摘要", 2000); const tags = knowledgeTags(input.tags ?? []);
    const canonical = canonicalKnowledgeContent(input.content); const visibility = knowledgeVisibility(input.visibility ?? { type: "ALL", subjectIds: [] }); const attachmentIds = knowledgeIds(input.attachmentIds ?? []);
    await this.visibilitySubjects(manager, visibility);
    const files = attachmentIds.length ? await manager.query(`SELECT id,content_type FROM knowledge_attachments WHERE tenant_id=$1 AND article_id=$2 AND id=ANY($3::uuid[]) AND detached_at IS NULL FOR SHARE`, [actor.tenantId, id, attachmentIds]) : [];
    if (files.length !== attachmentIds.length || canonical.imageIds.some((image) => !files.some((file: KnowledgeRow) => file.id === image && ["image/png", "image/jpeg", "image/webp"].includes(file.content_type)))) throw new BadRequestException("附件/图片不属于当前文章、已移除或不可用");
    return { categoryId, title, summary, tags, ...canonical, visibility, attachmentIds, searchText: [title, summary, canonical.contentText, ...tags].join("\n") };
  }
  private async visibilitySubjects(manager: EntityManager, value: KnowledgeVisibility) {
    if (value.type === "ALL") return;
    const table = value.type === "USER" ? "users" : value.type === "ROLE" ? "roles" : "organization_units";
    const enabled = value.type === "ROLE" ? " AND permission_group_resource IS NULL" : " AND enabled=true";
    const rows = await manager.query(`SELECT id FROM ${table} WHERE id=ANY($1::uuid[])${enabled} FOR SHARE`, [value.subjectIds]);
    if (rows.length !== value.subjectIds.length) throw new BadRequestException("可见范围包含不存在或停用的成员、组织或角色");
  }
  private async tags(manager: EntityManager, id: string, tags: string[], actor: KnowledgeActor) {
    await manager.query(`DELETE FROM knowledge_article_tags WHERE tenant_id=$1 AND article_id=$2`, [actor.tenantId, id]);
    for (const name of tags) {
      const [tag] = await manager.query(`INSERT INTO knowledge_tags(tenant_id,name,created_by,updated_by) VALUES($1,$2,$3::uuid,$3::text) ON CONFLICT(tenant_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [actor.tenantId, name, actor.userId]);
      await manager.query(`INSERT INTO knowledge_article_tags(tenant_id,article_id,tag_id,created_by,updated_by) VALUES($1,$2,$3,$4::uuid,$4::text)`, [actor.tenantId, id, tag.id, actor.userId]);
    }
  }
  private tagNames(manager: EntityManager, id: string, actor: KnowledgeActor): Promise<string[]> { return manager.query(`SELECT tag.name FROM knowledge_article_tags link JOIN knowledge_tags tag ON tag.tenant_id=link.tenant_id AND tag.id=link.tag_id WHERE link.tenant_id=$1 AND link.article_id=$2 ORDER BY tag.name`, [actor.tenantId, id]).then((rows: KnowledgeRow[]) => rows.map((row) => row.name)); }
  private workingInput(row: KnowledgeRow): KnowledgeArticleInput { return Object.fromEntries(Object.entries(articleColumns).map(([key, col]) => [key, row[col]])) as KnowledgeArticleInput; }
  private categoryInput(input: Record<string, unknown>) {
    const sortOrder = input.sortOrder ?? 0; const enabled = input.enabled ?? true;
    if (!Number.isInteger(sortOrder) || Math.abs(Number(sortOrder)) > 1_000_000 || typeof enabled !== "boolean") throw new BadRequestException("排序或状态无效");
    return { name: knowledgeText(input.name, "分类名称", 100, true), description: knowledgeText(input.description, "分类说明", 2000), sortOrder, enabled };
  }
  private version(current: number, expected: unknown) { const value = Number(expected); if (!Number.isInteger(value) || value < 1) throw new BadRequestException("缺少有效的数据版本，请刷新后重试"); if (current !== value) throw new ConflictException({ message: "数据已被其他人修改，请刷新后重试", currentVersion: current }); }
  private keys(input: unknown, allowed: string[]) { if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !allowed.includes(key))) throw new BadRequestException("请求包含不支持的字段"); }
  private summary(value: KnowledgeRow) { return { title: value.title, categoryId: value.categoryId, tags: value.tags, contentHash: value.contentHash, textLength: value.contentText?.length, attachmentCount: value.attachmentIds?.length, visibility: value.visibility }; }
  private audit(manager: EntityManager, actor: KnowledgeActor, resource: string, recordId: string, action: string, beforeJson: unknown, afterJson: unknown) { return manager.save(AuditLog, { tenantId: actor.tenantId, actorId: actor.userId, actorName: actor.displayName ?? actor.username, resource, recordId, action: `knowledge.${action}`, beforeJson, afterJson, requestId: actor.requestId, source: actor.source ?? "web", updatedBy: actor.userId ?? actor.username }); }
  private async file(file: Express.Multer.File) {
    if (!file?.buffer?.length || file.buffer.length > 20 * 1024 * 1024) throw new BadRequestException("请选择 20MB 以内的非空附件");
    const name = knowledgeText(file.originalname, "文件名", 255, true).replace(/[/\\]/g, "_").split("").map((char) => char.charCodeAt(0) < 32 ? "_" : char).join("");
    const extension = name.split(".").pop()?.toLowerCase() ?? "";
    const types: Record<string, string> = { pdf: "application/pdf", doc: "application/msword", xls: "application/vnd.ms-excel", ppt: "application/vnd.ms-powerpoint", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", txt: "text/plain", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
    const contentType = types[extension]; if (!contentType) throw new BadRequestException("仅支持 PDF、Word、Excel、PPT、TXT 和 PNG/JPEG/WebP 图片");
    let body = file.buffer;
    if (contentType.startsWith("image/")) {
      const png = body.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
      const jpeg = body.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
      const webp = body.subarray(0, 4).toString() === "RIFF" && body.subarray(8, 12).toString() === "WEBP";
      if (!(contentType === "image/png" ? png : contentType === "image/jpeg" ? jpeg : webp)) throw new BadRequestException("图片实际格式与扩展名不一致");
      try { body = await sharp(body, { limitInputPixels: 40_000_000 }).rotate().toFormat(extension === "jpg" || extension === "jpeg" ? "jpeg" : extension as "png" | "webp").toBuffer(); }
      catch { throw new BadRequestException("图片内容无效或尺寸过大"); }
    } else {
      const zip = ["docx", "xlsx", "pptx"].includes(extension); const ole = ["doc", "xls", "ppt"].includes(extension);
      if (zip && !body.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])) || ole && !body.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex")) || extension === "pdf" && !body.subarray(0, 5).equals(Buffer.from("%PDF-")) || extension === "txt" && body.includes(0)) throw new BadRequestException("附件实际格式与扩展名不一致");
    }
    if (body.length > 20 * 1024 * 1024) throw new BadRequestException("附件处理后超过 20MB");
    return { name, body, contentType };
  }
}
