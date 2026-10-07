import { ForbiddenException, Injectable, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { tablePermissionFieldsFor } from '@kdos/contracts';
import { TableFilterRegistry, type TablePrintRowQuery } from '../../common/filtering/table-filter.registry';
import { progressColumns, filterExpression, sourceTimeColumns } from './pmc-rd-progress.columns';
import { progressScope } from './pmc-rd-progress.scope';
import { PmcRdProgressQueryService } from './pmc-rd-progress.query.service';
import { canRead, resourceCode, sourceInstant } from './pmc-rd-progress.types';
@Injectable()
export class PmcRdProgressFilterSources implements OnModuleInit {
  constructor(private readonly registry: TableFilterRegistry, private readonly dataSource: DataSource, private readonly queries: PmcRdProgressQueryService = new PmcRdProgressQueryService(dataSource)) {}
  private async printRows(query: TablePrintRowQuery) {
    const actor = {...query.actor,username:query.actor.username ?? '',tableDataScopes:query.actor.tableDataScopes ?? [],requestId:'table-export',source:'web' as const};
    const result = await this.queries.list({...query.context,search:query.search,filterGroup:query.filterGroup,sortField:query.sortField,sortOrder:query.sortOrder,page:query.page,pageSize:query.pageSize},actor,query.action,query.ids);
    // The platform formatter expects instants. Attach the source timezone without shifting E10 wall clock.
    const rows = result.rows.map((row: Record<string, unknown>) => {
      const output = {...row};
      for (const [key,column] of Object.entries(progressColumns)) if (sourceTimeColumns.has(column) && output[key] != null) output[key] = sourceInstant(output[key]);
      if (canRead(actor,'customerName') && canRead(actor,'customerCode') && !output.customerName) output.customerName = output.customerCode;
      return output;
    });
    return {...result,rows};
  }
  onModuleInit() {
    this.registry.register({
      code:resourceCode,table:'pmc_rd_progress_items',
      columns:{id:'id',version:'version',...Object.fromEntries(Object.entries(progressColumns).filter(([,column])=>!sourceTimeColumns.has(column)))},
      runQuery:(sql,params)=>this.dataSource.transaction(async manager=>{await manager.query("SELECT set_config('app.tenant_id',$1,true)",[params[0]]);return manager.query(sql,params);}),
      expressions:Object.fromEntries(Object.entries(progressColumns).filter(([,column])=>sourceTimeColumns.has(column)).map(([key,column])=>[key,filterExpression(column)])),
      fields:tablePermissionFieldsFor(resourceCode),printRows:query=>this.printRows(query),searchColumns:['orderNo','itemCode','itemName','customerCode','customerName'],
      authorize:actor => { if (!(actor.isSystemAdmin || actor.permissions.includes('*') || actor.moduleAdminCodes?.includes('planning') || actor.permissions.includes(`${resourceCode}:*:read`))) throw new ForbiddenException('当前权限组没有研发进度报表查看权限'); },
      buildScope:(actor,params,action='read') => `record.is_active AND (${progressScope(actor,params,action)})`
    });
  }
}
