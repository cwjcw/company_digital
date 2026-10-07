import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { tablePermissionFieldsFor } from '@kdos/contracts';
import { DataSource, type EntityManager } from 'typeorm';
import { normalizeKdosPageSize } from '../../common/pagination';
import { SqlFilterCompiler } from '../../common/filtering/sql-filter.compiler';
import { progressColumns, filterExpression, selectExpression } from './pmc-rd-progress.columns';
import { progressScope } from './pmc-rd-progress.scope';
import { summarize } from './pmc-rd-progress.calculator';
import { canRead, isAdmin, resourceCode, type ProgressActor, type ProgressItem } from './pmc-rd-progress.types';

@Injectable()
export class PmcRdProgressQueryService {
  constructor(private readonly dataSource: DataSource) {}
  private async read<T>(actor: ProgressActor, work: (manager: EntityManager)=>Promise<T>): Promise<T> {
    if (!canRead(actor)) throw new ForbiddenException('当前权限组没有研发进度报表查看权限');
    return this.dataSource.transaction('REPEATABLE READ',async manager => { await manager.query(`SELECT set_config('app.tenant_id',$1,true)`,[actor.tenantId]); return work(manager); });
  }
  private requireField(actor: ProgressActor, field: string) { if (!canRead(actor,field)) throw new ForbiddenException('当前权限组不能读取或筛选该字段'); }
  private filters(input: Record<string,unknown>, actor: ProgressActor, action = "read") {
    const params: unknown[]=[actor.tenantId], clauses=['record.tenant_id=$1','record.is_active',`(${progressScope(actor,params)})`];
    if (action === "export") {
      if (!isAdmin(actor) && !actor.permissions.includes(`${resourceCode}:*:export`) && !actor.permissions.includes(`${resourceCode}:*:*`)) throw new ForbiddenException("没有该表导出权限");
      clauses.push(`(${progressScope(actor,params,"export")})`);
    }
    const fields=tablePermissionFieldsFor(resourceCode);
    const compiler=new SqlFilterCompiler(fields,progressColumns,key => canRead(actor,key),filterExpression,(field,raw) => { const options=fields.find(f => f.key === field)?.options; return options ? options.filter(o => String(o.value).toLowerCase().includes(raw.toLowerCase()) || o.label.includes(raw)).map(o => String(o.value)) : null; });
    const rules: Array<Record<string,unknown>>=[];
    for (const [parameter,field] of [['orderNo','orderNo'],['itemCode','itemCode'],['itemName','itemName'],['customer','customerName']] as const) {
      const value=String(input[parameter] ?? '').trim(); if (value) { this.requireField(actor,field); rules.push({field,operator:'contains',value}); }
    }
    for (const [parameter,field] of [['division','divisionId'],['rdStatus','rdStatus'],['designBomStatus','designBomStatus'],['routingStatus','routingStatus'],['orderStatus','orderStatusRaw'],['orderClose','orderCloseRaw']] as const) { if (input[parameter] != null && input[parameter] !== '') { this.requireField(actor,field); rules.push({field,operator:'eq',value:input[parameter]}); } }
    for (const [parameter,operator] of [['orderDateFrom','gte'],['orderDateTo','lte']] as const) { if (input[parameter]) { this.requireField(actor,'orderDate'); rules.push({field:'orderDate',operator,value:input[parameter]}); } }
    if (input.onlyIncomplete != null && !['true','false',true,false].includes(input.onlyIncomplete as string | boolean)) throw new BadRequestException('onlyIncomplete必须为true或false');
    if (input.onlyIncomplete === true || input.onlyIncomplete === 'true') { this.requireField(actor,'rdStatus'); clauses.push(`record.rd_status NOT IN ('COMPLETE','NOT_APPLICABLE')`); }
    if (rules.length) clauses.push(compiler.compile({logic:'AND',rules},params));
    if (input.filterGroup) clauses.push(compiler.compile(input.filterGroup,params));
    const search=String(input.search ?? '').trim();
    if (search) { const visible=['orderNo','customerCode','customerName','itemCode','itemName','itemSpec'].filter(field => canRead(actor,field)); if (!visible.length) clauses.push('false'); else { params.push(`%${search}%`); clauses.push(`(${visible.map(field => `record.${progressColumns[field]} ILIKE $${params.length}`).join(' OR ')})`); } }
    return {params,where:clauses.join(' AND ')};
  }
  list(input: Record<string,unknown>,actor: ProgressActor, action = "read", ids?: string[]) {
    return this.read(actor,async manager => {
      const filtered=this.filters(input,actor,action);
      if (ids) {
        if (ids.some(id => !/^[0-9a-f-]{36}$/i.test(id))) throw new BadRequestException("无效记录ID");
        filtered.params.push(ids); filtered.where += ` AND record.id=ANY($${filtered.params.length}::uuid[])`;
      }
      const {params,where}=filtered, page=Math.max(1,Math.floor(Number(input.page)||1)),pageSize=normalizeKdosPageSize(input.pageSize);
      const [{total}]=await manager.query(`SELECT count(*)::int total FROM pmc_rd_progress_items record WHERE ${where}`,params);
      const fields=Object.entries(progressColumns).filter(([key]) => canRead(actor,key));
      const select=['record.id','record.version',...fields.map(([key,column]) => `${selectExpression(column)} AS "${key}"`)];
      let sort='record.order_no,record.line_number,record.id';
      if (input.sortField) { const key=String(input.sortField); if (!progressColumns[key]) throw new BadRequestException('未知排序字段'); this.requireField(actor,key); if (input.sortOrder && !['asc','desc','ascend','descend'].includes(String(input.sortOrder))) throw new BadRequestException('无效排序方向'); sort=`record.${progressColumns[key]} ${['desc','descend'].includes(String(input.sortOrder)) ? 'DESC' : 'ASC'} NULLS LAST,record.id`; }
      params.push(pageSize,(page-1)*pageSize);
      const rows=await manager.query(`SELECT ${select.join(',')} FROM pmc_rd_progress_items record WHERE ${where} ORDER BY ${sort} LIMIT $${params.length-1} OFFSET $${params.length}`,params);
      return {rows,total,page,pageSize};
    });
  }
  detail(id: string,actor: ProgressActor) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('无效记录ID');
    return this.read(actor,async manager => { const {params,where}=this.filters({},actor); params.push(id); const select=['record.id','record.version',...Object.entries(progressColumns).filter(([key])=>canRead(actor,key)).map(([key,column])=>`${selectExpression(column)} AS "${key}"`)]; const [row]=await manager.query(`SELECT ${select.join(',')} FROM pmc_rd_progress_items record WHERE ${where} AND record.id=$${params.length}::uuid`,params); if (!row) throw new NotFoundException('研发进度记录不存在'); return row; });
  }
  private async totals(manager: EntityManager,where: string,params: unknown[]) {
    const groups: Array<{rdStatus: string;designBomStatus: string;routingStatus: string;routingControl: string|null;count: number}> = await manager.query(`SELECT rd_status AS "rdStatus",design_bom_status AS "designBomStatus",routing_status AS "routingStatus",routing_control AS "routingControl",count(*)::int count FROM pmc_rd_progress_items record WHERE ${where} GROUP BY rd_status,design_bom_status,routing_status,routing_control`,params);
    return summarize(groups.flatMap(group => Array.from({length:group.count},()=>group)));
  }
  summary(input: Record<string,unknown>,actor: ProgressActor) {
    return this.read(actor,async manager => {
      const {params,where}=this.filters(input,actor); const totals=await this.totals(manager,where,params);
      const [{orderCount}]=await manager.query(`SELECT count(DISTINCT source_order_id)::int AS "orderCount" FROM pmc_rd_progress_items record WHERE ${where}`,params);
      const safe: Record<string,unknown>={orderCount,itemCount:totals.itemCount};
      if (canRead(actor,'rdStatus')) for (const key of ['applicableItemCount','notApplicableItemCount','completeItemCount','incompleteItemCount','abnormalItemCount','overallCompletionRate','statusCounts'] as const) safe[key]=totals[key];
      if (canRead(actor,'rdStatus') && canRead(actor,'designBomStatus')) for (const key of ['designBomCompleteCount','designApplicableCount','designBomCompletionRate'] as const) safe[key]=totals[key];
      if (canRead(actor,'rdStatus') && canRead(actor,'routingStatus') && canRead(actor,'routingControl')) for (const key of ['routingCompleteCount','routingApplicableCount','routingCompletionRate'] as const) safe[key]=totals[key];
      return safe;
    });
  }
  orders(input: Record<string,unknown>,actor: ProgressActor) {
    return this.read(actor,async manager => {
      this.requireField(actor,'sourceOrderId'); this.requireField(actor,'orderNo'); this.requireField(actor,'rdStatus');
      const {params,where}=this.filters(input,actor),page=Math.max(1,Math.floor(Number(input.page)||1)),pageSize=normalizeKdosPageSize(input.pageSize);
      const [{total}]=await manager.query(`SELECT count(DISTINCT source_order_id)::int total FROM pmc_rd_progress_items record WHERE ${where}`,params);
      params.push(pageSize,(page-1)*pageSize);
      const groups: Array<{sourceOrderId:string;orderNo:string;customerName:string|null;customerCode:string|null;items:Array<Pick<ProgressItem,'rdStatus'>>}> = await manager.query(`SELECT source_order_id AS "sourceOrderId",max(order_no) AS "orderNo",max(customer_name) AS "customerName",max(customer_code) AS "customerCode",jsonb_agg(jsonb_build_object('rdStatus',rd_status)) items FROM pmc_rd_progress_items record WHERE ${where} GROUP BY source_order_id ORDER BY max(order_no),source_order_id LIMIT $${params.length-1} OFFSET $${params.length}`,params);
      const rows=groups.map(group => {const totals=summarize(group.items);return {sourceOrderId:group.sourceOrderId,orderNo:group.orderNo,...(canRead(actor,'customerName') ? {customer:group.customerName,customerName:group.customerName} : {}),...(canRead(actor,'customerCode') ? {customerCode:group.customerCode} : {}),totalItemCount:totals.itemCount,applicableItemCount:totals.applicableItemCount,completeItemCount:totals.completeItemCount,incompleteItemCount:totals.incompleteItemCount,abnormalItemCount:totals.abnormalItemCount,completionRate:totals.completionRate,orderRdStatus:totals.orderRdStatus};});
      return {rows,total,page,pageSize};
    });
  }
  status(actor: ProgressActor) {
    return this.read(actor,async manager => {
      const [run]=await manager.query(`SELECT id,mode,status,started_at AS "startedAt",to_char(source_snapshot_at,'YYYY-MM-DD HH24:MI:SS.US') AS "sourceSnapshotAt",completed_at AS "completedAt",rows_read AS "rowsRead",rows_created AS "rowsCreated",rows_updated AS "rowsUpdated",rows_unchanged AS "rowsUnchanged",rows_failed AS "rowsFailed",rows_deactivated AS "rowsDeactivated",source_consistency AS "sourceConsistency" FROM pmc_rd_progress_sync_runs WHERE tenant_id=$1 ORDER BY started_at DESC,id DESC LIMIT 1`,[actor.tenantId]);
      // Counts describe whole tenant; exposing them to a restricted data scope leaks rows.
      const {params}=this.filters({},actor); const scope=progressScope(actor,[]);
      return scope === '1=1' ? {latestSync:run ?? null} : {latestSync:run ? {id:run.id,mode:run.mode,status:run.status,startedAt:run.startedAt,sourceSnapshotAt:run.sourceSnapshotAt,completedAt:run.completedAt} : null,tenantId:params[0]};
    });
  }
}
