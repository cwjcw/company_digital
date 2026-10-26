import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '../../auth';
import type { MasterPlanActor } from './master-plan.types';
import { MasterPlanBomProcessService, type BomProcessQuery } from './master-plan.bom-process.service';

@Controller('master-plan-system/order-progress/bom-process')
@UseGuards(AuthGuard)
export class MasterPlanBomProcessController {
  constructor(private readonly service: MasterPlanBomProcessService) {}
  @Get() read(@Query()q:BomProcessQuery,@Req()req:Request) { return this.service.read(q,this.actor(req)); }
  @Get('export/:tableKey') async export(@Param('tableKey')key:string,@Query()q:BomProcessQuery,@Req()req:Request,@Res()res:Response) {
    const buffer=await this.service.export(q,key,this.actor(req));
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="mps_bom_${key}.xlsx"`);res.send(buffer);
  }
  private actor(req:Request):MasterPlanActor {
    const r=req as Request&{user:{sub?:string;username?:string;displayName?:string;permissions?:string[];isSystemAdmin?:boolean;moduleAdminCodes?:string[];tableDataScopes?:MasterPlanActor['tableDataScopes'];apiKeyId?:string};requestId:string},u=r.user;
    return {tenantId:process.env.KDOS_DEFAULT_TENANT_CODE??'KAINAN',userId:u?.sub??null,username:u?.displayName??u?.username??'unknown',permissions:u?.permissions??[],isSystemAdmin:u?.isSystemAdmin,moduleAdminCodes:u?.moduleAdminCodes,tableDataScopes:u?.tableDataScopes??[],requestId:r.requestId,source:u?.apiKeyId?'system':'web'};
  }
}
