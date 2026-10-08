import {
  BadRequestException,
  Inject,
  Injectable,
  OnModuleDestroy,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import mammoth from "mammoth";
import type {
  KnowledgeContentNode,
  KnowledgeImportPreview,
} from "@kdos/contracts";
import { assertSpreadsheetNotEncrypted } from "../../spreadsheet-upload";
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from "../../storage/object-storage";
import { KnowledgeApplicationService } from "./knowledge.application.service";
import {
  canonicalKnowledgeContent,
  knowledgeTags,
  knowledgeText,
} from "./knowledge.content";
import { knowledgeFile, knowledgeOfficeArchive } from "./knowledge.file";
import { knowledgeHtmlContent } from "./knowledge.document";
import {
  assertKnowledgeAction,
  assertKnowledgeFields,
} from "./knowledge.scope";
import type { KnowledgeActor } from "./knowledge.types";

type Preview = KnowledgeImportPreview & {
  tenant: string;
  user: string | null;
  bytes: number;
  sourceHash: string;
  sourceName: string;
  files: Express.Multer.File[];
  busy: boolean;
};
@Injectable()
export class KnowledgeImportService implements OnModuleDestroy {
  private previews = new Map<string, Preview>();
  constructor(
    private readonly application: KnowledgeApplicationService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}
  onModuleDestroy() {
    this.previews.clear();
  }
  async preview(
    file: Express.Multer.File,
    actor: KnowledgeActor,
  ): Promise<KnowledgeImportPreview> {
    assertKnowledgeAction(actor, "knowledge-pages", "import");
    assertKnowledgeFields(actor, "knowledge-pages", [
      "title",
      "content",
      "tags",
      "spaceId",
      "parentId",
    ]);
    assertSpreadsheetNotEncrypted(file?.buffer);
    if (!file?.buffer?.length || file.buffer.length > 20 * 1024 * 1024)
      throw new BadRequestException("请选择 20MB 以内的非空文档");
    const name = knowledgeText(file.originalname, "文件名", 255, true),
      extension = name.split(".").pop()?.toLowerCase();
    if (!["docx", "md", "markdown", "html", "htm"].includes(extension ?? ""))
      throw new BadRequestException("本轮支持 DOCX、Markdown、HTML 导入");
    const files: Express.Multer.File[] = [],
      warnings: string[] = [];
    let html = "";
    let bytes = file.buffer.length;
    const addImage = async (body: Buffer, type: string) => {
      if (
        files.length >= 20 ||
        body.length > 10 * 1024 * 1024 ||
        (bytes += body.length) > 100 * 1024 * 1024
      )
        throw new BadRequestException("文档图片数量或解压大小超过限制");
      const ext = (
        {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
        } as Record<string, string>
      )[type];
      if (!ext) {
        warnings.push(`跳过不支持的图片格式 ${type}`);
        return "";
      }
      const f = {
        originalname: `image-${files.length + 1}.${ext}`,
        buffer: body,
        mimetype: type,
      } as Express.Multer.File;
      await knowledgeFile(f);
      const index = files.push(f) - 1;
      return `knowledge-image:${index}`;
    };
    try {
      if (extension === "docx") {
        await knowledgeOfficeArchive(file.buffer, "docx");
        const converted = await mammoth.convertToHtml(
          { buffer: file.buffer },
          {
            externalFileAccess: false,
            convertImage: mammoth.images.imgElement(async (img) => ({
              src: await addImage(
                Buffer.from(await img.read("base64"), "base64"),
                img.contentType,
              ),
            })),
            styleMap: [
              "p[style-name='Heading 1'] => h1:fresh",
              "p[style-name='Heading 2'] => h2:fresh",
              "p[style-name='Heading 3'] => h3:fresh",
            ],
          },
        );
        html = converted.value;
        warnings.push(...converted.messages.map((m) => m.message));
      } else {
        if (file.buffer.includes(0))
          throw new BadRequestException("文本文件编码无效，请使用 UTF-8");
        const text = file.buffer.toString("utf8");
        if (text.includes("\ufffd"))
          throw new BadRequestException("文本文件编码无效，请使用 UTF-8");
        if (extension === "md" || extension === "markdown") {
          // Native import also works for Marked's ESM distribution in our CommonJS API.
          const marked = await (new Function(
            "return import('marked')",
          )() as Promise<typeof import("marked")>);
          html = await marked.marked.parse(text, { gfm: true });
        } else html = text;
        const images = [
          ...html.matchAll(
            /<img\b[^>]*\bsrc\s*=\s*["'](data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+))["']/gi,
          ),
        ];
        for (const match of images) {
          const type = match[1].slice(5, match[1].indexOf(";"));
          const src = await addImage(Buffer.from(match[2], "base64"), type);
          html = html.replace(match[1], src);
        }
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException("文档解析失败，请检查文件格式或是否损坏");
    }
    const content = knowledgeHtmlContent(html, (src, alt) => {
      const match = /^knowledge-image:(\d+)$/.exec(src);
      if (!match || !files[Number(match[1])]) {
        warnings.push("外部或相对路径图片未下载；请在导入后上传图片");
        return null;
      }
      return {
        type: "attachmentImage",
        attrs: {
          attachmentId: `00000000-0000-7000-8000-${Number(match[1]).toString().padStart(12, "0")}`,
          alt,
        },
      };
    });
    const canonical = canonicalKnowledgeContent(content);
    const title = name.replace(/\.[^.]+$/, "").slice(0, 300);
    const token = randomBytes(32).toString("hex"),
      expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    this.expire();
    if (
      this.previews.size >= 50 ||
      [...this.previews.values()].reduce((n, p) => n + p.bytes, 0) + bytes >
        200 * 1024 * 1024
    )
      throw new BadRequestException("导入预览繁忙，请稍后重试");
    const out = {
      token,
      title,
      content: canonical.content,
      contentText: canonical.contentText,
      images: files.map((f, index) => ({ index, name: f.originalname })),
      warnings: [...new Set(warnings)],
      expiresAt,
    };
    this.previews.set(token, {
      ...out,
      tenant: actor.tenantId,
      user: actor.userId,
      bytes,
      sourceHash: createHash("sha256").update(file.buffer).digest("hex"),
      sourceName: name,
      files,
      busy: false,
    });
    return out;
  }
  async commit(input: Record<string, unknown>, actor: KnowledgeActor) {
    assertKnowledgeAction(actor, "knowledge-pages", "import");
    this.application.keys(input, [
      "token",
      "spaceId",
      "parentId",
      "title",
      "tags",
      "restricted",
      "entries",
    ]);
    this.expire();
    const p = this.previews.get(String(input.token));
    if (!p || p.tenant !== actor.tenantId || p.user !== actor.userId)
      throw new BadRequestException("导入预览不存在或已过期，请重新预览");
    if (p.busy) throw new BadRequestException("导入正在提交，请勿重复操作");
    p.busy = true;
    const stored: string[] = [];
    try {
      const result = await this.application.command(actor, async (m) => {
        const page = await this.application.createPageIn(
          m,
          {
            spaceId: String(input.spaceId),
            parentId: input.parentId == null ? null : String(input.parentId),
            title: knowledgeText(input.title ?? p.title, "标题", 300, true),
            tags: knowledgeTags(input.tags ?? []),
          },
          actor,
          "import",
        );
        const images: Record<string, string> = {};
        if (p.files.length)
          assertKnowledgeFields(actor, "knowledge-pages", ["attachmentIds"]);
        for (let i = 0; i < p.files.length; i++) {
          const f = await this.application.uploadIn(
            m,
            page.id,
            p.files[i],
            actor,
          );
          stored.push(f.key);
          images[`00000000-0000-7000-8000-${i.toString().padStart(12, "0")}`] =
            f.attachment.id;
        }
        const content = JSON.parse(JSON.stringify(p.content), (k, v) =>
          k === "attachmentId" ? (images[v] ?? v) : v,
        ) as KnowledgeContentNode;
        const updated = await this.application.updatePageIn(
          m,
          page.id,
          { content, expectedVersion: 1 },
          actor,
        );
        let version = updated.version;
        if (input.restricted === true) {
          assertKnowledgeFields(actor, "knowledge-pages", ["access"]);
          await this.application.lockPage(m, page.id, actor, "update", 3);
          const entries = await this.application.accessEntries(
            m,
            input.entries ?? [],
          );
          for (const e of entries)
            await m.query(
              `INSERT INTO knowledge_page_access(tenant_id,page_id,subject_type,subject_id,access_level,created_by,updated_by) VALUES($1,$2,$3,$4::uuid,$5,$6::uuid,$6::text)`,
              [
                actor.tenantId,
                page.id,
                e.subjectType,
                e.subjectId,
                e.accessLevel,
                actor.userId,
              ],
            );
          await m.query(
            "UPDATE knowledge_pages SET access_restricted=true,version=version+1 WHERE tenant_id=$1 AND id=$2",
            [actor.tenantId, page.id],
          );
          version++;
        }
        await this.application.audit(
          m,
          actor,
          "knowledge-pages",
          page.id,
          "page.imported",
          {
            sourceName: p.sourceName,
            sourceHash: p.sourceHash,
            imageCount: p.files.length,
            status: "DRAFT",
          },
        );
        return { id: page.id, version, status: "DRAFT" };
      });
      this.previews.delete(p.token);
      return result;
    } catch (e) {
      await Promise.allSettled(stored.map((k) => this.storage.delete(k)));
      p.busy = false;
      throw e;
    }
  }
  private expire() {
    for (const [k, p] of this.previews)
      if (!p.busy && Date.parse(p.expiresAt) <= Date.now())
        this.previews.delete(k);
  }
}
