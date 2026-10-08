import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Inject,
  NotFoundException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import type { KnowledgePageInput } from "@kdos/contracts";
import { AuthGuard } from "../../auth";
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from "../../storage/object-storage";
import { KnowledgeApplicationService } from "./knowledge.application.service";
import { KnowledgeQueryService } from "./knowledge.query.service";
import { KnowledgeImportService } from "./knowledge.import.service";
import { KnowledgeExportService } from "./knowledge.export.service";
import type { KnowledgeActor } from "./knowledge.types";
type KnowledgeRequest = Request & { user: any; requestId: string };
@ApiTags("Knowledge 2.0")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("knowledge")
export class KnowledgeController {
  constructor(
    private readonly application: KnowledgeApplicationService,
    private readonly queries: KnowledgeQueryService,
    private readonly imports: KnowledgeImportService,
    private readonly exports: KnowledgeExportService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}
  @Get("spaces") spaces(
    @Query("includeArchived") archived: string,
    @Req() req: KnowledgeRequest,
  ) {
    return this.queries.spaces(this.actor(req), archived === "true");
  }
  @Post("spaces") createSpace(
    @Body() body: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.application.createSpace(body, this.actor(req));
  }
  @Patch("spaces/:id") updateSpace(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.application.updateSpace(id, body, this.actor(req));
  }
  @Delete("spaces/:id") archiveSpace(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.application.archiveSpace(id, body, this.actor(req));
  }
  @Get("spaces/:id/access") spaceAccess(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: KnowledgeRequest,
  ) {
    return this.queries.spaceAccess(id, this.actor(req));
  }
  @Patch("spaces/:id/access") setSpaceAccess(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.application.setAccess("space", id, body, this.actor(req));
  }
  @Get("spaces/:id/tree") tree(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() input: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.queries.tree(id, input, this.actor(req));
  }
  @Get("options") options(@Req() req: KnowledgeRequest) {
    return this.queries.options(this.actor(req));
  }
  @Get("pages") pages(
    @Query() input: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.queries.list(input, this.actor(req));
  }
  @Post("pages") createPage(
    @Body() body: KnowledgePageInput,
    @Req() req: KnowledgeRequest,
  ) {
    return this.application.createPage(body, this.actor(req));
  }
  @Get("search") search(
    @Query() input: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.queries.list({ ...input, mode: "published" }, this.actor(req));
  }
  @Post("imports/preview")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    }),
  )
  preview(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: KnowledgeRequest,
  ) {
    return this.imports.preview(file, this.actor(req));
  }
  @Post("imports/commit") commit(
    @Body() body: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.imports.commit(body, this.actor(req));
  }
  @Post("attachments/cleanup") cleanup(@Req() req: KnowledgeRequest) {
    return this.application.cleanOrphans(this.actor(req));
  }
  @Get("pages/:id") page(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() input: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.queries.detail(id, input, this.actor(req));
  }
  @Patch("pages/:id") updatePage(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.application.updatePage(id, body, this.actor(req));
  }
  @Patch("pages/:id/access") setPageAccess(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.application.setAccess("page", id, body, this.actor(req));
  }
  @Post("pages/:id/publish") publish(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.application.publish(id, body, this.actor(req));
  }
  @Post("pages/:id/move") move(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.application.move(id, body, this.actor(req));
  }
  @Post("pages/:id/archive") archive(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.application.transition(id, "archive", body, this.actor(req));
  }
  @Post("pages/:id/unarchive") unarchive(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.application.transition(id, "unarchive", body, this.actor(req));
  }
  @Delete("pages/:id") trash(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.application.transition(id, "trash", body, this.actor(req));
  }
  @Post("pages/:id/restore") restore(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.application.transition(id, "restore", body, this.actor(req));
  }
  @Delete("pages/:id/permanent") purge(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.application.purge(id, body, this.actor(req));
  }
  @Get("pages/:id/versions") versions(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("mode") mode: string,
    @Req() req: KnowledgeRequest,
  ) {
    return this.queries.versions(id, this.actor(req), mode);
  }
  @Get("pages/:id/versions/:versionId") version(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("versionId", ParseUUIDPipe) versionId: string,
    @Query("mode") mode: string,
    @Req() req: KnowledgeRequest,
  ) {
    return this.queries.detail(id, { mode, versionId }, this.actor(req));
  }
  @Get("pages/:id/export") async exportPage(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() input: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
    @Res() res: Response,
  ) {
    const file = await this.exports.page(id, input, this.actor(req));
    res.setHeader("Content-Type", file.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.filename}"`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(file.body);
  }
  @Post("pages/:id/attachments")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 20 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: KnowledgeRequest,
  ) {
    return this.application.upload(id, body, file, this.actor(req));
  }
  @Delete("attachments/:id") remove(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
  ) {
    return this.application.removeAttachment(id, body, this.actor(req));
  }
  @Get("attachments/:id") async attachment(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() input: Record<string, unknown>,
    @Req() req: KnowledgeRequest,
    @Res() res: Response,
  ) {
    const file = await this.queries.attachment(id, input, this.actor(req)),
      object = await this.storage.get(file.key);
    if (!object) throw new NotFoundException("附件文件不存在");
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "Content-Disposition",
      `${file.contentType.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    );
    res.send(object.body);
  }
  private actor(req: KnowledgeRequest): KnowledgeActor {
    return {
      tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN",
      userId: req.user?.sub ?? null,
      username: req.user?.username ?? "unknown",
      displayName: req.user?.displayName,
      permissions: req.user?.permissions ?? [],
      isSystemAdmin: req.user?.isSystemAdmin === true,
      moduleAdminCodes: req.user?.moduleAdminCodes ?? [],
      tableDataScopes: req.user?.tableDataScopes ?? [],
      requestId: req.requestId,
      source: req.user?.apiKeyId ? "api" : "web",
    };
  }
}
