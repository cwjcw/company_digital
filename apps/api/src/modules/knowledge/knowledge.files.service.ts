import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import type { EntityManager } from "typeorm";
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from "../../storage/object-storage";
import { KnowledgeApplicationService } from "./knowledge.application.service";
import { KnowledgePreviewJobs } from "./knowledge.preview.service";
import {
  validateKnowledgeUpload,
  knowledgeUploadLimit,
} from "./knowledge.upload";
import {
  assertKnowledgeAction,
  assertKnowledgeFields,
} from "./knowledge.scope";
import { knowledgeId, knowledgeText } from "./knowledge.content";
import type { KnowledgeActor } from "./knowledge.types";
import type { KnowledgeFileRole } from "@kdos/contracts";

@Injectable()
export class KnowledgeFilesService {
  constructor(
    private readonly app: KnowledgeApplicationService,
    private readonly jobs: KnowledgePreviewJobs,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}
  limits() {
    return {
      maxFileBytes: knowledgeUploadLimit(),
      maxBatchFiles: 20,
      extensions: [
        "pdf",
        "docx",
        "doc",
        "pptx",
        "ppt",
        "xlsx",
        "xls",
        "png",
        "jpg",
        "jpeg",
        "webp",
        "txt",
      ],
    };
  }
  private async store(
    m: EntityManager,
    pageId: string,
    file: Express.Multer.File,
    meta: Awaited<ReturnType<typeof validateKnowledgeUpload>>,
    role: KnowledgeFileRole,
    actor: KnowledgeActor,
  ) {
    const [{ count }] = await m.query(
      "SELECT count(*)::int count FROM knowledge_page_files WHERE tenant_id=$1 AND page_id=$2 AND role<>'PRIMARY'",
      [actor.tenantId, pageId],
    );
    if (role !== "PRIMARY" && count >= 20)
      throw new BadRequestException("每页面最多20个补充附件/正文图片");
    const fileId = uuidv7();
    let key: string | undefined;
    try {
      key = (
        await this.storage.put({
          key: `knowledge/${Buffer.from(actor.tenantId).toString("hex")}/${pageId}/${fileId}`,
          body: createReadStream(file.path),
          contentType: meta.contentType,
          visibility: "private",
        })
      ).key;
      await m.query(
        `INSERT INTO knowledge_file_assets(id,tenant_id,page_id,original_name,storage_key,content_type,size,sha256,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid,$9::text)`,
        [
          fileId,
          actor.tenantId,
          pageId,
          meta.name,
          key,
          meta.contentType,
          meta.size,
          meta.sha256,
          actor.userId,
        ],
      );
      if (role === "PRIMARY") {
        await m.query(
          "DELETE FROM knowledge_page_files WHERE tenant_id=$1 AND page_id=$2 AND role='PRIMARY'",
          [actor.tenantId, pageId],
        );
      }
      await m.query(
        "INSERT INTO knowledge_page_files(tenant_id,page_id,file_id,role) VALUES($1,$2,$3,$4)",
        [actor.tenantId, pageId, fileId, role],
      );
      await this.jobs.enqueue(m, actor.tenantId, {
        id: fileId,
        sha256: meta.sha256,
        contentType: meta.contentType,
      });
      await this.app.audit(
        m,
        actor,
        "knowledge-pages",
        pageId,
        "file.uploaded",
        {
          fileId,
          role,
          originalName: meta.name,
          size: meta.size,
          sha256: meta.sha256,
        },
      );
      return {
        key,
        attachment: {
          id: fileId,
          pageId,
          originalName: meta.name,
          contentType: meta.contentType,
          size: meta.size,
          sha256: meta.sha256,
          role,
          createdAt: new Date().toISOString(),
        },
      };
    } catch (e) {
      if (key) await this.storage.delete(key).catch(() => undefined);
      throw e;
    }
  }
  async create(
    input: Record<string, unknown>,
    file: Express.Multer.File,
    actor: KnowledgeActor,
  ) {
    assertKnowledgeAction(actor, "knowledge-pages", "create");
    assertKnowledgeFields(actor, "knowledge-pages", [
      "spaceId",
      "parentId",
      "title",
      "attachmentIds",
    ]);
    this.app.keys(input, ["spaceId", "parentId", "title", "idempotencyKey"]);
    const requestId = knowledgeId(input.idempotencyKey),
      meta = await validateKnowledgeUpload(file);
    const pageInput = {
      spaceId: knowledgeId(input.spaceId),
      parentId: input.parentId ? knowledgeId(input.parentId) : null,
      title: knowledgeText(
        input.title ?? meta.name.replace(/\.[^.]+$/, ""),
        "标题",
        300,
        true,
      ),
      contentMode: "FILE" as const,
    };
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({ ...pageInput, sha256: meta.sha256, name: meta.name }),
      )
      .digest("hex");
    let stored: string | undefined;
    try {
      return await this.app.command(actor, async (m) => {
        const [previous] = await m.query(
          "SELECT request_hash,result FROM knowledge_file_upload_requests WHERE tenant_id=$1 AND actor_id=$2 AND idempotency_key=$3",
          [actor.tenantId, actor.userId, requestId],
        );
        if (previous) {
          if (previous.request_hash !== requestHash)
            throw new BadRequestException("重复请求与原上传内容不一致");
          await this.app.lockPage(m, previous.result.id, actor, "create", 2);
          return { ...previous.result, repeated: true };
        }
        const page = await this.app.createPageIn(m, pageInput, actor);
        const asset = await this.store(
          m,
          page.id,
          file,
          meta,
          "PRIMARY",
          actor,
        );
        stored = asset.key;
        const result = {
          ...page,
          status: "DRAFT",
          attachment: asset.attachment,
          repeated: false,
        };
        await m.query(
          "INSERT INTO knowledge_file_upload_requests(tenant_id,actor_id,idempotency_key,request_hash,result) VALUES($1,$2,$3,$4,$5::jsonb)",
          [
            actor.tenantId,
            actor.userId,
            requestId,
            requestHash,
            JSON.stringify(result),
          ],
        );
        return result;
      });
    } catch (e) {
      if (stored) await this.storage.delete(stored).catch(() => undefined);
      throw e;
    }
  }
  async upload(
    pageId: string,
    input: Record<string, unknown>,
    file: Express.Multer.File,
    actor: KnowledgeActor,
  ) {
    assertKnowledgeAction(actor, "knowledge-pages", "update");
    assertKnowledgeFields(actor, "knowledge-pages", ["attachmentIds"]);
    this.app.keys(input, ["expectedVersion", "role"]);
    const role = String(input.role ?? "SUPPLEMENTAL");
    if (!["PRIMARY", "INLINE", "SUPPLEMENTAL"].includes(role))
      throw new BadRequestException("文件角色无效");
    const meta = await validateKnowledgeUpload(file);
    if (role === "INLINE" && !meta.contentType.startsWith("image/"))
      throw new BadRequestException("正文图片只能使用图片文件");
    let stored: string | undefined;
    try {
      return await this.app.command(actor, async (m) => {
        const page = await this.app.lockPage(m, pageId, actor, "update", 2);
        this.app.version(page.version, input.expectedVersion);
        if (role === "PRIMARY" && page.content_mode !== "FILE")
          throw new BadRequestException("在线文章不支持替换主文件");
        const asset = await this.store(
          m,
          pageId,
          file,
          meta,
          role as KnowledgeFileRole,
          actor,
        );
        stored = asset.key;
        await m.query(
          "UPDATE knowledge_pages SET version=version+1,updated_by=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [actor.tenantId, pageId, actor.userId],
        );
        return { attachment: asset.attachment, version: page.version + 1 };
      });
    } catch (e) {
      if (stored) await this.storage.delete(stored).catch(() => undefined);
      throw e;
    }
  }
}
