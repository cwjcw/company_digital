import { Controller,Get,Post,Body,Req,UseGuards } from '@nestjs/common';
import { ApiBearerAuth,ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../auth';
import { FinanceActor } from './finance.types';
import { FinanceMovementsApplicationService } from './finance-movements.application.service';
import { FinanceMovementsQueryService } from './finance-movements.query.service';
@ApiTags('财务订单金额变更')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('finance/e10-movements')
export class FinanceMovementsController {
 constructor(private readonly app:FinanceMovementsApplicationService,private readonly query:FinanceMovementsQueryService){}
 @Post('refresh') refresh(@Req() r:any,@Body() b:Record<string,unknown>){return this.app.refresh(this.actor(r),b??{});}
 @Get('runs') runs(@Req() r:any){return this.query.runs(this.actor(r));}
 private actor(r:any):FinanceActor{return {tenantId:process.env.KDOS_DEFAULT_TENANT_CODE??'KAINAN',userId:r.user?.sub??null,username:r.user?.displayName??r.user?.username??'',permissions:r.user?.permissions??[],isSystemAdmin:r.user?.isSystemAdmin===true,moduleAdminCodes:r.user?.moduleAdminCodes??[],tableDataScopes:r.user?.tableDataScopes??[],requestId:r.requestId,source:r.user?.apiKeyId?'api':'web'};}
}
