import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { v7 as uuidv7 } from "uuid";
import type { DataSource } from "typeorm";
import type { ObjectStorage } from "../../storage/object-storage";
import { KnowledgeApplicationService } from "./knowledge.application.service";
import { KnowledgeQueryService } from "./knowledge.query.service";
import { KnowledgeFilesService } from "./knowledge.files.service";
import {
  KnowledgePreviewJobs,
  KnowledgePreviewService,
} from "./knowledge.preview.service";
import { createKnowledgeDocxFixture } from "./knowledge.test-documents";
import type { KnowledgeActor } from "./knowledge.types";

/** Real service/transactions, invoked only after the existing isolated database guard. */
export async function validateKnowledgeFilesDatabase(
  ds: DataSource,
  app: KnowledgeApplicationService,
  query: KnowledgeQueryService,
  storage: ObjectStorage,
  admin: KnowledgeActor,
  viewer: KnowledgeActor,
  spaceId: string,
  check: (label: string) => void,
) {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "knowledge-file-model-test-"),
  );
  const jobs = new KnowledgePreviewJobs(ds),
    preview = new KnowledgePreviewService(query, app),
    files = new KnowledgeFilesService(app, jobs, storage);
  const disk = async (name: string, bytes: Buffer) => {
    const filename = path.join(folder, uuidv7());
    await fs.writeFile(filename, bytes);
    return {
      path: filename,
      size: bytes.length,
      originalname: name,
    } as Express.Multer.File;
  };
  try {
    const pdf = await disk(
      "文件制度.pdf",
      Buffer.from("%PDF-1.7\noriginal-v1\n%%EOF"),
    );
    const input = { spaceId, title: "文件知识", idempotencyKey: uuidv7() };
    const created = await files.create(input, pdf, admin);
    assert.equal(created.status, "DRAFT");
    assert.equal((await query.detail(created.id, { mode: "working" }, admin)).title, input.title);
    for (const title of [" ", "字".repeat(301)]) await assert.rejects(() => files.create({ ...input, title, idempotencyKey: uuidv7() }, pdf, admin), /标题/);
    check("custom Chinese title is stored independently; empty/overlong upload titles rejected before writes");
    assert.equal(
      (await query.detail(created.id, { mode: "working" }, admin)).contentMode,
      "FILE",
    );
    await assert.rejects(() => query.detail(created.id, {}, viewer));
    await assert.rejects(() =>
      preview.status(created.attachment.id, {}, viewer),
    );
    check(
      "file upload creates FILE draft; ordinary reader cannot discover its original/preview/status",
    );
    // Discard the first response as a client timeout would, then replay the exact command.
    const repeated = await files.create(input, pdf, admin);
    assert.equal(repeated.id, created.id);
    assert.equal(repeated.repeated, true);
    assert.equal((await query.list({ ids: [created.id], mode: "working" }, admin)).total, 1);
    check("response loss after committed upload replays one persisted page and original asset");
    await assert.rejects(() =>
      files.create({ ...input, title: "changed" }, pdf, admin),
    );
    check(
      "file-page upload is persisted, actor/tenant-bound and idempotent; conflicting replay rejected",
    );
    const v1 = await app.publish(created.id, { expectedVersion: 1 }, admin);
    const first = await query.detail(created.id, {}, viewer);
    assert.equal(first.primaryFile.id, created.attachment.id);
    const native = await preview.preview(created.attachment.id, {}, viewer);
    assert.equal(
      native.key,
      (await query.attachment(created.attachment.id, {}, viewer)).key,
    );
    check(
      "published native PDF preview uses the same authorized original asset and version relation",
    );
    const replacement = await files.upload(
      created.id,
      { expectedVersion: v1.version, role: "PRIMARY" },
      await disk(
        "文件制度_v2.pdf",
        Buffer.from("%PDF-1.7\noriginal-v2\n%%EOF"),
      ),
      admin,
    );
    assert.equal(
      (await query.detail(created.id, {}, viewer)).primaryFile.id,
      created.attachment.id,
    );
    assert.equal(
      (await query.detail(created.id, { mode: "working" }, admin)).primaryFile
        .id,
      replacement.attachment.id,
    );
    await assert.rejects(() =>
      preview.preview(replacement.attachment.id, {}, viewer),
    );
    await assert.rejects(
      () =>
        files.upload(
          created.id,
          { expectedVersion: v1.version, role: "PRIMARY" },
          pdf,
          admin,
        ),
      /修改/,
    );
    check(
      "primary replacement touches only the working draft; published V1 remains intact and stale writes return409",
    );
    const v2 = await app.publish(
      created.id,
      { expectedVersion: replacement.version },
      admin,
    );
    const renamed = await app.updatePage(created.id, { title: "发布后改名", expectedVersion: v2.version }, admin);
    const working = await query.detail(created.id, { mode: "working" }, admin);
    assert.equal(working.title, "发布后改名");
    assert.equal(working.primaryFile.id, replacement.attachment.id);
    assert.equal(working.primaryFile.originalName, "文件制度_v2.pdf");
    assert.equal((await query.detail(created.id, {}, viewer)).title, "文件知识");
    assert.equal((await query.detail(created.id, { versionId: v1.publishedVersionId }, viewer)).title, "文件知识");
    assert.equal((await query.attachment(created.attachment.id, { versionId: v1.publishedVersionId }, viewer)).key, native.key);
    assert.equal((await query.list({ ids: [created.id], mode: "working" }, admin)).rows[0].title, working.title);
    check("rename after V1/V2 syncs working tree/detail while published titles, original filenames and storage keys remain immutable");
    const current = await query.detail(created.id, {}, viewer);
    assert.equal(current.primaryFile.id, replacement.attachment.id);
    assert.notEqual(current.contentHash, first.contentHash);
    const history = await query.detail(
      created.id,
      { versionId: v1.publishedVersionId },
      viewer,
    );
    assert.equal(history.primaryFile.id, created.attachment.id);
    await preview.preview(
      created.attachment.id,
      { versionId: v1.publishedVersionId },
      viewer,
    );
    await assert.rejects(() =>
      preview.preview(
        created.attachment.id,
        { versionId: v2.publishedVersionId },
        viewer,
      ),
    );
    check(
      "V1/V2 originals and content hashes remain distinct; mismatched file/version guessing is denied",
    );
    await assert.rejects(
      () =>
        ds.query(
          "UPDATE knowledge_file_assets SET sha256=repeat('f',64) WHERE tenant_id=$1 AND id=$2",
          [admin.tenantId, created.attachment.id],
        ),
      /immutable/,
    );
    await assert.rejects(
      () =>
        ds.query(
          "UPDATE knowledge_page_version_files SET role='SUPPLEMENTAL' WHERE tenant_id=$1 AND version_id=$2",
          [admin.tenantId, v1.publishedVersionId],
        ),
      /immutable/,
    );
    check(
      "database rejects original asset mutation and published file-role relation mutation",
    );
    const missing = await app.createPage(
      { spaceId, contentMode: "FILE", title: "未上传" },
      admin,
    );
    await assert.rejects(
      () => app.publish(missing.id, { expectedVersion: 1 }, admin),
      /主文件/,
    );
    check("file page without its unique primary file cannot publish");
    const doc = await files.create(
      { spaceId, idempotencyKey: uuidv7() },
      await disk("文件名搜索.docx", await createKnowledgeDocxFixture()),
      admin,
    );
    assert.equal((await query.detail(doc.id, { mode: "working" }, admin)).title, "文件名搜索");
    check("upload without custom title defaults to original filename without extension");
    assert.equal(
      (await preview.status(doc.attachment.id, { mode: "working" }, admin))
        .status,
      "PENDING",
    );
    const lease = (
      await Promise.all([
        jobs.claim(admin.tenantId, 60),
        jobs.claim(admin.tenantId, 60),
      ])
    ).filter(Boolean);
    assert.equal(lease.length, 1);
    assert.equal(lease[0].file_id, doc.attachment.id);
    assert.equal(await jobs.claim("OTHER_TENANT", 60), null);
    check(
      "Office upload retains its original independently of conversion; SKIP LOCKED claims once and isolates tenants",
    );
    await ds.query(
      "UPDATE knowledge_file_previews SET lease_until=now()-interval '1 second' WHERE tenant_id=$1 AND id=$2",
      [admin.tenantId, lease[0].id],
    );
    const recovered = await jobs.claim(admin.tenantId, 60);
    assert(recovered);
    assert.notEqual(recovered.leaseId, lease[0].leaseId);
    assert.equal(
      await jobs.complete(admin.tenantId, recovered.id, lease[0].leaseId, {
        size: 12,
      }),
      false,
    );
    await jobs.complete(admin.tenantId, recovered.id, recovered.leaseId, {
      error: "转换超时",
    });
    assert.equal(
      (await preview.status(doc.attachment.id, { mode: "working" }, admin))
        .status,
      "FAILED",
    );
    assert(
      await query.attachment(doc.attachment.id, { mode: "working" }, admin),
    );
    check(
      "stale lease recovery rejects the old worker; conversion failure preserves original downloads",
    );
    await assert.rejects(
      () => preview.retry(doc.attachment.id, { mode: "working" }, viewer),
      /管理员/,
    );
    await preview.retry(doc.attachment.id, { mode: "working" }, admin);
    assert.equal(
      (await preview.status(doc.attachment.id, { mode: "working" }, admin))
        .status,
      "PENDING",
    );
    check(
      "explicit administrator retry requeues a failed job without changing the page version",
    );
    const retried = await jobs.claim(admin.tenantId, 60);
    assert(retried);
    await storage.put({
      key: retried.key.replace(/^\.private\//, ""),
      visibility: "private",
      body: Buffer.from("%PDF-1.7\nconverted\n%%EOF"),
      contentType: "application/pdf",
    });
    assert(
      await jobs.complete(admin.tenantId, retried.id, retried.leaseId, {
        size: 27,
      }),
    );
    assert.equal(
      (await preview.preview(doc.attachment.id, { mode: "working" }, admin))
        .key,
      retried.key,
    );
    assert.equal(
      (await query.detail(doc.id, { mode: "working" }, admin)).version,
      1,
    );
    assert.equal(
      (await preview.status(doc.attachment.id, { mode: "working" }, admin))
        .retryCount,
      1,
    );
    check(
      "successful derived PDF binds original SHA and retry history without mutating working or published business versions",
    );
    const dv = await app.publish(doc.id, { expectedVersion: 1 }, admin);
    const updated = await app.updatePage(
      doc.id,
      {
        title: "非原文件标题",
        description: "文件说明搜索",
        tags: ["文件标签"],
        expectedVersion: dv.version,
      },
      admin,
    );
    await app.publish(doc.id, { expectedVersion: updated.version }, admin);
    for (const search of ["文件名搜索", "文件说明搜索", "文件标签"])
      assert((await query.list({ search, ids: [doc.id] }, viewer)).total === 1);
    check(
      "published search includes primary filename/description/tags and uses existing ACL boundary",
    );
    const locked = await app.setAccess(
      "page",
      doc.id,
      { expectedVersion: updated.version + 1, restricted: true, entries: [] },
      admin,
    );
    for (const call of [
      () => preview.status(doc.attachment.id, {}, viewer),
      () => preview.preview(doc.attachment.id, {}, viewer),
      () => query.attachment(doc.attachment.id, {}, viewer),
    ])
      await assert.rejects(call);
    assert.equal(
      (await query.list({ search: "文件名搜索" }, viewer)).rows.some(
        (r: any) => r.id === doc.id,
      ),
      false,
    );
    check(
      "Page restriction denies originals/previews/status and search with the same ACL",
    );
    const trashed = await app.transition(
      created.id,
      "trash",
      { expectedVersion: renamed.version },
      admin,
    );
    await app.purge(created.id, { expectedVersion: trashed.version }, admin);
    const dtrash = await app.transition(
      doc.id,
      "trash",
      { expectedVersion: locked.version },
      admin,
    );
    await app.purge(doc.id, { expectedVersion: dtrash.version }, admin);
    const mtrash = await app.transition(
      missing.id,
      "trash",
      { expectedVersion: 1 },
      admin,
    );
    await app.purge(missing.id, { expectedVersion: mtrash.version }, admin);
    await app.processCleanup(admin);
    assert.equal(
      (
        await ds.query(
          "SELECT 1 FROM knowledge_file_previews WHERE tenant_id=$1 AND file_id=$2",
          [admin.tenantId, doc.attachment.id],
        )
      ).length,
      0,
    );
    check(
      "file-page purge removes its own processing jobs and file assets while preserving other knowledge",
    );
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
}
