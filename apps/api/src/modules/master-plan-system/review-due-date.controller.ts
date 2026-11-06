import { MasterPlanReviewApplicationService } from './master-plan.review-application.service';
import type { MpsReviewApplyRequest,MpsReviewApplyConfirm } from '@kdos/contracts';
import { Body, Controller, Get, Patch, Post, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../auth';
import { ReviewDueDateApplicationService } from './review-due-date.application.service';
import type { MasterPlanActor } from './master-plan.types';
import { ReviewDueDateQueryService } from './review-due-date.query.service';
@UseGuards(AuthGuard)
@Controller('master-plan-system/review-due-dates')
export class ReviewDueDateController {
  constructor(private readonly queries:ReviewDueDateQueryService,private readonly application:ReviewDueDateApplicationService,private readonly applications:MasterPlanReviewApplicationService){}
  @Get(':id/applications') applicationsInfo(@Param('id') id:string,@Req() r:Request&{user:any}){return this.applications.info(id,this.actor(r));}
  @Post(':id/applications/preview') applicationsPreview(@Param('id') id:string,@Body() b:MpsReviewApplyRequest,@Req() r:Request&{user:any}){return this.applications.preview(id,b,this.actor(r));}
  @Post(':id/applications/confirm') applicationsConfirm(@Param('id') id:string,@Body() b:MpsReviewApplyConfirm,@Req() r:Request&{user:any}){return this.applications.confirm(id,b,this.actor(r));}
  @Get(':id/applications/:event/status') applicationStatus(@Param('id') id:string,@Param('event') event:string,@Req() r:Request&{user:any}){return this.applications.status(id,event,this.actor(r));}
  @Get(':id/history') history(@Param('id') id:string,@Query() query:Record<string,unknown>,@Req() req:Request&{user:any}){
    return this.queries.history(id,query,this.actor(req));
  }
  @Post('manual-create') manualCreate(@Body() body:Record<string,unknown>,@Req() req:Request&{user:any}){
    return this.application.manualCreate(body,this.actor(req));
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
