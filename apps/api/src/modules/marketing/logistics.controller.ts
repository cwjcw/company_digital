import { LogisticsQueryService } from "./logistics.query.service";
import { Body, Controller, Get, Query, Post, Patch, Param, Req, Res, UploadedFile, UseGuards, UseInterceptors, ForbiddenException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { AuthGuard } from '../../auth';
import { LogisticsApplicationService } from './logistics.application.service';
import { LogisticsImportService } from './logistics-import.service';
import { LogisticsDirectoryQueryService } from './logistics-directory.query.service';
import { logisticsField, logisticsAction, type LogisticsActor } from './logistics.policy';
type LogisticsRequest = Request & { user: any; requestId?: string };
@Controller('marketing/logistics-ledger')
@UseGuards(AuthGuard)
export class LogisticsController {
  constructor(private readonly application: LogisticsApplicationService, private readonly imports: LogisticsImportService, private readonly directory: LogisticsDirectoryQueryService, private readonly queries: LogisticsQueryService) {}
  actor(req: LogisticsRequest): LogisticsActor {
    return { tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? 'KAINAN', userId: req.user?.sub ?? null,
      permissions: req.user?.permissions ?? [], isSystemAdmin: req.user?.isSystemAdmin === true, moduleAdminCodes: req.user?.moduleAdminCodes ?? [],
      tableDataScopes: req.user?.tableDataScopes ?? [], requestId: req.requestId, ip: req.ip };
  }
  @Get('summary') summary(@Query() query: { search?: string; filterGroup?: string }, @Req() req: LogisticsRequest) { return this.queries.summary(query, this.actor(req)); }
  @Get('references') async references(@Req() req: LogisticsRequest) {
    const a = this.actor(req);
    if (!['read', 'create', 'update', 'import'].some(action => logisticsAction(a, action))) throw new ForbiddenException('没有物流台账权限');
    const customers = logisticsField(a, 'customerCode') || logisticsField(a, 'customerCode', 'update') ? await this.directory.customers(a.tenantId) : [];
    const members = logisticsField(a, 'ownerUserId') || logisticsField(a, 'ownerUserId', 'update') ? await this.directory.members(a.tenantId, true) : [];
    return { customers, members };
  }
  @Get('import-template') async template(@Req() req: LogisticsRequest, @Res() res: Response) {
    const buffer = await this.imports.template(this.actor(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="marketing_logistics_template.xlsx"'); res.send(buffer);
  }
  @Post('import-preview') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  preview(@UploadedFile() file: Express.Multer.File, @Req() req: LogisticsRequest) { return this.imports.preview(file, this.actor(req)); }
  @Post('import-confirm') confirm(@Body() body: { token: unknown }, @Req() req: LogisticsRequest) { return this.imports.confirm(body.token, this.actor(req)); }
  @Post() create(@Body() body: { values: unknown; commandKey: unknown }, @Req() req: LogisticsRequest) { return this.application.create(body.values, body.commandKey, this.actor(req)); }
  @Post('delete') delete(@Body() body: { rows: Array<{ id: string; expectedVersion: number }> }, @Req() req: LogisticsRequest) { return this.application.delete(body.rows, this.actor(req)); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: { values: unknown; expectedVersion: unknown }, @Req() req: LogisticsRequest) { return this.application.update(id, body.values, body.expectedVersion, this.actor(req)); }
  @Post(':id/details') addDetail(@Param('id') id: string, @Body() body: { values: unknown; expectedVersion: unknown }, @Req() req: LogisticsRequest) { return this.application.update(id, body.values, body.expectedVersion, this.actor(req), true); }
}
