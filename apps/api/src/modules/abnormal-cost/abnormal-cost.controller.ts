import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthGuard } from '../../auth';
import { AbnormalCostApplicationService } from './abnormal-cost.application.service';
import { AbnormalCostQueryService } from './abnormal-cost.query.service';
import { AbnormalCostSpreadsheetService } from './abnormal-cost.spreadsheet.service';
import { costAssert, costCan, costResource, type AbnormalActor, type CostRow } from './abnormal-cost.policy';
import { detailWorkbookTemplate } from './abnormal-cost.domain';
type CostRequest=Request&{user:any;requestId:string};
@ApiTags('流程审批·异常费用')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('abnormal-cost')
export class AbnormalCostController {
  constructor(private readonly app:AbnormalCostApplicationService,private readonly queries:AbnormalCostQueryService,private readonly spreadsheets:AbnormalCostSpreadsheetService){}
  private actor(req:CostRequest):AbnormalActor{return {tenantId:req.user?.tenantId??process.env.KDOS_DEFAULT_TENANT_CODE??'KAINAN',userId:req.user?.sub??null,displayName:req.user?.displayName,username:req.user?.username,permissions:req.user?.permissions??[],isSystemAdmin:req.user?.isSystemAdmin===true,moduleAdminCodes:req.user?.moduleAdminCodes??[],tableDataScopes:req.user?.tableDataScopes??[],requestId:req.requestId};}
  @Get('options') options(@Req() req:CostRequest){return this.queries.options(this.actor(req));}
  @Get('detail-template') async detailTemplate(@Req() req:CostRequest,@Res() res:Response){const actor=this.actor(req);costAssert(actor,'abnormal-responsibility-requests',costCan(actor,'abnormal-responsibility-requests','create')?'create':'update');return this.xlsx(res,await detailWorkbookTemplate(),'abnormal_detail_template.xlsx');}
  @Post('attachments')
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:20*1024*1024,files:1}}))
  upload(@UploadedFile() file:Express.Multer.File,@Query('purpose') purpose:string,@Req() req:CostRequest){return this.app.upload(file?{...file,originalname:typeof req.body?.originalName==='string'?req.body.originalName:file.originalname}:file,purpose,this.actor(req));}
  @Get('resources/:resource/template') async template(@Param('resource') code:string,@Query() query:CostRow,@Req() req:CostRequest,@Res() res:Response){return this.xlsx(res,await this.spreadsheets.template(costResource(code).code,String(query.mode??'CREATE'),query,this.actor(req)),'abnormal_import_template.xlsx');}
  @Post('resources/:resource/import-preview')
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:20*1024*1024,files:1}}))
  preview(@Param('resource') code:string,@UploadedFile() file:Express.Multer.File,@Req() req:CostRequest){return this.spreadsheets.preview(costResource(code).code,file?.buffer,this.actor(req));}
  @Post('resources/:resource/import-confirm') confirm(@Param('resource') code:string,@Body() body:CostRow,@Req() req:CostRequest){return this.spreadsheets.confirm(costResource(code).code,body.previewId,this.actor(req));}
  @Get('resources/:resource/:id') detail(@Param('resource') code:string,@Param('id') id:string,@Req() req:CostRequest){return this.app.detail(costResource(code).code,id,this.actor(req));}
  @Get('resources/:resource/:id/attachments/:attachmentId') async attachment(@Param('resource') code:string,@Param('id') id:string,@Param('attachmentId') attachmentId:string,@Req() req:CostRequest,@Res() res:Response){
    const file=await this.app.attachment(costResource(code).code,id,attachmentId,this.actor(req));res.setHeader('Content-Type','application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);res.send(file.content);
  }
  @Get('resources/:resource/:id/attachment-preview/:attachmentId') async attachmentPreview(@Param('resource') code:string,@Param('id') id:string,@Param('attachmentId') attachmentId:string,@Req() req:CostRequest){const file=await this.app.attachment(costResource(code).code,id,attachmentId,this.actor(req));return {rows:file.parsedRows};}
  @Post('requests') createRequest(@Body() body:CostRow,@Req() req:CostRequest){return this.app.createRequest(body,req.headers['idempotency-key'],this.actor(req));}
  @Post('requests/:id/judgments') addJudgment(@Param('id') id:string,@Body() body:CostRow,@Req() req:CostRequest){return this.app.addJudgment(id,body,req.headers['idempotency-key'],this.actor(req));}
  @Patch('requests/:id') updateRequest(@Param('id') id:string,@Body() body:CostRow,@Req() req:CostRequest){return this.app.updateRequest(id,body,this.actor(req));}
  @Patch('judgments/:id') updateJudgment(@Param('id') id:string,@Body() body:CostRow,@Req() req:CostRequest){return this.app.updateJudgment(id,body,this.actor(req));}
  @Post('resources/:resource') createBasic(@Param('resource') code:string,@Body() body:CostRow,@Req() req:CostRequest){return this.app.saveBasic(costResource(code).code,null,body,this.actor(req));}
  @Patch('resources/:resource/:id') updateBasic(@Param('resource') code:string,@Param('id') id:string,@Body() body:CostRow,@Req() req:CostRequest){return this.app.saveBasic(costResource(code).code,id,body,this.actor(req));}
  @Delete('resources/:resource/:id') remove(@Param('resource') code:string,@Param('id') id:string,@Query('expectedVersion') version:string,@Req() req:CostRequest){return this.app.remove(costResource(code).code,id,version,this.actor(req));}
  private xlsx(res:Response,buffer:Buffer,name:string){res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="${name}"`);res.send(buffer);}
}
