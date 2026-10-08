import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { KnowledgeContentNode } from "@kdos/contracts";
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from "../../storage/object-storage";
import { KnowledgeQueryService } from "./knowledge.query.service";
import { assertKnowledgeFields } from "./knowledge.scope";
import {
  knowledgeContentHtml,
  knowledgeContentMarkdown,
} from "./knowledge.document";
import type { KnowledgeActor } from "./knowledge.types";
@Injectable()
export class KnowledgeExportService {
  constructor(
    private readonly queries: KnowledgeQueryService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}
  async page(
    id: string,
    input: Record<string, unknown>,
    actor: KnowledgeActor,
  ) {
    const format = input.format ?? "md";
    if (!["md", "html"].includes(String(format)))
      throw new BadRequestException("支持 Markdown 和 HTML 导出");
    assertKnowledgeFields(
      actor,
      "knowledge-pages",
      ["title", "content", "attachmentIds"],
      "read",
    );
    const page = await this.queries.detail(id, input, actor, "export"),
      images = new Map<string, string>();
    for (const file of page.attachments ?? []) {
      if (!file.contentType.startsWith("image/")) continue;
      const meta = await this.queries.attachment(file.id, input, actor),
        object = await this.storage.get(meta.key);
      if (object)
        images.set(
          file.id,
          `data:${file.contentType};base64,${object.body.toString("base64")}`,
        );
    }
    const image = (fileId: string) => images.get(fileId) ?? "";
    const title = String(page.title).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
    const content = page.content as KnowledgeContentNode;
    const text =
      format === "html"
        ? `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title><style>body{max-width:900px;margin:2rem auto;font-family:sans-serif}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:8px}img{max-width:100%}pre{white-space:pre-wrap}</style></head><body><h1>${title}</h1>${knowledgeContentHtml(content, image)}</body></html>`
        : `# ${String(page.title).replace(/\n/g, " ")}\n\n${knowledgeContentMarkdown(content, image)}`;
    return {
      body: Buffer.from(text),
      contentType:
        format === "html"
          ? "text/html; charset=utf-8"
          : "text/markdown; charset=utf-8",
      filename: `knowledge_page_${id}.${format}`,
    };
  }
}
