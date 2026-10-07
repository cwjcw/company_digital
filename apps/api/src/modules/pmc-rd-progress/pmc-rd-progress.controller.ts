import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { AuthGuard } from '../../auth';
import { PmcRdProgressApplicationService } from './pmc-rd-progress.application.service';
import { PmcRdProgressQueryService } from './pmc-rd-progress.query.service';
import type { ProgressActor } from './pmc-rd-progress.types';
type ProgressRequest = Request & {user: {sub?:string;username?:string;displayName?:string;permissions?:string[];moduleAdminCodes?:string[];isSystemAdmin?:boolean;tableDataScopes?:ProgressActor['tableDataScopes']};requestId:string};
@ApiTags('PMC研发进度')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('pmc/reports/rd-progress')
export class PmcRdProgressController {
  constructor(private readonly queries: PmcRdProgressQueryService) {}
  @Get('items') items(@Query() query: Record<string,unknown>,@Req() request: ProgressRequest) {return this.queries.list(query,this.actor(request));}
  @Get('items/:id') detail(@Param('id') id: string,@Req() request: ProgressRequest) {return this.queries.detail(id,this.actor(request));}
  @Get('summary') summary(@Query() query: Record<string,unknown>,@Req() request: ProgressRequest) {return this.queries.summary(query,this.actor(request));}
  @Get('orders') orders(@Query() query: Record<string,unknown>,@Req() request: ProgressRequest) {return this.queries.orders(query,this.actor(request));}
  @Get('sync-status') status(@Req() request: ProgressRequest) {return this.queries.status(this.actor(request));}
  private actor(request: ProgressRequest): ProgressActor {return {tenantId:process.env.KDOS_DEFAULT_TENANT_CODE ?? 'KAINAN',userId:request.user.sub ?? null,username:request.user.displayName ?? request.user.username ?? 'unknown',permissions:request.user.permissions ?? [],moduleAdminCodes:request.user.moduleAdminCodes ?? [],isSystemAdmin:request.user.isSystemAdmin === true,tableDataScopes:request.user.tableDataScopes ?? [],requestId:request.requestId,source:'web'};}
}
@Controller('internal/pmc/rd-progress')
export class PmcRdProgressInternalController {
  constructor(private readonly application: PmcRdProgressApplicationService) {}
  @Post('sync') sync(@Headers('x-kdos-internal-token') token: string|undefined,@Headers('x-kdos-tenant-id') tenant: string|undefined,@Body() body: {mode?:'FULL'|'INCREMENTAL'}) {
    const expected=process.env.KDOS_RD_INTERNAL_TOKEN;
    if (!expected || !token || Buffer.byteLength(token) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(token),Buffer.from(expected))) throw new UnauthorizedException('内部同步凭据无效');
    if (!tenant || tenant !== (process.env.KDOS_DEFAULT_TENANT_CODE ?? 'KAINAN')) throw new UnauthorizedException('租户不匹配');
    if (!body || !['FULL','INCREMENTAL'].includes(body.mode ?? '')) throw new BadRequestException('mode必须为FULL或INCREMENTAL');
    return this.application.sync(body.mode!,{tenantId:tenant,userId:'0199e000-0000-7000-8000-000000000001',username:'pmc-rd-sync',permissions:['*'],isSystemAdmin:true,moduleAdminCodes:['planning'],tableDataScopes:[],requestId:`pmc-rd-${Date.now()}`,source:'system'});
  }
}
