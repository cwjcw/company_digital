import { Body, Controller, Get, Headers, Ip, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../../auth";
import type { PlanningActor } from "../planning/planning.types";
import { PlanningOperationsApplicationService } from "./planning-operations.application.service";
type OperationRequest=Request&{user:any;requestId:string};
@ApiTags("主计划运营表") @ApiBearerAuth() @UseGuards(AuthGuard) @Controller("planning-operations")
export class PlanningOperationsController {
  constructor(private readonly application: PlanningOperationsApplicationService) {}
  private actor(req:OperationRequest,tenant:string|undefined,ip:string):PlanningActor{return{tenantCode:tenant||process.env.KDOS_DEFAULT_TENANT_CODE||"KAINAN",userId:req.user?.sub??null,permissions:req.user?.permissions??[],roles:req.user?.roles??[],requestId:req.requestId,traceId:String(req.headers["x-trace-id"]??req.requestId),ip,source:req.user?.apiKeyId?"API":"WEB"};}
  @Get("weekly-periods") periods(@Req() req:OperationRequest,@Headers("x-tenant-code") tenant:string|undefined,@Ip() ip:string){return this.application.weeklyPeriods(this.actor(req,tenant,ip));}
  @Get("weekly-periods/:id/items") items(@Param("id") id:string,@Query("search") search:string|undefined,@Req() req:OperationRequest,@Headers("x-tenant-code") tenant:string|undefined,@Ip() ip:string){return this.application.weeklyItems(id,search,this.actor(req,tenant,ip));}
  @Post("weekly-periods/:id/sync-order-schedules") syncWeekly(@Param("id") id:string,@Req() req:OperationRequest,@Headers("x-tenant-code") tenant:string|undefined,@Ip() ip:string){return this.application.syncWeekly(id,this.actor(req,tenant,ip));}
  @Patch("weekly-items/:id") updateWeekly(@Param("id") id:string,@Body() body:{field:string;value:string|null;expectedVersion:number},@Req() req:OperationRequest,@Headers("x-tenant-code") tenant:string|undefined,@Ip() ip:string){return this.application.updateWeekly(id,body,this.actor(req,tenant,ip));}
  @Get("work-reports") reports(@Query("date") date:string,@Query("search") search:string|undefined,@Req() req:OperationRequest,@Headers("x-tenant-code") tenant:string|undefined,@Ip() ip:string){return this.application.workReports(date,search,this.actor(req,tenant,ip));}
  @Post("work-reports/sync") syncReports(@Body() body:{date:string},@Req() req:OperationRequest,@Headers("x-tenant-code") tenant:string|undefined,@Ip() ip:string){return this.application.syncWorkReports(body.date,this.actor(req,tenant,ip));}
  @Patch("work-reports/:id") updateReport(@Param("id") id:string,@Body() body:{reportedQuantity:unknown;expectedVersion:number},@Req() req:OperationRequest,@Headers("x-tenant-code") tenant:string|undefined,@Ip() ip:string){return this.application.updateReported(id,body.reportedQuantity,body.expectedVersion,this.actor(req,tenant,ip));}
}
