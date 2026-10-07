import { ForbiddenException, Injectable, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { tablePermissionFieldsFor } from '@kdos/contracts';
import { TableFilterRegistry } from '../../common/filtering/table-filter.registry';
import { progressColumns, filterExpression, sourceTimeColumns } from './pmc-rd-progress.columns';
import { progressScope } from './pmc-rd-progress.scope';
import { resourceCode } from './pmc-rd-progress.types';
@Injectable()
export class PmcRdProgressFilterSources implements OnModuleInit {
  constructor(private readonly registry: TableFilterRegistry, private readonly dataSource: DataSource) {}
  onModuleInit() {
    this.registry.register({code:resourceCode,table:'pmc_rd_progress_items',columns:{id:'id',version:'version',...Object.fromEntries(Object.entries(progressColumns).filter(([,column])=>!sourceTimeColumns.has(column)))},runQuery:(sql,params)=>this.dataSource.transaction(async manager=>{await manager.query("SELECT set_config('app.tenant_id',$1,true)",[params[0]]);return manager.query(sql,params);}),expressions:Object.fromEntries(Object.entries(progressColumns).filter(([,column])=>sourceTimeColumns.has(column)).map(([key,column])=>[key,filterExpression(column)])),fields:tablePermissionFieldsFor(resourceCode),searchColumns:['orderNo','itemCode','itemName','customerCode','customerName'],authorize:actor => { if (!(actor.isSystemAdmin || actor.permissions.includes('*') || actor.moduleAdminCodes?.includes('planning') || actor.permissions.includes(`${resourceCode}:*:read`))) throw new ForbiddenException('当前权限组没有研发进度报表查看权限'); },buildScope:(actor,params,action='read') => `record.is_active AND (${progressScope(actor,params,action)})`});
  }
}
