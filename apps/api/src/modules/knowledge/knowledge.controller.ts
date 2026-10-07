import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors, Inject, NotFoundException, BadRequestException } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import type { KnowledgeArticleInput } from "@kdos/contracts";
import { AuthGuard } from "../../auth";
import { OBJECT_STORAGE, type ObjectStorage } from "../../storage/object-storage";
import { KnowledgeApplicationService } from "./knowledge.application.service";
import { KnowledgeQueryService } from "./knowledge.query.service";
import type { KnowledgeActor } from "./knowledge.types";

type KnowledgeRequest = Request & { user: any; requestId: string };
@ApiTags("知识库")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("knowledge")
export class KnowledgeController {
  constructor(private readonly application: KnowledgeApplicationService, private readonly queries: KnowledgeQueryService, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}
  @Get("categories") categories(@Query("mode") mode: string, @Req() req: KnowledgeRequest) { return this.queries.categories(this.actor(req), mode === "manage"); }
  @Post("categories") createCategory(@Body() body: Record<string, unknown>, @Req() req: KnowledgeRequest) { return this.application.createCategory(body, this.actor(req)); }
  @Patch("categories/:id") updateCategory(@Param("id", ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>, @Req() req: KnowledgeRequest) { return this.application.updateCategory(id, body, this.actor(req)); }
  @Delete("categories/:id") deleteCategory(@Param("id", ParseUUIDPipe) id: string, @Body() body: { expectedVersion?: unknown }, @Req() req: KnowledgeRequest) { return this.application.deleteCategory(id, body, this.actor(req)); }
  @Get("options") options(@Req() req: KnowledgeRequest) { return this.queries.options(this.actor(req)); }
  @Get("articles") articles(@Query() query: Record<string, unknown>, @Req() req: KnowledgeRequest) { return this.queries.list(query, this.actor(req), query.mode === "manage" ? "manage" : "browse"); }
  @Post("articles") createArticle(@Body() body: KnowledgeArticleInput, @Req() req: KnowledgeRequest) { return this.application.createArticle(body, this.actor(req)); }
  @Get("articles/:id") detail(@Param("id", ParseUUIDPipe) id: string, @Query("mode") mode: string, @Req() req: KnowledgeRequest) { return this.queries.detail(id, this.actor(req), mode === "manage" ? "manage" : "browse"); }
  @Patch("articles/:id") updateArticle(@Param("id", ParseUUIDPipe) id: string, @Body() body: Partial<KnowledgeArticleInput>, @Req() req: KnowledgeRequest) { return this.application.updateArticle(id, body, this.actor(req)); }
  @Delete("articles/:id") deleteArticle(@Param("id", ParseUUIDPipe) id: string, @Body() body: { expectedVersion?: unknown }, @Req() req: KnowledgeRequest) { return this.application.deleteArticle(id, body, this.actor(req)); }
  @Post("articles/:id/publish") publish(@Param("id", ParseUUIDPipe) id: string, @Body() body: { expectedVersion?: unknown }, @Req() req: KnowledgeRequest) { return this.application.publish(id, body, this.actor(req)); }
  @Post("articles/:id/disable") disable(@Param("id", ParseUUIDPipe) id: string, @Body() body: { expectedVersion?: unknown }, @Req() req: KnowledgeRequest) { return this.application.disable(id, body, this.actor(req)); }
  @Get("articles/:id/versions") versions(@Param("id", ParseUUIDPipe) id: string, @Req() req: KnowledgeRequest) { return this.queries.versions(id, this.actor(req)); }
  @Get("articles/:id/versions/:number") version(@Param("id", ParseUUIDPipe) id: string, @Param("number") number: string, @Req() req: KnowledgeRequest) { return this.queries.detail(id, this.actor(req), "manage", this.number(number)); }
  @Post("articles/:id/attachments")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  upload(@Param("id", ParseUUIDPipe) id: string, @Body() body: { expectedVersion?: unknown }, @UploadedFile() file: Express.Multer.File, @Req() req: KnowledgeRequest) { return this.application.upload(id, body, file, this.actor(req)); }
  @Delete("articles/:id/attachments/:attachmentId") removeAttachment(@Param("id", ParseUUIDPipe) id: string, @Param("attachmentId", ParseUUIDPipe) attachmentId: string, @Body() body: { expectedVersion?: unknown }, @Req() req: KnowledgeRequest) { return this.application.removeAttachment(id, attachmentId, body, this.actor(req)); }
  @Get("attachments/:id")
  async attachment(@Param("id", ParseUUIDPipe) id: string, @Query("mode") mode: string, @Query("version") version: string | undefined, @Req() req: KnowledgeRequest, @Res() res: Response) {
    const file = await this.queries.attachment(id, this.actor(req), mode === "manage" ? "manage" : "browse", version == null ? undefined : this.number(version));
    const object = await this.storage.get(file.key); if (!object) throw new NotFoundException("附件文件不存在");
    res.setHeader("Content-Type", file.contentType); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `${["image/png", "image/jpeg", "image/webp"].includes(file.contentType) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`); res.send(object.body);
  }
  private number(raw: string) { const n = Number(raw); if (!Number.isInteger(n) || n < 1) throw new BadRequestException("发布版本无效"); return n; }
  private actor(req: KnowledgeRequest): KnowledgeActor { return { tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN", userId: req.user?.sub ?? null, username: req.user?.username ?? "unknown", displayName: req.user?.displayName, permissions: req.user?.permissions ?? [], isSystemAdmin: req.user?.isSystemAdmin === true, moduleAdminCodes: req.user?.moduleAdminCodes ?? [], tableDataScopes: req.user?.tableDataScopes ?? [], requestId: req.requestId, source: req.user?.apiKeyId ? "api" : "web" }; }
}
