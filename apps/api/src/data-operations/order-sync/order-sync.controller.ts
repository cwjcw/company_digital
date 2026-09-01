import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthGuard } from "../../auth";
import { OrderSyncApplicationService } from "./order-sync.application.service";
import { OrderSyncRepository } from "./order-sync.repository";
import type { CommitSyncBatch, StartSyncRun, SyncActor } from "./order-sync.types";
import { OrderReviewService } from "./order-review.service";

type UserRequest = Request & { user: any; requestId: string };
const actor = (req: UserRequest): SyncActor => ({ userId: req.user.sub, displayName: req.user.displayName ?? req.user.username, requestId: req.requestId, source: req.user.apiKeyId ? "API" : "WEB" });
const assertImport = (req: UserRequest) => {
  const permissions = req.user.permissions ?? [];
  if (!(permissions.includes("*") || permissions.includes("erp-order-staging:*:import") || permissions.includes("customer-data-import:*:import") || permissions.includes("tplus-sales-orders:*:import"))) throw new ForbiddenException("没有ERP staging同步权限");
};
const assertReview = (req: UserRequest, action: "read"|"update"|"export"|"import") => {
  const permissions=req.user.permissions ?? [];
  if (!(permissions.includes("*") || permissions.includes(`duplicate-order-review:*:${action}`))) throw new ForbiddenException("没有重复订单复核权限");
};
const canImportSync = (req:UserRequest) => {
  const permissions=req.user.permissions ?? [];
  return permissions.includes("*") || permissions.includes("erp-order-staging:*:import") || permissions.includes("customer-data-import:*:import") || permissions.includes("tplus-sales-orders:*:import");
};

@ApiTags("ERP订单staging同步") @ApiBearerAuth() @UseGuards(AuthGuard)
@Controller("data-operations/order-sync")
export class OrderSyncController {
  constructor(private readonly application: OrderSyncApplicationService, private readonly repository: OrderSyncRepository, private readonly reviews: OrderReviewService) {}
  @Get("sources") state(@Req() req: UserRequest) { assertImport(req); return this.repository.state(); }
  @Get("sources/:sourceKey") sourceState(@Param("sourceKey") sourceKey: string, @Req() req: UserRequest) { assertImport(req); return this.repository.state(sourceKey); }
  @Post("runs") start(@Body() body: StartSyncRun, @Req() req: UserRequest) { assertImport(req); return this.application.start(body, actor(req)); }
  @Post("batches") commit(@Body() body: CommitSyncBatch, @Req() req: UserRequest) { assertImport(req); return this.application.commit(body, actor(req)); }
  @Post("runs/:runId/complete") complete(@Param("runId") runId: string, @Body() body: { sourceKey: string; metrics?: unknown }, @Req() req: UserRequest) { assertImport(req); return this.application.complete(runId, body.sourceKey, body.metrics, actor(req)); }
  @Post("runs/:runId/fail") fail(@Param("runId") runId:string,@Body() body:{sourceKey:string;errorMessage:string;retryCount:number},@Req() req:UserRequest) { assertImport(req); return this.application.fail(runId,body.sourceKey,body.errorMessage,body.retryCount,actor(req)); }
  @Get("report") report(@Req() req:UserRequest) { assertImport(req); return this.repository.report(); }
  @Get("reviews") reviewList(@Query("level") level: string|undefined,@Query("status") status: string|undefined,@Query("page") page: string|undefined,@Query("pageSize") pageSize: string|undefined,@Req() req:UserRequest) {
    assertReview(req,"read"); return this.reviews.list(level,status,Number(page||1),Number(pageSize||50));
  }
  @Patch("reviews/:id") reviewConfirm(@Param("id") id:string,@Body() body:{expectedVersion:number;status:string;remark?:string|null},@Req() req:UserRequest) {
    assertReview(req,"update"); return this.reviews.confirm(id,body,actor(req));
  }
  @Post("reviews/rebuild") reviewRebuild(@Req() req:UserRequest) { if (!canImportSync(req)) assertReview(req,"import"); return this.reviews.rebuild(actor(req)); }
  @Get("reviews-export.xlsx") async reviewExport(@Req() req:UserRequest,@Res() response:Response) {
    if (!canImportSync(req)) assertReview(req,"export"); const data=await this.reviews.workbook(); response.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    response.setHeader("Content-Disposition",`attachment; filename*=UTF-8''${encodeURIComponent("重复订单业务复核.xlsx")}`); response.send(data);
  }
  @Get("quality-report") quality(@Req() req:UserRequest) { if (!canImportSync(req)) assertReview(req,"read"); return this.reviews.qualityReport(); }
}
