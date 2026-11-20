import {Controller,Get,Param,Query,Req,Res,UseGuards} from '@nestjs/common';
import type {Request,Response} from 'express';
import {AuthGuard} from '../../auth';
import {PlmProgressQueryService} from './plm-progress.query.service';
import {PlmProgressExportService} from './plm-progress.export.service';
import type {RdActor} from './rd.types';
@Controller('rd/project-progress')
@UseGuards(AuthGuard)
export class PlmProgressController {
 constructor(private readonly queries:PlmProgressQueryService,private readonly exports:PlmProgressExportService){}
 @Get() read(@Req() r:Request,@Res({passthrough:true}) response:Response){response.setHeader('Cache-Control','no-store');return this.queries.read(this.actor(r));}
 @Get('export/:tableKey') async export(@Param('tableKey') key:string,@Query('fields') fields:string,@Req() r:Request,@Res() response:Response){const buffer=await this.exports.export(key,fields,this.actor(r));response.setHeader('Cache-Control','no-store');response.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');response.setHeader('Content-Disposition','attachment; filename="plm-project-progress.xlsx"');response.send(buffer);}
 private actor(req:Request):RdActor {const r=req as Request&{user:any;requestId:string};return {tenantId:process.env.KDOS_DEFAULT_TENANT_CODE??'KAINAN',userId:r.user?.sub??null,username:r.user?.displayName??r.user?.username??'unknown',permissions:r.user?.permissions??[],moduleAdminCodes:r.user?.moduleAdminCodes??[],isSystemAdmin:r.user?.isSystemAdmin===true,tableDataScopes:r.user?.tableDataScopes??[],requestId:r.requestId,source:r.user?.apiKeyId?'api':'web'};}
}
