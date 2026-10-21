import { Body, Controller, Get, Patch, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../auth';
import { ReviewDueDateApplicationService } from './review-due-date.application.service';
import type { MasterPlanActor } from './master-plan.types';
import { ReviewDueDateQueryService } from './review-due-date.query.service';
@UseGuards(AuthGuard)
@Controller('master-plan-system/review-due-dates')
export class ReviewDueDateController {
  constructor(private readonly queries:ReviewDueDateQueryService,private readonly application:ReviewDueDateApplicationService){}
  @Get(':id/history') history(@Param('id') id:string,@Query() query:Record<string,unknown>,@Req() req:Request&{user:any}){
    return this.queries.history(id,query,this.actor(req));
  }
  @Patch(':id/manual-edit') manualEdit(@Param('id') id:string,@Body() body:Record<string,unknown>,@Req() req:Request&{user:any}){
    return this.application.manualEdit(id,body,this.actor(req));
  }
  private actor(req:Request&{user:any}):MasterPlanActor {
    return {tenantId:process.env.KDOS_DEFAULT_TENANT_CODE??'KAINAN',userId:req.user?.sub??null,
      username:req.user?.displayName??req.user?.username??'unknown',permissions:req.user?.permissions??[],
      isSystemAdmin:req.user?.isSystemAdmin===true,moduleAdminCodes:req.user?.moduleAdminCodes??[],tableDataScopes:req.user?.tableDataScopes??[],
      requestId:(req as Request&{requestId?:string}).requestId??'',source:'web'};
  }
}
