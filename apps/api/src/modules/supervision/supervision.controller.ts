import { randomUUID } from "node:crypto";
import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors, ForbiddenException, BadRequestException, NotFoundException } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthGuard } from "../../auth";
import { OBJECT_STORAGE, type ObjectStorage } from "../../storage/object-storage";
import { hasSupervisionPermission } from "./supervision.scope";
import { SupervisionApplicationService } from "./supervision.application.service";
import { SupervisionQueryService } from "./supervision.query.service";
import type { SupervisionActor } from "./supervision.types";

type SupervisionRequest = Request & { user: any; requestId: string };

@ApiTags("项目与任务·任务督办")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("supervision")
export class SupervisionController {
  constructor(
    private readonly application: SupervisionApplicationService,
    private readonly queries: SupervisionQueryService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage
  ) {}

  @Get("options") options(@Req() request: SupervisionRequest) { return this.queries.options(this.actor(request)); }
  @Get("dashboard/projects") projectDashboard(@Query() query: Record<string, unknown>, @Req() request: SupervisionRequest) { return this.queries.projectDashboard(query, this.actor(request)); }
  @Get("dashboard/my-tasks") employeeDashboard(@Query() query: Record<string, unknown>, @Req() request: SupervisionRequest) { return this.queries.employeeDashboard(query, this.actor(request)); }
  @Get("reports/owners") ownerReport(@Query() query: Record<string, unknown>, @Req() request: SupervisionRequest) { return this.queries.ownerReport(query, this.actor(request)); }
  @Get("reports/owners/:ownerId/tasks") ownerReportTasks(@Param("ownerId") ownerId: string, @Query() query: Record<string, unknown>, @Req() request: SupervisionRequest) { return this.queries.ownerReportTasks(ownerId, query, this.actor(request)); }

  @Post("projects") createProject(@Body() body: any, @Req() request: SupervisionRequest) { return this.application.createProject(body, this.actor(request)); }
  @Patch("projects/:id") updateProject(@Param("id") id: string, @Body() body: any, @Req() request: SupervisionRequest) { return this.application.updateProject(id, body, this.actor(request)); }
  @Post("projects/:id/complete") completeProject(@Param("id") id: string, @Body() body: any, @Req() request: SupervisionRequest) { return this.application.completeProject(id, body, this.actor(request)); }
  @Post("projects/:id/abort") abortProject(@Param("id") id: string, @Body() body: any, @Req() request: SupervisionRequest) { return this.application.abortProject(id, body, this.actor(request)); }

  @Post("tasks") createTask(@Body() body: any, @Req() request: SupervisionRequest) { return this.application.createTask(body, this.actor(request)); }
  @Patch("tasks/:id") updateTask(@Param("id") id: string, @Body() body: any, @Req() request: SupervisionRequest) { return this.application.updateTask(id, body, this.actor(request)); }
  @Post("tasks/:id/progress") addProgress(@Param("id") id: string, @Body() body: any, @Req() request: SupervisionRequest) { return this.application.addProgress({ ...body, taskId: id }, this.actor(request)); }
  @Post("tasks/:id/change-due-date") changeDueDate(@Param("id") id: string, @Body() body: any, @Req() request: SupervisionRequest) { return this.application.changeTaskDueDate(id, body, this.actor(request)); }
  @Post("tasks/:id/complete") completeTask(@Param("id") id: string, @Body() body: any, @Req() request: SupervisionRequest) { return this.application.completeTask(id, body, this.actor(request)); }
  @Post("tasks/:id/abort") abortTask(@Param("id") id: string, @Body() body: any, @Req() request: SupervisionRequest) { return this.application.abortTask(id, body, this.actor(request)); }

  @Post("attachments")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  async uploadAttachment(@UploadedFile() file: Express.Multer.File, @Req() request: SupervisionRequest) {
    if (!file?.buffer?.length) throw new BadRequestException("请选择需要上传的附件");
    const actor = this.actor(request);
    const allowed = ["supervision-projects", "supervision-tasks", "supervision-task-progress"].some((resource) =>
      hasSupervisionPermission(actor, resource, "create") || hasSupervisionPermission(actor, resource, "update"));
    if (!allowed) throw new ForbiddenException("当前权限组不能上传督办附件");
    const safeTenant = actor.tenantId.replace(/[^A-Za-z0-9_-]/g, "_");
    const safeName = String(file.originalname || "attachment").normalize("NFKC").replace(/[^\p{L}\p{N}_.-]+/gu, "_").slice(-120) || "attachment";
    const attachment = { key: `supervision/${safeTenant}/${randomUUID()}/${safeName}`, name: String(file.originalname || safeName).slice(0, 255), contentType: String(file.mimetype || "application/octet-stream"), size: file.size };
    await this.storage.put({ key: attachment.key, body: file.buffer, contentType: attachment.contentType });
    try { await this.application.recordAttachmentUpload(attachment, actor); }
    catch (error) { await this.storage.delete(attachment.key); throw error; }
    return attachment;
  }

  @Get("attachments/:resource/:id/:index")
  async downloadAttachment(@Param("resource") resource: "projects" | "tasks" | "progress", @Param("id") id: string, @Param("index") rawIndex: string, @Req() request: SupervisionRequest, @Res() response: Response) {
    if (!(["projects", "tasks", "progress"] as string[]).includes(resource)) throw new BadRequestException("附件资源无效");
    const index = Number(rawIndex); if (!Number.isInteger(index) || index < 0) throw new BadRequestException("附件序号无效");
    const attachment = await this.queries.attachment(resource, id, index, this.actor(request));
    const object = await this.storage.get(attachment.key); if (!object) throw new NotFoundException("附件文件不存在");
    response.setHeader("Content-Type", attachment.contentType || object.contentType);
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`);
    response.send(object.body);
  }

  private actor(request: SupervisionRequest): SupervisionActor {
    return {
      tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN", userId: request.user?.sub ?? null,
      username: request.user?.username ?? "unknown", displayName: request.user?.displayName ?? request.user?.username ?? "unknown",
      permissions: request.user?.permissions ?? [], isSystemAdmin: request.user?.isSystemAdmin === true,
      moduleAdminCodes: request.user?.moduleAdminCodes ?? [], tableDataScopes: request.user?.tableDataScopes ?? [], requestId: request.requestId, source: "web"
    };
  }
}
