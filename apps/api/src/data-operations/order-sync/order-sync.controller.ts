import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../../auth";
import { OrderSyncApplicationService } from "./order-sync.application.service";
import { OrderSyncRepository } from "./order-sync.repository";
import type { CommitSyncBatch, ConfigureProjectionConsumer, StartSyncRun, SyncActor } from "./order-sync.types";

type UserRequest = Request & { user: any; requestId: string };
const actor = (req: UserRequest): SyncActor => ({ userId: req.user.sub, displayName: req.user.displayName ?? req.user.username, requestId: req.requestId, source: req.user.apiKeyId ? "API" : "WEB" });
const assertImport = (req: UserRequest) => {
  const permissions = req.user.permissions ?? [];
  if (!(permissions.includes("*") || permissions.includes("erp-order-staging:*:import") || permissions.includes("customer-data-import:*:import") || permissions.includes("tplus-sales-orders:*:import"))) throw new ForbiddenException("没有ERP staging同步权限");
};

@ApiTags("ERP订单staging同步") @ApiBearerAuth() @UseGuards(AuthGuard)
@Controller("data-operations/order-sync")
export class OrderSyncController {
  constructor(private readonly application: OrderSyncApplicationService, private readonly repository: OrderSyncRepository) {}
  @Get("sources") state(@Req() req: UserRequest) { assertImport(req); return this.repository.state(); }
  @Get("sources/:sourceKey") sourceState(@Param("sourceKey") sourceKey: string, @Req() req: UserRequest) { assertImport(req); return this.repository.state(sourceKey); }
  @Post("runs") start(@Body() body: StartSyncRun, @Req() req: UserRequest) { assertImport(req); return this.application.start(body, actor(req)); }
  @Post("batches") commit(@Body() body: CommitSyncBatch, @Req() req: UserRequest) { assertImport(req); return this.application.commit(body, actor(req)); }
  @Post("runs/:runId/complete") complete(@Param("runId") runId: string, @Body() body: { sourceKey: string; metrics?: unknown }, @Req() req: UserRequest) { assertImport(req); return this.application.complete(runId, body.sourceKey, body.metrics, actor(req)); }
  @Post("runs/:runId/fail") fail(@Param("runId") runId:string,@Body() body:{sourceKey:string;errorMessage:string;retryCount:number},@Req() req:UserRequest) { assertImport(req); return this.application.fail(runId,body.sourceKey,body.errorMessage,body.retryCount,actor(req)); }
  @Get("report") report(@Req() req:UserRequest) { assertImport(req); return this.repository.report(); }
  @Get("projection-consumers") projectionConsumers(@Req() req:UserRequest) { assertImport(req); return this.repository.projectionConsumers(); }
  @Put("projection-consumers/:consumerKey") configureProjection(@Param("consumerKey") consumerKey:string,@Body() body:ConfigureProjectionConsumer,@Req() req:UserRequest) {
    if (req.user.isSystemAdmin !== true && !(req.user.permissions ?? []).includes("*")) throw new ForbiddenException("仅系统管理员可配置数据分发订阅");
    return this.application.configureProjection(consumerKey,body,actor(req));
  }
  @Post("projection-consumers/:consumerKey/claim") claimProjection(@Param("consumerKey") consumerKey:string,@Req() req:UserRequest) {
    assertImport(req); return this.application.claimProjection(consumerKey,actor(req));
  }
  @Post("projection-consumers/:consumerKey/complete") completeProjection(@Param("consumerKey") consumerKey:string,@Body() body:{leaseToken:string},@Req() req:UserRequest) {
    assertImport(req); return this.application.completeProjection(consumerKey,body.leaseToken,actor(req));
  }
  @Post("projection-consumers/:consumerKey/fail") failProjection(@Param("consumerKey") consumerKey:string,@Body() body:{leaseToken:string;errorMessage:string},@Req() req:UserRequest) {
    assertImport(req); return this.application.failProjection(consumerKey,body.leaseToken,body.errorMessage,actor(req));
  }
  @Post("projection-consumers/initialize-formal") initializeFormal(@Req() req:UserRequest) {
    if (req.user.isSystemAdmin !== true && !(req.user.permissions ?? []).includes("*")) throw new ForbiddenException("仅系统管理员可初始化正式业务表投影");
    return this.application.initializeFormalProjections(actor(req));
  }
  @Post("projection-consumers/:consumerKey/project") projectFormal(@Param("consumerKey") consumerKey:string,@Req() req:UserRequest) {
    assertImport(req); return this.application.projectFormalBatch(consumerKey,actor(req));
  }
}
