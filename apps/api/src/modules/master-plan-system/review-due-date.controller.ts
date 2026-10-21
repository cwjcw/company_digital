import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../auth';
import { ReviewDueDateQueryService } from './review-due-date.query.service';
@UseGuards(AuthGuard)
@Controller('master-plan-system/review-due-dates')
export class ReviewDueDateController {
  constructor(private readonly queries:ReviewDueDateQueryService){}
  @Get(':id/history') history(@Param('id') id:string,@Query() query:Record<string,unknown>,@Req() req:Request&{user:any}){
    return this.queries.history(id,query,{...req.user,tenantId:process.env.KDOS_DEFAULT_TENANT_CODE??'KAINAN',userId:req.user?.sub,permissions:req.user?.permissions??[]});
  }
}
