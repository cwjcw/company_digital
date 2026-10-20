import { Body,Controller,Get,Post,Req,UseGuards } from '@nestjs/common';
import { ApiBearerAuth,ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../auth';
import { FinanceOrdersApplicationService } from './finance-orders.application.service';
import { FinanceOrdersQueryService } from './finance-orders.query.service';
import type { FinanceActor } from './finance.types';
@ApiTags('财务销售订单统计')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('finance/e10-orders')
export class FinanceOrdersController {
 constructor(private readonly app:FinanceOrdersApplicationService,private readonly query:FinanceOrdersQueryService){}
 @Post('refresh') refresh(@Body() body:Record<string,unknown>,@Req() r:any){return this.app.refresh(this.actor(r),body??{});}
 @Get('revision') revision(@Req() r:any){return this.query.revision(this.actor(r));}
 @Get('runs') runs(@Req() r:any){return this.query.runs(this.actor(r));}
 @Get('exceptions') exceptions(@Req() r:any){return this.query.exceptions(this.actor(r));}
 @Post('ranking') ranking(@Body() body:any,@Req() r:any){return this.query.ranking(body.context??{},this.actor(r),body);}
 @Post('dashboard') dashboard(@Body() body:Record<string,unknown>,@Req() r:any){return this.query.dashboard(body,this.actor(r));}
 private actor(r:any):FinanceActor{return {tenantId:process.env.KDOS_DEFAULT_TENANT_CODE??'KAINAN',userId:r.user?.sub??null,username:r.user?.displayName??r.user?.username??'',permissions:r.user?.permissions??[],isSystemAdmin:r.user?.isSystemAdmin===true,moduleAdminCodes:r.user?.moduleAdminCodes??[],tableDataScopes:r.user?.tableDataScopes??[],requestId:r.requestId,source:r.user?.apiKeyId?'api':'web'};}
}
