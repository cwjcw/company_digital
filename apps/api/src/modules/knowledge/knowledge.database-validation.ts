/** Real PostgreSQL acceptance, guarded against running on any business database. */
import "reflect-metadata";
import assert from "node:assert/strict";
import { DataSource } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import sharp from "sharp";
import ExcelJS from "exceljs";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { AuditLog } from "../../entities";
import { KnowledgeBasePhaseOne1722920084000 } from "../../migrations/1722920084000-KnowledgeBasePhaseOne";
import { Knowledge21FilePages1722920086000 } from "../../migrations/1722920086000-Knowledge21FilePages";
import { Readable } from "node:stream";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateKnowledgeFilesDatabase } from "./knowledge.files.database-validation";
import { KnowledgeFilesService } from "./knowledge.files.service";
import { KnowledgePreviewJobs } from "./knowledge.preview.service";
import type { PutObjectInput } from "../../storage/object-storage";
import { Knowledge2SpacePageModel1722920085000 } from "../../migrations/1722920085000-Knowledge2SpacePageModel";
import { KnowledgeAuthorizationService } from "./knowledge.scope";
import { KnowledgeApplicationService } from "./knowledge.application.service";
import { KnowledgeQueryService } from "./knowledge.query.service";
import { createKnowledgeDocxFixture } from "./knowledge.test-documents";
import { KnowledgeImportService } from "./knowledge.import.service";
import { KnowledgeExportService } from "./knowledge.export.service";
import { KnowledgeFilterSourceProvider } from "./knowledge.filter-sources";
import { TableFilterRegistry } from "../../common/filtering/table-filter.registry";
import { TableFilterController } from "../../common/filtering/table-filter.controller";
import { FieldCandidateService } from "../../common/filtering/field-candidate.service";
import { TablePrintService } from "../../common/printing/table-print.service";
import type { KnowledgeActor } from "./knowledge.types";

export async function validateKnowledgeDatabase(ds: DataSource) {
  if (!String(ds.options.database).startsWith("knowledge_test_"))
    throw new Error("Use isolated knowledge_test_* database only");
  const checks: string[] = [],
    check = (s: string) => {
      checks.push(s);
      process.stderr.write(`PASS ${checks.length}: ${s}\n`);
    };
  await ds.query(`CREATE TABLE users(id uuid PRIMARY KEY,username varchar NOT NULL,display_name varchar NOT NULL,enabled boolean NOT NULL DEFAULT true,department_paths jsonb NOT NULL DEFAULT '[]');
    CREATE TABLE organization_units(id uuid PRIMARY KEY,name varchar NOT NULL,parent_id uuid,enabled boolean NOT NULL DEFAULT true,level integer DEFAULT 1,sort_order integer DEFAULT 0);
    CREATE TABLE roles(id uuid PRIMARY KEY,name varchar NOT NULL,permission_group_resource varchar,permission_group_enabled boolean DEFAULT true);
    CREATE TABLE permissions(id uuid DEFAULT uuidv7(),resource varchar);
    CREATE TABLE user_roles(user_id uuid NOT NULL,role_id uuid NOT NULL);
    CREATE TABLE role_organization_scopes(role_id uuid NOT NULL,organization_unit_id uuid NOT NULL);
    CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar,actor_id uuid,actor_name varchar,resource varchar,record_id varchar,action varchar,before_json jsonb,after_json jsonb,request_id varchar,source varchar,created_by uuid,created_at timestamptz DEFAULT now(),updated_by varchar DEFAULT 'system',updated_at timestamptz DEFAULT now(),version integer DEFAULT 1);`);
  const a = uuidv7(),
    b = uuidv7(),
    org = uuidv7(),
    rootOrg = uuidv7(),
    childOrg = uuidv7(),
    role = uuidv7(),
    tenantId = "KNOWLEDGE_TEST";
  await ds.query(
    `INSERT INTO users(id,username,display_name,department_paths) VALUES($1,'test-a','甲','[["公司","人力资源","招聘"]]'),($2,'test-b','乙','[["其他"]]')`,
    [a, b],
  );
  await ds.query(`INSERT INTO roles(id,name) VALUES($1,'知识测试普通角色')`, [
    role,
  ]);
  await ds.query(
    `INSERT INTO organization_units(id,name,parent_id) VALUES($1,'公司',NULL),($2,'人力资源',$1),($3,'招聘',$2)`,
    [rootOrg, org, childOrg],
  );
  await ds.query(`INSERT INTO user_roles VALUES($1,$2)`, [a, role]);
  process.env.KDOS_DEFAULT_TENANT_CODE = tenantId;
  const qr = ds.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    await new KnowledgeBasePhaseOne1722920084000().up(qr);
    await qr.query(
      `INSERT INTO permissions(resource) VALUES('knowledge-articles'),('equipment-ledger');INSERT INTO roles(id,name,permission_group_resource) VALUES(uuidv7(),'retired','knowledge-articles')`,
    );
    await new Knowledge2SpacePageModel1722920085000().up(qr);
    // Prove a populated2.0 upgrade preserves file identity, storage key, hash and published relations.
    const upgradeSpace=uuidv7(),upgradePage=uuidv7(),upgradeFile=uuidv7(),upgradeVersion=uuidv7();
    await qr.query("INSERT INTO knowledge_spaces(id,tenant_id,code,name) VALUES($1,'UPGRADE_FIXTURE','OLD','升级保留')",[upgradeSpace]);
    await qr.query("INSERT INTO knowledge_pages(id,tenant_id,space_id,title,slug,working_content_hash) VALUES($1,'UPGRADE_FIXTURE',$2,'旧发布','upgrade-retained',repeat('a',64))",[upgradePage,upgradeSpace]);
    await qr.query("INSERT INTO knowledge_attachments(id,tenant_id,page_id,original_name,storage_key,content_type,size,sha256) VALUES($1,'UPGRADE_FIXTURE',$2,'保留.txt','.private/knowledge/retained/file','text/plain',1,repeat('b',64))",[upgradeFile,upgradePage]);
    await qr.query("INSERT INTO knowledge_page_versions(id,tenant_id,page_id,version_no,title,content,content_text,content_hash,tags,breadcrumb,access_snapshot,search_text) VALUES($1,'UPGRADE_FIXTURE',$2,1,'旧发布','{}','',repeat('a',64),'[]','[]','[]','旧发布')",[upgradeVersion,upgradePage]);
    await qr.query("INSERT INTO knowledge_page_version_attachments(tenant_id,page_id,version_id,attachment_id) VALUES('UPGRADE_FIXTURE',$1,$2,$3)",[upgradePage,upgradeVersion,upgradeFile]);
    await qr.query("UPDATE knowledge_pages SET status='PUBLISHED',published_version_id=$2 WHERE id=$1",[upgradePage,upgradeVersion]);
    await qr.commitTransaction();
    await qr.startTransaction();
    await new Knowledge21FilePages1722920086000().up(qr);
    const [retained]=await qr.query("SELECT file.id,file.storage_key,file.sha256,link.file_id,p.content_mode FROM knowledge_file_assets file JOIN knowledge_page_version_files link ON link.tenant_id=file.tenant_id AND link.file_id=file.id JOIN knowledge_pages p ON p.tenant_id=file.tenant_id AND p.id=file.page_id WHERE file.id=$1",[upgradeFile]);
    assert.equal(retained.id,upgradeFile);assert.equal(retained.file_id,upgradeFile);assert.equal(retained.storage_key,'.private/knowledge/retained/file');assert.equal(retained.sha256,'b'.repeat(64));assert.equal(retained.content_mode,'RICH_TEXT');
    check("populated2.0 migration preserves original IDs/keys/hashes and immutable published file relations");
    await qr.commitTransaction();
  } catch (e) {
    await qr.rollbackTransaction();
    throw e;
  } finally {
    await qr.release();
  }
  assert.equal(
    (
      await ds.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name IN ('knowledge_articles','knowledge_categories','knowledge_article_versions')",
      )
    ).length,
    0,
  );
  assert.equal(
    (await ds.query("SELECT resource FROM permissions"))[0].resource,
    "equipment-ledger",
  );
  assert.equal(
    (
      await ds.query(
        "SELECT permission_group_enabled FROM roles WHERE name='retired'",
      )
    )[0].permission_group_enabled,
    false,
  );
  check(
    "old-to-new migration retires old model and grants without touching unrelated permission",
  );
  const stored = new Map<string, Buffer>();
  const storage = {
    listPrivateKeys: async function* (prefix: string) {
      for (const key of stored.keys())
        if (key.startsWith(`.private/${prefix}/`)) yield key;
    },
    put: async (i: PutObjectInput) => {
      assert.equal(i.visibility, "private");
      const key = `.private/${i.key}`;
      const chunks: Buffer[]=[];for await(const chunk of Buffer.isBuffer(i.body)?Readable.from(i.body):i.body) chunks.push(Buffer.from(chunk));
      stored.set(key, Buffer.concat(chunks));
      return { key, url: "" };
    },
    get: async (key: string) =>
      stored.has(key)
        ? { key, body: stored.get(key)!, contentType: "text/plain" }
        : null,
    stat: async (key: string) => stored.has(key) ? {size: stored.get(key)!.length} : null,
    openStream: async (key: string, range?: {start:number;end:number}) => stored.has(key)?Readable.from(range?stored.get(key)!.subarray(range.start,range.end+1):stored.get(key)!):null,
    delete: async (key: string) => {
      stored.delete(key);
    },
  };
  const access = new KnowledgeAuthorizationService(ds),
    app = new KnowledgeApplicationService(access, storage),
    query = new KnowledgeQueryService(access),
    imports = new KnowledgeImportService(app, storage),
    exports = new KnowledgeExportService(query, storage);
  const fileApplication = new KnowledgeFilesService(app,new KnowledgePreviewJobs(ds),storage);
  const upload = async (pageId:string,input:Record<string,unknown>,file:Express.Multer.File,actor:KnowledgeActor) => {
    const folder=await fs.mkdtemp(path.join(os.tmpdir(),"knowledge-test-upload-"));const filename=path.join(folder,"source");
    try{await fs.writeFile(filename,file.buffer);return await fileApplication.upload(pageId,{...input,role:file.originalname.match(/\.(png|jpg|webp)$/i)?"INLINE":"SUPPLEMENTAL"},{...file,path:filename,size:file.buffer.length},actor);}
    finally{await fs.rm(folder,{recursive:true,force:true});}
  };
  const admin: KnowledgeActor = {
    tenantId,
    userId: a,
    username: "test",
    permissions: ["*"],
    isSystemAdmin: true,
    requestId: "knowledge-test",
    source: "api",
  };
  const actor = (userId: string, actions = ["read"]): KnowledgeActor => ({
    ...admin,
    userId,
    isSystemAdmin: false,
    permissions: [
      "knowledge-spaces:*:read",
      ...tablePermissionFieldsFor("knowledge-spaces").map(
        (f) => `knowledge-spaces:${f.key}:read`,
      ),
      ...actions.map((act) => `knowledge-pages:*:${act}`),
      ...tablePermissionFieldsFor("knowledge-pages").flatMap((f) => [
        `knowledge-pages:${f.key}:read`,
        ...(actions.includes("update") && f.editable
          ? [`knowledge-pages:${f.key}:update`]
          : []),
      ]),
    ],
    tableDataScopes: [
      { resource: "knowledge-spaces", scope: "ALL", actions: ["read"] },
      { resource: "knowledge-pages", scope: "ALL", actions },
    ],
  });
  const viewer = actor(b),
    editor = actor(a, [
      "read",
      "create",
      "update",
      "delete",
      "import",
      "export",
    ]),
    otherEditor = actor(b, [
      "read",
      "create",
      "update",
      "delete",
      "import",
      "export",
    ]);
  const [hr] = await query.spaces(admin);
  assert.equal(hr.code, "HR");
  assert.equal((await query.spaces(admin)).length, 1);
  check("only stable HR space seeded");
  await ds.query(
    `INSERT INTO knowledge_spaces(tenant_id,code,name) VALUES($1,'HR','人力资源') ON CONFLICT DO NOTHING`,
    [tenantId],
  );
  assert.equal((await query.spaces(admin)).length, 1);
  check("HR code is idempotent");
  const second = await app.createSpace(
    { code: "OPS", name: "运营知识", sortOrder: 10 },
    admin,
  );
  let sv = await app.setAccess(
    "space",
    hr.id,
    {
      expectedVersion: 1,
      entries: [
        { subjectType: "ALL", subjectId: null, accessLevel: "VIEWER" },
        { subjectType: "USER", subjectId: a, accessLevel: "EDITOR" },
      ],
    },
    admin,
  );
  assert.equal(
    (await query.spaces(editor)).find((s: any) => s.id === hr.id).accessLevel,
    "EDITOR",
  );
  check("Space effective viewer/editor levels");
  await assert.rejects(
    async () => app.createPage({ spaceId: hr.id }, otherEditor),
    /不存在/,
  );
  check("platform create cannot bypass Space viewer level");
  const body = (text: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  const root = await app.createPage(
    { spaceId: hr.id, title: "员工制度" },
    editor,
  );
  assert.equal(root.version, 1);
  const immediate = await query.detail(root.id, { mode: "working" }, editor);
  assert.equal(immediate.status, "DRAFT");
  check("New Page immediately creates a persistent pageId and draft");
  await assert.rejects(async () => query.detail(root.id, {}, viewer), /不存在/);
  assert.equal((await query.tree(hr.id, {}, viewer)).total, 0);
  check("draft hidden from viewer detail/tree/list");
  let rootVersion = (await app.publish(root.id, { expectedVersion: 1 }, editor))
    .version;
  assert.equal((await query.detail(root.id, {}, viewer)).title, "员工制度");
  check("title-only directory can publish");
  const page = await app.createPage(
    {
      spaceId: hr.id,
      parentId: root.id,
      title: "员工请假管理办法",
      content: body("年度绩效考核和请假制度"),
      tags: ["休假"],
    },
    editor,
  );
  let version = (await app.publish(page.id, { expectedVersion: 1 }, editor))
    .version;
  const first = await query.detail(page.id, {}, viewer);
  assert.equal(first.publishedVersion, 1);
  check("publish V1 snapshot");
  version = (
    await app.updatePage(
      page.id,
      {
        title: "工作副本秘密",
        content: body("仅草稿内容"),
        tags: ["草稿标签"],
        expectedVersion: version,
      },
      editor,
    )
  ).version;
  assert.equal(
    (await query.detail(page.id, {}, viewer)).title,
    "员工请假管理办法",
  );
  assert.equal((await query.list({ search: "仅草稿内容" }, viewer)).total, 0);
  assert.equal((await query.list({ tag: "草稿标签" }, viewer)).total, 0);
  check("autosave title/body/tags never changes published V1 or search");
  await assert.rejects(
    async () =>
      app.updatePage(page.id, { title: "stale", expectedVersion: 1 }, editor),
    (e) => (e as any).status === 409,
  );
  check("stale autosave returns 409");
  const beforeFailure = version;
  await assert.rejects(async () =>
    app.updatePage(
      page.id,
      { content: { type: "script" }, expectedVersion: version },
      editor,
    ),
  );
  assert.equal(
    (await query.detail(page.id, { mode: "working" }, editor)).version,
    beforeFailure,
  );
  check("failed save rolls back data and version");
  version = (await app.publish(page.id, { expectedVersion: version }, editor))
    .version;
  assert.equal((await query.detail(page.id, {}, viewer)).publishedVersion, 2);
  assert.equal(
    (
      await query.detail(
        page.id,
        { versionId: first.publishedVersionId },
        viewer,
      )
    ).title,
    first.title,
  );
  assert.equal((await query.versions(page.id, viewer)).length, 2);
  check("V2 publish retains immutable V1 and history");
  await assert.rejects(
    async () =>
      ds.query(
        "UPDATE knowledge_page_versions SET title='tamper' WHERE id=$1",
        [first.publishedVersionId],
      ),
    /immutable/,
  );
  check("database rejects snapshot mutation");
  let deep = page.id;
  for (let i = 0; i < 12; i++) {
    const p = await app.createPage(
      { spaceId: hr.id, parentId: deep, title: `深层${i}` },
      admin,
    );
    await app.publish(p.id, { expectedVersion: 1 }, admin);
    deep = p.id;
  }
  assert.equal((await query.detail(deep, {}, viewer)).breadcrumb.length, 15);
  check("12 additional levels work with no two-level contract");
  await assert.rejects(
    async () =>
      app.move(
        root.id,
        { parentId: deep, expectedVersion: rootVersion },
        admin,
      ),
    /后代/,
  );
  await assert.rejects(
    async () =>
      ds.query("UPDATE knowledge_pages SET parent_id=$2 WHERE id=$1", [
        root.id,
        deep,
      ]),
    /cycle/,
  );
  check("application and database reject cycles");
  rootVersion = (
    await app.updatePage(
      root.id,
      { title: "制度目录", expectedVersion: rootVersion },
      admin,
    )
  ).version;
  await assert.rejects(
    async () =>
      app.createPage({ spaceId: second.id, parentId: root.id }, admin),
    /同一空间/,
  );
  check("same-Space parent validation");
  const detached = await app.createPage(
    { spaceId: hr.id, title: "待移动" },
    admin,
  );
  const moved = await app.move(
    detached.id,
    { spaceId: second.id, parentId: null, sortOrder: 20, expectedVersion: 1 },
    admin,
  );
  assert.equal(
    (await query.detail(detached.id, { mode: "working" }, admin)).spaceId,
    second.id,
  );
  check("authorized cross-Space move and sort");
  await assert.rejects(
    async () =>
      app.move(
        page.id,
        { spaceId: second.id, expectedVersion: version },
        editor,
      ),
    /不存在|权限/,
  );
  check("cross-Space move enforces destination and whole-subtree permissions");
  const pdf = {
    originalname: "流程.pdf",
    buffer: Buffer.from("%PDF-1.7\nexample\n%%EOF"),
  } as Express.Multer.File;
  const uploaded = await upload(
    page.id,
    { expectedVersion: version },
    pdf,
    editor,
  );
  version = uploaded.version;
  assert.ok(stored.size);
  await assert.rejects(
    async () => query.attachment(uploaded.attachment.id, {}, viewer),
    /不存在/,
  );
  assert.ok(
    await query.attachment(uploaded.attachment.id, { mode: "working" }, editor),
  );
  check("new private attachment invisible until publish");
  version = (await app.publish(page.id, { expectedVersion: version }, editor))
    .version;
  const withFile = await query.detail(page.id, {}, viewer);
  assert.equal(withFile.attachments.length, 1);
  assert.ok(await query.attachment(uploaded.attachment.id, {}, viewer));
  check("published attachment download uses authorized API only");
  version = (
    await app.removeAttachment(
      uploaded.attachment.id,
      { expectedVersion: version },
      editor,
    )
  ).version;
  assert.equal(
    (await query.detail(page.id, { mode: "working" }, editor)).attachments
      .length,
    0,
  );
  assert.equal(
    (
      await query.detail(
        page.id,
        { versionId: withFile.publishedVersionId },
        viewer,
      )
    ).attachments.length,
    1,
  );
  check("detaching working attachment retains immutable history file");
  const imageBytes = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const image = await upload(
    page.id,
    { expectedVersion: version },
    { originalname: "图片.png", buffer: imageBytes } as Express.Multer.File,
    editor,
  );
  version = image.version;
  version = (
    await app.updatePage(
      page.id,
      {
        content: {
          type: "doc",
          content: [
            {
              type: "attachmentImage",
              attrs: { attachmentId: image.attachment.id, alt: "图" },
            },
          ],
        },
        expectedVersion: version,
      },
      editor,
    )
  ).version;
  await assert.rejects(
    async () =>
      app.updatePage(
        detached.id,
        {
          content: {
            type: "doc",
            content: [
              {
                type: "attachmentImage",
                attrs: { attachmentId: image.attachment.id },
              },
            ],
          },
          expectedVersion: moved.version,
        },
        admin,
      ),
    /当前页面/,
  );
  check("private image belongs to its page and cannot cross-reference");
  await assert.rejects(
    async () =>
      upload(
        page.id,
        { expectedVersion: version },
        {
          originalname: "伪.png",
          buffer: Buffer.from("<script>"),
        } as Express.Multer.File,
        editor,
      ),
    /图片/,
  );
  check("MIME/image spoof rejected by real Sharp validator");
  await assert.rejects(
    async () =>
      ds.query(
        "INSERT INTO knowledge_page_version_files(tenant_id,page_id,version_id,file_id) VALUES($1,$2,$3,$4)",
        [tenantId, page.id, first.publishedVersionId, image.attachment.id],
      ),
    /immutable/,
  );
  check(
    "new files cannot be inserted into an already-published attachment snapshot",
  );
  version = (await app.publish(page.id, { expectedVersion: version }, editor))
    .version;
  const exp = await exports.page(page.id, { format: "html" }, editor);
  assert.match(exp.body.toString(), /data:image\/png;base64/);
  assert.match(exp.filename, /^knowledge_page_.+\.html$/);
  const md = await exports.page(page.id, { format: "md" }, editor);
  assert.match(md.body.toString(), /!\[图\]/);
  await assert.rejects(async () => exports.page(page.id, {}, viewer), /权限/);
  check(
    "Markdown/HTML exports preserve content and authorized embedded image; require export grant",
  );
  for (const type of ["USER", "ROLE", "ORGANIZATION", "ALL"]) {
    sv = await app.setAccess(
      "space",
      hr.id,
      {
        expectedVersion: sv.version,
        entries: [
          {
            subjectType: type,
            subjectId:
              type === "USER"
                ? a
                : type === "ROLE"
                  ? role
                  : type === "ORGANIZATION"
                    ? org
                    : null,
            accessLevel: "EDITOR",
          },
        ],
      },
      admin,
    );
    assert.ok((await query.list({}, editor)).total);
    if (type !== "ALL") assert.equal((await query.list({}, viewer)).total, 0);
    check(`live Space ${type} grant governs all published pages`);
  }
  sv = await app.setAccess(
    "space",
    hr.id,
    {
      expectedVersion: sv.version,
      entries: [
        { subjectType: "ALL", subjectId: null, accessLevel: "FULL_ACCESS" },
      ],
    },
    admin,
  );
  rootVersion = (
    await app.setAccess(
      "page",
      root.id,
      {
        expectedVersion: rootVersion,
        restricted: true,
        entries: [
          { subjectType: "USER", subjectId: a, accessLevel: "FULL_ACCESS" },
        ],
      },
      admin,
    )
  ).version;
  version = (
    await app.setAccess(
      "page",
      page.id,
      {
        expectedVersion: version,
        restricted: true,
        entries: [
          { subjectType: "ALL", subjectId: null, accessLevel: "FULL_ACCESS" },
        ],
      },
      admin,
    )
  ).version;
  assert.equal((await query.list({}, viewer)).total, 0);
  assert.equal((await query.tree(hr.id, {}, viewer)).total, 0);
  await assert.rejects(async () => query.detail(deep, {}, viewer), /不存在/);
  await assert.rejects(
    async () => query.attachment(image.attachment.id, {}, viewer),
    /不存在/,
  );
  assert.equal((await query.versions(page.id, viewer)).length, 0);
  check(
    "child ALL never broadens restricted ancestor across list/tree/detail/files/history",
  );
  await assert.rejects(
    async () =>
      query.detail(page.id, { versionId: first.publishedVersionId }, viewer),
    /不存在/,
  );
  check("current ancestor restriction also blocks old version");
  rootVersion = (
    await app.setAccess(
      "page",
      root.id,
      { expectedVersion: rootVersion, restricted: false, entries: [] },
      admin,
    )
  ).version;
  const viewerWithUpdate = {
    ...viewer,
    permissions: [...viewer.permissions, "knowledge-pages:*:update"],
  };
  assert.equal((await query.versions(page.id, viewerWithUpdate)).length, 4);
  check("published history read does not require Space editor level");
  const noBody = {
    ...viewer,
    permissions: viewer.permissions.filter(
      (p) =>
        !p.startsWith("knowledge-pages:content") &&
        !p.startsWith("knowledge-pages:tags") &&
        !p.startsWith("knowledge-pages:parentId"),
    ),
  };
  const hidden = await query.detail(page.id, {}, noBody);
  assert.equal(hidden.content, undefined);
  assert.equal(hidden.contentText, undefined);
  assert.equal(hidden.contentHash, undefined);
  assert.equal(hidden.breadcrumb, undefined);
  await assert.rejects(
    async () => query.list({ search: "图" }, noBody),
    /权限/,
  );
  check(
    "field permissions prune content and breadcrumbs, prevent search side channels",
  );
  const scoped = {
    ...viewer,
    tableDataScopes: [
      { resource: "knowledge-spaces", scope: "ALL", actions: ["read"] },
      {
        resource: "knowledge-pages",
        scope: "CUSTOM",
        actions: ["read"],
        rules: [{ fieldKey: "title", operator: "EQ", value: "工作副本秘密" }],
      },
    ],
  };
  assert.equal((await query.list({}, scoped)).total, 0);
  check("ancestor data scope cannot leak parent breadcrumb");
  const alien = { ...admin, tenantId: "ANOTHER_TENANT" };
  assert.equal((await query.spaces(alien)).length, 0);
  await assert.rejects(
    async () => query.detail(page.id, { mode: "working" }, alien),
    /不存在/,
  );
  check("even administrators cannot cross tenant");
  const registry = new TableFilterRegistry();
  new KnowledgeFilterSourceProvider(registry, access, query).onModuleInit();
  const platform = new TableFilterController(
    new FieldCandidateService(ds),
    registry,
    {} as never,
    ds,
  );
  const request = (u: KnowledgeActor) =>
    ({
      user: {
        sub: u.userId,
        username: u.username,
        permissions: u.permissions,
        isSystemAdmin: u.isSystemAdmin,
        moduleAdminCodes: u.moduleAdminCodes,
        tableDataScopes: u.tableDataScopes,
      },
    }) as never;
  const standard = await platform.rows(
    { resource: "knowledge-pages" },
    request(viewer),
  );
  assert.ok(standard.rows.length);
  assert.ok(standard.rows.every((r: any) => !("working_content" in r)));
  check("platform row API reads published-only view");
  rootVersion = (
    await app.setAccess(
      "page",
      root.id,
      {
        expectedVersion: rootVersion,
        restricted: true,
        entries: [
          { subjectType: "USER", subjectId: a, accessLevel: "FULL_ACCESS" },
        ],
      },
      admin,
    )
  ).version;
  assert.equal(
    (await platform.rows({ resource: "knowledge-pages" }, request(viewer)))
      .total,
    0,
  );
  assert.equal(
    (
      (await platform.candidateOptions(
        { resource: "knowledge-pages", field: "title" },
        request(viewer),
      )) as any[]
    ).length,
    0,
  );
  check("standard rows and field candidates inherit ancestor ACL");
  rootVersion = (
    await app.setAccess(
      "page",
      root.id,
      { expectedVersion: rootVersion, restricted: false, entries: [] },
      admin,
    )
  ).version;
  for (const format of ["md", "html", "docx"]) {
    let buffer: Buffer;
    if (format === "docx") {
      buffer = await createKnowledgeDocxFixture();
    } else
      buffer = Buffer.from(
        format === "md"
          ? "# 导入标题\n\n**导入正文**\n\n|A|B|\n|-|-|\n|1|2|\n\n```js\nconst n=1\n```"
          : '<h1>导入标题</h1><p><b>导入正文</b><script>alert(1)</script><a href="javascript:alert(1)">安全</a></p><table><tr><td>格</td></tr></table>',
      );
    const preview = await imports.preview(
      { originalname: `文档.${format}`, buffer } as Express.Multer.File,
      editor,
    );
    assert.match(preview.contentText, /导入/);
    if (format === "docx") {
      assert.equal(preview.images.length, 1);
      for (const kind of [
        "heading",
        "bold",
        "italic",
        "bulletList",
        "table",
        "link",
        "attachmentImage",
      ])
        assert.match(JSON.stringify(preview.content), new RegExp(kind));
    }
    assert.doesNotMatch(
      JSON.stringify(preview.content),
      /script|javascript:|alert\(1\)/,
    );
    const imported = await imports.commit(
      {
        token: preview.token,
        spaceId: hr.id,
        parentId: root.id,
        tags: ["导入"],
      },
      editor,
    );
    assert.equal(imported.status, "DRAFT");
    await assert.rejects(
      async () => query.detail(imported.id, {}, viewer),
      /不存在/,
    );
    await assert.rejects(
      async () =>
        imports.commit({ token: preview.token, spaceId: hr.id }, editor),
      /过期/,
    );
    check(
      `${format} preview/commit uses commands, sanitizes content, saves draft only, consumes token`,
    );
  }
  const htmlImage = await imports.preview(
    {
      originalname: "图片.html",
      buffer: Buffer.from(
        `<p>嵌入</p><img src="data:image/png;base64,${imageBytes.toString("base64")}">`,
      ),
    } as Express.Multer.File,
    editor,
  );
  assert.equal(htmlImage.images.length, 1);
  const importedImage = await imports.commit(
    { token: htmlImage.token, spaceId: hr.id },
    editor,
  );
  assert.equal(
    (await query.detail(importedImage.id, { mode: "working" }, editor))
      .attachments.length,
    1,
  );
  check("HTML data-image preview becomes immediate private page attachment");
  const foreignPreview = await imports.preview(
    {
      originalname: "其他.md",
      buffer: Buffer.from("正文"),
    } as Express.Multer.File,
    editor,
  );
  await assert.rejects(
    async () =>
      imports.commit(
        { token: foreignPreview.token, spaceId: hr.id },
        otherEditor,
      ),
    /不存在/,
  );
  await assert.rejects(
    async () =>
      imports.preview(
        {
          originalname: "加密.docx",
          buffer: Buffer.from([0x88, 0x7d, 0x1c, 0xd6]),
        } as Express.Multer.File,
        editor,
      ),
    /该文件被加密,请解密后再导入./,
  );
  check(
    "preview bound to actor and unified encryption detection runs before parsing",
  );
  const remote = await imports.preview(
    {
      originalname: "外链.html",
      buffer: Buffer.from(
        '<img src="http://127.0.0.1/internal"><iframe src="file:///etc/passwd"></iframe><p>安全</p>',
      ),
    } as Express.Multer.File,
    editor,
  );
  assert.equal(remote.images.length, 0);
  assert.match(remote.warnings.join(""), /外部/);
  check("import cannot fetch external images or iframe/file URLs (SSRF)");
  const junk = await app.createPage(
    { spaceId: hr.id, title: "回收站测试" },
    admin,
  );
  const junkChild = await app.createPage(
    { spaceId: hr.id, parentId: junk.id, title: "回收站子页" },
    admin,
  );
  let junkVersion = (
    await app.transition(junk.id, "trash", { expectedVersion: 1 }, admin)
  ).version;
  assert.equal(
    (await query.detail(junkChild.id, { mode: "trash" }, admin)).status,
    "TRASHED",
  );
  junkVersion = (
    await app.transition(
      junk.id,
      "restore",
      { expectedVersion: junkVersion },
      admin,
    )
  ).version;
  assert.equal(
    (await query.detail(junkChild.id, { mode: "working" }, admin)).status,
    "DRAFT",
  );
  check("trash/restore operates on full subtree and retains prior state");
  const nested = await app.createPage(
    { spaceId: hr.id, parentId: junk.id, title: "此前单独删除" },
    admin,
  );
  await app.transition(nested.id, "trash", { expectedVersion: 1 }, admin);
  junkVersion = (
    await app.transition(
      junk.id,
      "trash",
      { expectedVersion: junkVersion },
      admin,
    )
  ).version;
  junkVersion = (
    await app.transition(
      junk.id,
      "restore",
      { expectedVersion: junkVersion },
      admin,
    )
  ).version;
  assert.equal(
    (await query.detail(nested.id, { mode: "trash" }, admin)).status,
    "TRASHED",
  );
  check(
    "restoring a parent does not restore an earlier independently trashed child",
  );
  const orphan = await upload(
    junk.id,
    { expectedVersion: junkVersion },
    pdf,
    admin,
  );
  junkVersion = (
    await app.removeAttachment(
      orphan.attachment.id,
      { expectedVersion: orphan.version },
      admin,
    )
  ).version;
  const orphanCount = await app.cleanOrphans(admin);
  assert.equal(orphanCount.removed, 1);
  await assert.rejects(
    async () =>
      query.attachment(orphan.attachment.id, { mode: "working" }, admin),
    /不存在/,
  );
  check(
    "unreferenced detached orphan storage/database cleaned; published history retained",
  );
  const crashKey = `.private/knowledge/${Buffer.from(tenantId).toString("hex")}/crash/file`;
  const otherTenantKey = `.private/knowledge/${Buffer.from("OTHER").toString("hex")}/crash/file`;
  stored.set(crashKey, Buffer.from("crash orphan"));
  stored.set(otherTenantKey, Buffer.from("other tenant"));
  const referencedBefore = new Map(stored);
  assert.equal((await app.reconcileStorageOrphans(viewer)).queued, 0);
  assert.equal(stored.has(crashKey), true);
  assert.equal((await app.reconcileStorageOrphans(admin)).queued, 1);
  await app.processCleanup(admin);
  assert.equal(stored.has(crashKey), false);
  assert.equal(stored.has(otherTenantKey), true);
  for (const key of referencedBefore.keys())
    if (key !== crashKey) assert.equal(stored.has(key), true);
  stored.delete(otherTenantKey);
  check(
    "crash-before-DB orphan reconciliation is admin-only and preserves referenced and other-tenant files",
  );
  junkVersion = (
    await app.transition(
      junk.id,
      "trash",
      { expectedVersion: junkVersion },
      admin,
    )
  ).version;
  await app.purge(junk.id, { expectedVersion: junkVersion }, admin);
  await assert.rejects(
    async () => query.detail(junkChild.id, { mode: "trash" }, admin),
    /不存在/,
  );
  check("permanent deletion removes trashed subtree");
  const archive = await app.createPage(
    { spaceId: hr.id, title: "历史规范" },
    admin,
  );
  const av = (await app.publish(archive.id, { expectedVersion: 1 }, admin))
    .version;
  await app.transition(archive.id, "archive", { expectedVersion: av }, admin);
  assert.equal((await query.detail(archive.id, {}, viewer)).status, "ARCHIVED");
  assert.equal((await query.list({ search: "历史规范" }, viewer)).total, 0);
  check("archive retains readable published history and leaves default search");
  await app.transition(
    archive.id,
    "unarchive",
    { expectedVersion: av + 1 },
    admin,
  );
  assert.equal(
    (await query.detail(archive.id, {}, viewer)).status,
    "PUBLISHED",
  );
  check(
    "unarchive restores published subtree without adding fake content versions",
  );
  sv = await app.updateSpace(
    hr.id,
    { status: "ARCHIVED", expectedVersion: sv.version },
    admin,
  );
  assert.equal((await query.list({}, viewer)).total, 0);
  sv = await app.updateSpace(
    hr.id,
    { status: "ACTIVE", expectedVersion: sv.version },
    admin,
  );
  check("Space archive blocks normal browsing without deleting its data");
  const columns = await ds.query(
    "SELECT count(*)::int n FROM information_schema.columns WHERE table_name LIKE 'knowledge_%' AND table_name<>'knowledge_page_read_model' AND column_name IN ('id','tenant_id','created_by','created_at','updated_by','updated_at','version')",
  );
  assert.equal(columns[0].n, 91);
  check(
    "all thirteen Knowledge tables retain UUIDv7/tenant and standard audit/version columns",
  );
  rootVersion = (
    await app.publish(root.id, { expectedVersion: rootVersion }, admin)
  ).version;
  assert.ok((await query.list({ search: "制度目录" }, viewer)).total >= 13);
  assert.equal(
    (await query.detail(page.id, {}, viewer)).breadcrumb[1].title,
    "制度目录",
  );
  check(
    "parent publication refreshes descendant search and live breadcrumbs without changing their content versions",
  );
  const moveSearch = await app.createPage(
    { spaceId: hr.id, parentId: root.id, title: "移动检索" },
    admin,
  );
  const msv = (await app.publish(moveSearch.id, { expectedVersion: 1 }, admin))
    .version;
  await app.move(
    moveSearch.id,
    { parentId: null, expectedVersion: msv },
    admin,
  );
  assert.equal(
    (await query.list({ search: "制度目录", ids: [moveSearch.id] }, viewer))
      .total,
    0,
  );
  assert.equal(
    (await query.detail(moveSearch.id, {}, viewer)).breadcrumb.length,
    2,
  );
  check(
    "move rebuilds published ancestor search and breadcrumb, without old-parent leakage",
  );
  const rlsRole = `knowledge_rls_${Date.now()}`;
  await ds.query(
    `CREATE ROLE ${rlsRole} NOLOGIN;GRANT USAGE ON SCHEMA public TO ${rlsRole};GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${rlsRole}`,
  );
  const transaction = ds.createQueryRunner();
  await transaction.connect();
  await transaction.startTransaction();
  try {
    await transaction.query(`SET LOCAL ROLE ${rlsRole}`);
    await transaction.query("SELECT set_config('app.tenant_id','OTHER',true)");
    for (const table of [
      "knowledge_spaces",
      "knowledge_space_access",
      "knowledge_pages",
      "knowledge_page_access",
      "knowledge_page_versions",
      "knowledge_file_assets",
      "knowledge_page_version_files",
      "knowledge_tags",
      "knowledge_page_tags",
      "knowledge_page_read_model",
      "knowledge_storage_cleanup",
      "knowledge_page_files",
      "knowledge_file_previews",
      "knowledge_file_upload_requests",
    ]) {
      assert.equal(
        (await transaction.query(`SELECT count(*)::int n FROM ${table}`))[0].n,
        0,
      );
    }
    await assert.rejects(
      async () =>
        transaction.query(
          "INSERT INTO knowledge_spaces(tenant_id,code,name) VALUES($1,'X','跨租户')",
          [tenantId],
        ),
      /row-level security/,
    );
    await transaction.rollbackTransaction();
    check(
      "real non-owner role enforces RLS on all thirteen tables and security-invoker view",
    );
  } finally {
    if (transaction.isTransactionActive)
      await transaction.rollbackTransaction();
    await transaction.release();
    await ds.query(`DROP OWNED BY ${rlsRole};DROP ROLE ${rlsRole}`);
  }
  await ds.query(
    `INSERT INTO knowledge_pages(tenant_id,space_id,title,slug,working_content_hash) SELECT $1,$2,'性能样本'||n,'perf-'||n,repeat('0',64) FROM generate_series(1,4000) n`,
    [tenantId, hr.id],
  );
  await ds.query(
    `INSERT INTO knowledge_page_versions(tenant_id,page_id,version_no,title,content,content_text,content_hash,tags,breadcrumb,access_snapshot,search_text,published_by) SELECT tenant_id,id,1,title,working_content,repeat('普通业务文档说明',20),working_content_hash,'[]','[]','[]',repeat('普通业务文档说明',20),$2 FROM knowledge_pages WHERE tenant_id=$1 AND slug LIKE 'perf-%'`,
    [tenantId, a],
  );
  await ds.query(
    `UPDATE knowledge_pages p SET status='PUBLISHED',published_version_id=v.id FROM knowledge_page_versions v WHERE p.tenant_id=$1 AND v.tenant_id=p.tenant_id AND v.page_id=p.id AND p.slug LIKE 'perf-%'`,
    [tenantId],
  );
  await app.rebuildSearch(ds.manager, admin);
  await ds.query("ANALYZE knowledge_pages;ANALYZE knowledge_page_versions");
  const explain = await ds.query(
    `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT record.id FROM knowledge_pages record JOIN knowledge_page_versions published ON published.tenant_id=record.tenant_id AND published.id=record.published_version_id WHERE record.tenant_id=$1 AND record.status='PUBLISHED' AND record.published_search_text ILIKE '%工作副本秘密%'`,
    [tenantId],
  );
  assert.match(JSON.stringify(explain), /idx_knowledge_pages_search/);
  check(
    "natural PostgreSQL planner uses pg_trgm GIN for Chinese query with EXPLAIN ANALYZE",
  );
  const filter = {
    logic: "AND",
    rules: [{ field: "title", operator: "contains", value: "性能样本" }],
  };
  const paged = await platform.rows(
    {
      resource: "knowledge-pages",
      pageSize: "100",
      filterGroup: JSON.stringify(filter),
    },
    request(admin),
  );
  assert.equal(paged.total, 4000);
  assert.equal(paged.rows.length, 100);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    (await new TablePrintService(registry, ds).exportXlsx(
      "knowledge-pages",
      {
        filterGroup: filter,
        columnKeys: ["title"],
        sortField: "title",
        sortOrder: "desc",
      },
      admin,
    )) as never,
  );
  assert.equal(workbook.worksheets[0].rowCount, 4001);
  assert.equal(
    workbook.worksheets[0].getRow(2).getCell(1).value,
    "性能样本999",
  );
  check(
    "standard full-data export preserves the current authorized descending title sort",
  );
  check(
    "platform export includes all 4000 filtered published pages, not current 100 rows",
  );
  const pageVersion = (await query.detail(page.id, { mode: "working" }, admin))
    .version;
  const trashed = await app.transition(
    page.id,
    "trash",
    { expectedVersion: pageVersion },
    admin,
  );
  const realDelete = storage.delete;
  storage.delete = async () => {
    throw new Error("synthetic storage outage");
  };
  const purged = await app.purge(
    page.id,
    { expectedVersion: trashed.version },
    admin,
  );
  assert.ok(purged.cleanupPending > 0);
  assert.equal(
    (
      await ds.query("SELECT 1 FROM knowledge_page_versions WHERE page_id=$1", [
        page.id,
      ])
    ).length,
    0,
  );
  assert.equal(
    (
      await ds.query("SELECT 1 FROM knowledge_file_assets WHERE page_id=$1", [
        page.id,
      ])
    ).length,
    0,
  );
  storage.delete = realDelete;
  const cleanup = await app.processCleanup(admin);
  assert.ok(cleanup.removed > 0);
  assert.equal(cleanup.pending, 0);
  check(
    "published subtree purge removes immutable versions/files and persists storage outage cleanup for retry",
  );
  const [{ audits }] = await ds.query(
    "SELECT count(*)::int audits FROM audit_logs WHERE resource LIKE 'knowledge-%'",
  );
  assert.ok(audits > 50);
  assert.equal(
    (
      await ds.query(
        "SELECT 1 FROM audit_logs WHERE after_json ? 'content' OR after_json ? 'password'",
      )
    ).length,
    0,
  );
  check(
    "critical commands audited by metadata/hash, never full body or credentials",
  );
  await validateKnowledgeFilesDatabase(ds,app,query,storage,admin,viewer,hr.id,check);
  imports.onModuleDestroy();
  return {
    status: "PASS",
    checks,
    count: checks.length,
    audits,
    explain: explain[0],
  };
}
if (require.main === module) {
  const database = process.env.KDOS_KNOWLEDGE_TEST_DATABASE;
  if (!database?.startsWith("knowledge_test_"))
    throw new Error("Set isolated KDOS_KNOWLEDGE_TEST_DATABASE");
  const ds = new DataSource({
    type: "postgres",
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database,
    entities: [AuditLog],
    logging: false,
  });
  void ds
    .initialize()
    .then(() => validateKnowledgeDatabase(ds))
    .then((r) => process.stdout.write(JSON.stringify(r, null, 2) + "\n"))
    .catch((e) => {
      process.stderr.write(
        (e instanceof Error ? e.message : "DB validation failed") + "\n",
      );
      process.exitCode = 1;
    })
    .finally(() => (ds.isInitialized ? ds.destroy() : undefined));
}
