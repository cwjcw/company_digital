/** Isolated real PostgreSQL acceptance runner. Never runs against a business database. */
import assert from "node:assert/strict";
import sharp from "sharp";
import ExcelJS from "exceljs";
import { v7 as uuidv7 } from "uuid";
import { DataSource } from "typeorm";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { AuditLog } from "../../entities";
import { KnowledgeBasePhaseOne1722920084000 } from "../../migrations/1722920084000-KnowledgeBasePhaseOne";
import { KnowledgeAccessService } from "./knowledge.scope";
import { KnowledgeApplicationService } from "./knowledge.application.service";
import { KnowledgeQueryService } from "./knowledge.query.service";
import { TableFilterRegistry } from "../../common/filtering/table-filter.registry";
import { KnowledgeFilterSourceProvider } from "./knowledge.filter-sources";
import { TableFilterController } from "../../common/filtering/table-filter.controller";
import { FieldCandidateService } from "../../common/filtering/field-candidate.service";
import { TablePrintService } from "../../common/printing/table-print.service";
import type { KnowledgeActor } from "./knowledge.types";

export async function validateKnowledgeDatabase(ds: DataSource) {
  if (!String(ds.options.database).startsWith("knowledge_test_")) throw new Error("Knowledge validation requires an isolated knowledge_test_* database");
  const checks: string[] = []; const check = (label: string) => { checks.push(label); if (require.main === module) process.stderr.write(`PASS ${checks.length}: ${label}\n`); };
  await ds.query(`CREATE TABLE users(id uuid PRIMARY KEY,username varchar NOT NULL,display_name varchar NOT NULL,enabled boolean NOT NULL DEFAULT true,department_paths jsonb NOT NULL DEFAULT '[]');
    CREATE TABLE organization_units(id uuid PRIMARY KEY,name varchar NOT NULL,parent_id uuid,enabled boolean NOT NULL DEFAULT true,level integer DEFAULT 1,sort_order integer DEFAULT 0);
    CREATE TABLE roles(id uuid PRIMARY KEY,name varchar NOT NULL,permission_group_resource varchar);
    CREATE TABLE user_roles(user_id uuid NOT NULL,role_id uuid NOT NULL);
    CREATE TABLE role_organization_scopes(role_id uuid NOT NULL,organization_unit_id uuid NOT NULL);
    CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar,actor_id uuid,actor_name varchar,resource varchar,record_id varchar,action varchar,before_json jsonb,after_json jsonb,request_id varchar,source varchar,created_by uuid,created_at timestamptz DEFAULT now(),updated_by varchar DEFAULT 'system',updated_at timestamptz DEFAULT now(),version integer DEFAULT 1);`);
  const a = uuidv7(), b = uuidv7(), org = uuidv7(), child = uuidv7(), other = uuidv7(), role = uuidv7(); const tenantId = "KNOWLEDGE_TEST";
  await ds.query(`INSERT INTO users(id,username,display_name,department_paths) VALUES($1,'knowledge-a','甲','[["公司","人力资源","招聘"]]'),($2,'knowledge-b','乙','[["其他"]]')`, [a, b]);
  await ds.query(`INSERT INTO roles(id,name) VALUES($1,'测试角色')`, [role]);
  const rootOrg = uuidv7(); await ds.query(`INSERT INTO organization_units(id,name,parent_id) VALUES($1,'公司',NULL),($2,'人力资源',$1),($3,'招聘',$2),($4,'其他',NULL)`, [rootOrg, org, child, other]);
  await ds.query(`INSERT INTO user_roles VALUES($1,$2)`, [a, role]);
  const savedTenant = process.env.KDOS_DEFAULT_TENANT_CODE; process.env.KDOS_DEFAULT_TENANT_CODE = tenantId;
  try { const runner = ds.createQueryRunner(); await runner.connect(); await runner.startTransaction(); try { await new KnowledgeBasePhaseOne1722920084000().up(runner); await runner.commitTransaction(); } catch (error) { await runner.rollbackTransaction(); throw error; } finally { await runner.release(); } }
  finally { if (savedTenant == null) delete process.env.KDOS_DEFAULT_TENANT_CODE; else process.env.KDOS_DEFAULT_TENANT_CODE = savedTenant; }
  const stored = new Map<string, Buffer>(); const storage = { put: async (input: { key: string; body: Buffer; visibility?: string }) => { assert.equal(input.visibility, "private"); const key = `.private/${input.key}`; stored.set(key, input.body); return { key, url: "" }; }, get: async (key: string) => ({ key, body: stored.get(key), contentType: "text/plain" }), delete: async (key: string) => { stored.delete(key); } };
  const access = new KnowledgeAccessService(ds); const application = new KnowledgeApplicationService(access, storage as never); const queries = new KnowledgeQueryService(access);
  const admin: KnowledgeActor = { tenantId, userId: a, username: "knowledge-a", isSystemAdmin: true, permissions: ["*"], requestId: "knowledge-db-validation", source: "api" };
  const ordinary = (userId: string): KnowledgeActor => ({ ...admin, userId, isSystemAdmin: false, permissions: ["knowledge-articles:*:read", "knowledge-categories:*:read", ...["knowledge-articles", "knowledge-categories"].flatMap((code) => tablePermissionFieldsFor(code as never).map((field) => `${code}:${field.key}:read`))], tableDataScopes: ["knowledge-articles", "knowledge-categories"].map((resource) => ({ resource, scope: "ALL", actions: ["read"] })) });
  const editor = { ...ordinary(a), permissions: [...ordinary(a).permissions, "knowledge-articles:*:create", "knowledge-articles:*:update", ...tablePermissionFieldsFor("knowledge-articles").filter((field) => field.editable).map((field) => `knowledge-articles:${field.key}:update`)], tableDataScopes: [{ resource: "knowledge-articles", scope: "ALL", actions: ["read", "create", "update"] }, { resource: "knowledge-categories", scope: "ALL", actions: ["read"] }] };
  const moduleAdmin = { ...ordinary(a), moduleAdminCodes: ["knowledge"] };
  const [{ id: root }] = await ds.query(`SELECT id FROM knowledge_categories WHERE tenant_id=$1`, [tenantId]);
  assert.equal((await queries.categories(admin)).length, 1); check("migration seeds only stable HR root");
  await ds.query(`INSERT INTO knowledge_categories(tenant_id,level,code,name) VALUES($1,1,'HR','人力资源') ON CONFLICT(tenant_id,code) DO NOTHING`, [tenantId]); assert.equal((await queries.categories(admin)).length, 1); check("root seed idempotent");
  const category = await application.createCategory({ parentId: root, name: "公司制度", sortOrder: 2, enabled: true }, moduleAdmin); check("module administrator creates category");
  await assert.rejects(() => application.createCategory({ parentId: root, name: "公司制度" }, admin), /重复/); check("duplicate siblings rejected");
  await assert.rejects(() => application.createCategory({ parentId: category.id, name: "第三层" }, admin), /一级分类/); check("category max level two");
  await assert.rejects(async () => application.createCategory({ parentId: root, name: "未授权" }, editor), /权限/); check("article editor cannot create category");
  const content = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
  const draft = await application.createArticle({ title: "员工请假管理办法", categoryId: category.id, content: content("请假流程和绩效考核制度"), tags: ["休假"] }, editor); check("editor creates draft");
  assert.equal((await queries.list({}, ordinary(a))).total, 0); await assert.rejects(() => queries.detail(draft.id, ordinary(a)), /不存在/); check("draft invisible to ordinary list/detail");
  let version = (await application.publish(draft.id, { expectedVersion: 1 }, editor)).version; assert.equal((await queries.detail(draft.id, ordinary(a))).publishedVersion, 1); check("publish creates readable v1");
  version = (await application.updateArticle(draft.id, { title: "未发布标题", content: content("工作副本秘密"), tags: ["新标签"], expectedVersion: version }, editor)).version;
  assert.equal((await queries.detail(draft.id, ordinary(a))).title, "员工请假管理办法"); assert.equal((await queries.list({ search: "工作副本秘密" }, ordinary(a))).total, 0); assert.equal((await queries.list({ tag: "新标签" }, ordinary(a))).total, 0); check("published content/title/tags/search isolated from working copy");
  await assert.rejects(() => application.updateArticle(draft.id, { title: "stale", expectedVersion: 1 }, editor), (error: any) => error.getStatus() === 409); check("stale expectedVersion 409");
  const file = { originalname: "制度.txt", mimetype: "text/plain", buffer: Buffer.from("办公文件"), size: 12 } as Express.Multer.File;
  const upload = await application.upload(draft.id, { expectedVersion: version }, file, editor); version = upload.version; check("private attachment upload metadata/hash/audit");
  await assert.rejects(() => queries.attachment(upload.attachment.id, ordinary(a)), /当前文章版本/); check("draft-only attachment cannot be downloaded from published article");
  const republish = await application.publish(draft.id, { expectedVersion: version }, editor); version = republish.version; assert.equal(republish.publishedVersion, 2); check("republish appends v2");
  assert.equal((await queries.detail(draft.id, editor, "manage", 1)).title, "员工请假管理办法"); assert.equal((await queries.detail(draft.id, editor, "manage", 1)).attachments.length, 0); assert.equal((await queries.detail(draft.id, editor, "manage", 2)).attachments.length, 1); check("historical version content and attachment set frozen");
  await assert.rejects(() => ds.query(`UPDATE knowledge_article_versions SET title='tampered' WHERE tenant_id=$1 AND article_id=$2`, [tenantId, draft.id]), /immutable/); check("database rejects published snapshot mutation");
  const removed = await application.removeAttachment(draft.id, upload.attachment.id, { expectedVersion: version }, editor); version = removed.version;
  assert.equal((await queries.attachment(upload.attachment.id, ordinary(a))).id, upload.attachment.id); check("removing working file preserves published download");
  await application.publish(draft.id, { expectedVersion: version }, editor); assert.equal((await queries.detail(draft.id, ordinary(a))).attachments.length, 0); assert.equal((await queries.detail(draft.id, editor, "manage", 2)).attachments.length, 1); check("new snapshot excludes removed attachment while old retains it");
  for (const type of ["ALL", "ORGANIZATION", "ROLE", "USER"] as const) {
    const subjects = type === "ALL" ? [] : [type === "ORGANIZATION" ? org : type === "ROLE" ? role : a];
    const article = await application.createArticle({ title: `授权文章${type}`, categoryId: category.id, content: content(`授权全文${type}`), visibility: { type, subjectIds: subjects } }, admin);
    const aclFile = await application.upload(article.id, { expectedVersion: 1 }, file, admin); await application.publish(article.id, { expectedVersion: aclFile.version }, admin);
    assert.equal((await queries.detail(article.id, ordinary(a))).title, `授权文章${type}`);
    if (type !== "ALL") {
      await assert.rejects(() => queries.detail(article.id, ordinary(b)), /不存在/);
      assert.equal((await queries.list({ search: `授权文章${type}` }, ordinary(b))).total, 0);
      await assert.rejects(() => queries.attachment(aclFile.attachment.id, ordinary(b)), /不存在/);
      await assert.rejects(() => queries.versions(article.id, ordinary(b)), /权限/);
      await assert.rejects(() => queries.detail(article.id, { ...editor, userId: b }, "manage", 1), /不存在/);
    }
    check(`${type} visibility: allowed and unauthorized search/detail/attachment/version`);
  }
  await assert.rejects(async () => application.publish(draft.id, { expectedVersion: 1 }, ordinary(a)), /权限/); await assert.rejects(async () => application.disable(draft.id, { expectedVersion: 1 }, ordinary(a)), /权限/); await assert.rejects(async () => application.createArticle({ title: "无权", categoryId: category.id, content: content("无权") }, ordinary(a)), /权限/); check("ordinary table group cannot create/publish/disable");
  const paginationArticle = await application.createArticle({ title: "年度员工绩效考核制度", categoryId: category.id, content: content("员工请假管理办法及年度员工绩效考核制度"), tags: ["搜索标签"] }, admin); await application.publish(paginationArticle.id, { expectedVersion: 1 }, admin);
  assert.equal((await queries.list({ search: "请假" }, ordinary(a))).total, 1); assert.equal((await queries.list({ search: "绩效考核" }, ordinary(a))).total, 1); assert.equal((await queries.list({ search: "搜索标签" }, ordinary(a))).total, 1); check("Chinese and tag trigram search");
  const page = await queries.list({ page: 2, pageSize: 50 }, ordinary(a)); assert.equal(page.page, 2); assert.equal(page.rows.length, 0); assert.equal(page.total, 6); check("server pagination/count");
  const hidden = { ...ordinary(a), permissions: ordinary(a).permissions.filter((p) => !["title:read", "content:read", "contentText:read"].some((field) => p.endsWith(field))) };
  const hiddenRow = await queries.detail(paginationArticle.id, hidden); assert.equal(hiddenRow.title, undefined); assert.equal(hiddenRow.content, undefined); await assert.rejects(() => queries.list({ search: "秘密" }, hidden), /权限/); check("field crop and hidden-field search fail closed");
  const otherTenant = { ...admin, tenantId: "OTHER_TENANT" }; assert.equal((await queries.list({}, otherTenant)).total, 0); await assert.rejects(() => queries.detail(draft.id, otherTenant), /不存在/); await assert.rejects(() => application.updateArticle(draft.id, { title: "跨租户", expectedVersion: 4 }, otherTenant), /不存在/); await assert.rejects(() => queries.attachment(upload.attachment.id, otherTenant), /不存在/); check("explicit tenant isolation across reads/writes/files");
  const registry = new TableFilterRegistry(); new KnowledgeFilterSourceProvider(registry, access).onModuleInit();
  const platform = new TableFilterController(new FieldCandidateService(ds), registry, {} as never, ds);
  const request = (actor: KnowledgeActor) => ({ user: { ...actor, sub: actor.userId }, requestId: actor.requestId }) as never;
  const priorDefault = process.env.KDOS_DEFAULT_TENANT_CODE; process.env.KDOS_DEFAULT_TENANT_CODE = tenantId;
  try {
    const managed = await platform.rows({ resource: "knowledge-articles", filterGroup: JSON.stringify({ logic: "AND", rules: [{ field: "status", operator: "eq", value: "PUBLISHED" }] }) }, request(editor)); assert.equal(managed.total, 6);
    await assert.rejects(() => platform.rows({ resource: "knowledge-articles" }, request(ordinary(a))), /管理权限/);
    const scopeEditor = { ...editor, tableDataScopes: [{ resource: "knowledge-articles", scope: "OWN", actions: ["read", "update", "export"] }] };
    const managedOwn = await platform.rows({ resource: "knowledge-articles" }, request(scopeEditor)); assert.equal(managedOwn.total, 6);
    const printing = new TablePrintService(registry, ds); const exportActor = { ...editor, permissions: [...editor.permissions, "knowledge-articles:*:export"], tableDataScopes: [{ resource: "knowledge-articles", scope: "ALL", actions: ["read", "update", "export"] }] };
    const exported = await printing.exportXlsx("knowledge-articles", {}, exportActor as never); assert.ok(exported); check("platform rows/filter/export share management ACL and permissions");
    const byTag = await platform.rows({ resource: "knowledge-articles", search: "搜索标签" }, request(editor)); assert.equal(byTag.total, 1);
    const candidates = await platform.candidateOptions({ resource: "knowledge-articles", field: "title", tableSearch: "搜索标签" }, request(editor)); assert.ok(Array.isArray(candidates)); assert.equal(candidates.length, 1);
    await assert.rejects(() => platform.rows({ resource: "knowledge-articles", search: "正文" }, request({ ...editor, permissions: editor.permissions.filter((permission) => permission !== "knowledge-articles:contentText:read") })), /权限/);
    const tagWorkbook = new ExcelJS.Workbook(); await tagWorkbook.xlsx.load(await printing.exportXlsx("knowledge-articles", { search: "搜索标签", columnKeys: ["title", "categoryId"] }, exportActor as never) as never);
    assert.equal(tagWorkbook.worksheets[0].rowCount, 2); assert.equal(tagWorkbook.worksheets[0].getCell("B2").value, "公司制度"); check("indexed search and tag filtering shared by platform rows/candidates/export with tenant labels");
    const restrictedExport = { ...exportActor, tableDataScopes: [{ resource: "knowledge-articles", scope: "CUSTOM", actions: ["read"], rules: [{ fieldKey: "title", operator: "EQ", value: "年度员工绩效考核制度" }] }, { resource: "knowledge-articles", scope: "ALL", actions: ["update", "export"] }] };
    const restrictedWorkbook = new ExcelJS.Workbook(); await restrictedWorkbook.xlsx.load(await printing.exportXlsx("knowledge-articles", { columnKeys: ["title"] }, restrictedExport as never) as never);
    assert.equal(restrictedWorkbook.worksheets[0].rowCount, 2); check("export intersects read and export data scopes");
  } finally { if (priorDefault == null) delete process.env.KDOS_DEFAULT_TENANT_CODE; else process.env.KDOS_DEFAULT_TENANT_CODE = priorDefault; }
  const historyArticle = await application.createArticle({ title: "历史ACL收紧", categoryId: category.id, content: content("版本一"), visibility: { type: "ALL", subjectIds: [] } }, admin);
  const historyFile = await application.upload(historyArticle.id, { expectedVersion: 1 }, file, admin);
  let historyVersion = (await application.publish(historyArticle.id, { expectedVersion: historyFile.version }, admin)).version;
  historyVersion = (await application.updateArticle(historyArticle.id, { visibility: { type: "USER", subjectIds: [b] }, expectedVersion: historyVersion }, admin)).version;
  historyVersion = (await application.publish(historyArticle.id, { expectedVersion: historyVersion }, admin)).version;
  await application.updateArticle(historyArticle.id, { visibility: { type: "ALL", subjectIds: [] }, expectedVersion: historyVersion }, admin);
  await assert.rejects(() => queries.detail(historyArticle.id, editor, "manage", 1), /不存在/); assert.equal((await queries.versions(historyArticle.id, editor)).length, 0);
  await assert.rejects(() => queries.attachment(historyFile.attachment.id, editor, "manage", 1), /无权/); check("historical broad ACL cannot bypass narrowed current published ACL even when working ACL differs");
  const scopeArticle = await application.createArticle({ title: "发布分类范围", categoryId: root, content: content("发布正文") }, admin);
  const scopeVersion = (await application.publish(scopeArticle.id, { expectedVersion: 1 }, admin)).version;
  await application.updateArticle(scopeArticle.id, { categoryId: category.id, expectedVersion: scopeVersion }, admin);
  const categoryScope = { ...ordinary(a), tableDataScopes: [{ resource: "knowledge-articles", scope: "CUSTOM", actions: ["read"], rules: [{ fieldKey: "categoryId", operator: "EQ", value: root }] }] };
  assert.equal((await queries.list({}, categoryScope)).total, 1); assert.equal((await queries.detail(scopeArticle.id, categoryScope)).categoryId, root); check("ordinary data scope follows published category while working copy changes");
  await ds.query(`UPDATE users SET department_paths='[]' WHERE id=$1`, [a]); assert.equal((await queries.list({ search: "授权文章ORGANIZATION" }, ordinary(a))).total, 0);
  await ds.query(`DELETE FROM user_roles WHERE user_id=$1`, [a]); assert.equal((await queries.list({ search: "授权文章ROLE" }, ordinary(a))).total, 0);
  await ds.query(`UPDATE users SET department_paths='[["公司","人力资源","招聘"]]' WHERE id=$1`, [a]); await ds.query(`INSERT INTO user_roles VALUES($1,$2)`, [a, role]); check("organization and role revocation applied immediately");
  const imageDraft = await application.createArticle({ title: "图片验证", categoryId: root, content: content("图片") }, admin);
  const imageBytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } }).png().toBuffer();
  const imageUpload = await application.upload(imageDraft.id, { expectedVersion: 1 }, { originalname: "图片.png", buffer: imageBytes } as Express.Multer.File, admin);
  assert.equal(imageUpload.attachment.contentType, "image/png"); assert.ok(imageUpload.attachment.createdAt);
  const object = stored.get((await queries.attachment(imageUpload.attachment.id, admin, "manage")).key)!;
  assert.equal((await sharp(object).metadata()).width, 4);
  await assert.rejects(() => application.upload(imageDraft.id, { expectedVersion: imageUpload.version }, { originalname: "伪图.png", buffer: Buffer.from("<svg onload=alert(1) />") } as Express.Multer.File, admin), /图片/); check("real Sharp private PNG decode/re-encode and forged image rejection");
  await assert.rejects(() => application.updateArticle(scopeArticle.id, { expectedVersion: 3, attachmentIds: [imageUpload.attachment.id] }, admin), /不属于/); check("attachments cannot be assigned across articles");
  await ds.query(`CREATE FUNCTION knowledge_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.after_json->>'originalName'='failed.txt' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER knowledge_test_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION knowledge_test_audit_failure()`);
  const objectCount = stored.size;
  await assert.rejects(() => application.upload(imageDraft.id, { expectedVersion: imageUpload.version }, { originalname: "failed.txt", buffer: Buffer.from("rollback") } as Express.Multer.File, admin), /test audit failure/);
  assert.equal(stored.size, objectCount); assert.equal((await queries.detail(imageDraft.id, admin, "manage")).version, imageUpload.version);
  await ds.query(`DROP TRIGGER knowledge_test_audit_failure ON audit_logs; DROP FUNCTION knowledge_test_audit_failure()`); check("audit failure rolls back metadata/version and compensates uploaded object");
  const concurrent = await Promise.allSettled([application.updateArticle(imageDraft.id, { title: "并发甲", expectedVersion: imageUpload.version }, admin), application.updateArticle(imageDraft.id, { title: "并发乙", expectedVersion: imageUpload.version }, admin)]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  const conflict = concurrent.find((result) => result.status === "rejected") as PromiseRejectedResult; assert.equal(conflict.reason.getStatus(), 409); check("concurrent commands with same expectedVersion commit once and return 409");
  await assert.rejects(() => application.updateArticle(scopeArticle.id, { title: "禁止编辑", expectedVersion: 3 }, { ...editor, permissions: editor.permissions.filter((permission) => permission !== "knowledge-articles:title:update") }), /权限/);
  await assert.rejects(async () => application.updateArticle(scopeArticle.id, { contentText: "伪造纯文本", expectedVersion: 3 } as never, admin), /不支持/); check("field update and forged trusted metadata denied by commands");
  const disabled = await application.disable(paginationArticle.id, { expectedVersion: 2 }, editor); await assert.rejects(() => queries.detail(paginationArticle.id, ordinary(a)), /不存在/); assert.equal((await queries.detail(paginationArticle.id, admin, "manage", 1)).title, "年度员工绩效考核制度"); check("disabled hidden; administrator retains immutable history");
  await assert.rejects(() => application.deleteArticle(paginationArticle.id, { expectedVersion: disabled.version }, admin), /不能删除/); check("ever-published article cannot be deleted");
  await application.updateCategory(category.id, { enabled: false, expectedVersion: 1 }, admin); await assert.rejects(() => application.createArticle({ title: "停用分类", categoryId: category.id, content: content("正文") }, editor), /停用/); check("disabled category rejects create/publish");
  await assert.rejects(() => application.deleteCategory(category.id, { expectedVersion: 2 }, admin), /不能删除/); check("used category cannot be deleted");
  const unused = await application.createCategory({ parentId: root, name: "未用分类" }, admin); await application.deleteCategory(unused.id, { expectedVersion: 1 }, admin); check("unused child category delete");
  const draftOnly = await application.createArticle({ title: "纯草稿", categoryId: root, content: content("草稿") }, admin); const draftFile = await application.upload(draftOnly.id, { expectedVersion: 1 }, file, admin); await application.deleteArticle(draftOnly.id, { expectedVersion: draftFile.version }, admin); await assert.rejects(() => queries.attachment(draftFile.attachment.id, admin, "manage"), /不存在/); check("draft deletion retains private ownership and blocks downloads");
  const [{ audits, missing, giant }] = await ds.query(`SELECT count(*)::int audits,count(*) FILTER(WHERE tenant_id IS NULL)::int missing,count(*) FILTER(WHERE length(COALESCE(after_json::text,''))>10000)::int giant FROM audit_logs WHERE action LIKE 'knowledge.%'`); assert.ok(audits >= 20); assert.equal(missing, 0); assert.equal(giant, 0); check("tenant-aware metadata audits without giant article body");
  const [{ policies }] = await ds.query(`SELECT count(*)::int policies FROM pg_policies WHERE tablename LIKE 'knowledge_%'`); assert.equal(policies, 7);
  const runner = ds.createQueryRunner(); await runner.connect(); await runner.startTransaction();
  try {
    await runner.query(`CREATE ROLE knowledge_test_rls NOLOGIN; GRANT USAGE ON SCHEMA public TO knowledge_test_rls; GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA public TO knowledge_test_rls; SET LOCAL ROLE knowledge_test_rls`);
    await runner.query(`SELECT set_config('app.tenant_id','OTHER_TENANT',true)`); assert.equal((await runner.query(`SELECT * FROM knowledge_articles`)).length, 0);
    await assert.rejects(() => runner.query(`INSERT INTO knowledge_categories(tenant_id,level,code,name) VALUES('KNOWLEDGE_TEST',1,'RLS','RLS')`), /row-level security/); check("real non-owner RLS read/write isolation");
  } finally { await runner.rollbackTransaction(); await runner.release(); }
  const [{ auditColumns }] = await ds.query(`SELECT count(*)::int AS "auditColumns" FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'knowledge_%' AND column_name IN ('id','tenant_id','created_by','created_at','updated_by','updated_at','version')`);
  assert.equal(auditColumns, 49); check("all seven knowledge tables retain UUIDv7 tenant and standard audit/version columns");
  assert.ok((await ds.query(`SELECT 1 FROM pg_extension WHERE extname='pg_trgm'`)).length); check("pg_trgm extension installed by migration");
  // Performance fixtures exist only in this disposable database.
  await ds.query(`INSERT INTO knowledge_articles(tenant_id,category_id,title,content_hash,content_text,search_text) SELECT $1,$2,'性能样本'||n,repeat('0',64),repeat('普通业务文档说明',200),repeat('普通业务文档说明',200) FROM generate_series(1,4000) n`, [tenantId, root]);
  await ds.query(`INSERT INTO knowledge_article_versions(tenant_id,article_id,version_no,working_revision,category_id,category_name,root_category_name,title,summary,content,content_text,content_hash,search_text,tags,visibility,published_by) SELECT tenant_id,id,1,1,category_id,'人力资源','人力资源',title,summary,content,content_text,content_hash,search_text,'[]',visibility,$2 FROM knowledge_articles WHERE tenant_id=$1 AND published_version IS NULL AND deleted_at IS NULL`, [tenantId, a]);
  await ds.query(`UPDATE knowledge_articles SET status='PUBLISHED',published_version=1 WHERE tenant_id=$1 AND published_version IS NULL AND deleted_at IS NULL`, [tenantId]);
  await ds.query(`ANALYZE knowledge_articles; ANALYZE knowledge_article_versions`);
  const explain = await ds.query(`EXPLAIN (FORMAT JSON) SELECT record.id FROM knowledge_articles record JOIN knowledge_article_versions published ON published.tenant_id=record.tenant_id AND published.article_id=record.id AND published.version_no=record.published_version WHERE record.tenant_id=$1 AND record.status='PUBLISHED' AND published.search_text ILIKE '%绩效考核%'`, [tenantId]);
  const plan = JSON.stringify(explain); assert.match(plan, /idx_knowledge_versions_search/); check("natural planner uses GIN for typical Chinese query (EXPLAIN)");
  const workingExplain = await ds.query(`EXPLAIN (FORMAT JSON) SELECT id FROM knowledge_articles record WHERE tenant_id=$1 AND search_text ILIKE '%绩效考核%'`, [tenantId]);
  assert.match(JSON.stringify(workingExplain), /idx_knowledge_articles_search/); check("natural planner uses working-copy GIN search index");
  const shortExplain = await ds.query(`EXPLAIN (FORMAT JSON) SELECT id FROM knowledge_article_versions WHERE tenant_id=$1 AND search_text ILIKE '%请假%'`, [tenantId]);
  assert.match(JSON.stringify(shortExplain), /idx_knowledge_versions_search/); check("natural planner uses GIN for short Chinese leave search");
  const exportFilter = { logic: "AND", rules: [{ field: "title", operator: "contains", value: "性能样本" }] };
  const savedDefault = process.env.KDOS_DEFAULT_TENANT_CODE; process.env.KDOS_DEFAULT_TENANT_CODE = tenantId;
  try {
    const pagedRows = await platform.rows({ resource: "knowledge-articles", pageSize: "100", filterGroup: JSON.stringify(exportFilter) }, request(admin));
    assert.equal(pagedRows.rows.length, 100); assert.equal(pagedRows.total, 4000);
    const allWorkbook = new ExcelJS.Workbook(); await allWorkbook.xlsx.load(await new TablePrintService(registry, ds).exportXlsx("knowledge-articles", { filterGroup: exportFilter, columnKeys: ["title"] }, admin) as never);
    assert.equal(allWorkbook.worksheets[0].rowCount, 4001); check("standard management export returns all 4000 filtered rows while page returns 100");
  } finally { if (savedDefault == null) delete process.env.KDOS_DEFAULT_TENANT_CODE; else process.env.KDOS_DEFAULT_TENANT_CODE = savedDefault; }
  return { status: "PASS", checks, count: checks.length, audits, explain: explain[0] };
}

if (require.main === module) {
  const database = process.env.KDOS_KNOWLEDGE_TEST_DATABASE;
  if (!database?.startsWith("knowledge_test_")) throw new Error("Set KDOS_KNOWLEDGE_TEST_DATABASE to a disposable knowledge_test_* database");
  const ds = new DataSource({ type: "postgres", host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT ?? 5432), username: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, database, entities: [AuditLog], logging: false });
  void ds.initialize().then(() => validateKnowledgeDatabase(ds)).then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)).catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "Knowledge DB validation failed"}\n`); process.exitCode = 1; }).finally(() => ds.isInitialized ? ds.destroy() : undefined);
}
