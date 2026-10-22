import { BadRequestException, ForbiddenException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { reviewDueDateExportFilename, reviewDueDateFields, reviewDueDateCreateFields, reviewDueDateResource as RESOURCE } from '@kdos/contracts';
import { buildDataScopeClause } from '../../common/filtering/data-scope';
import { TableFilterRegistry, registeredOrderBy, type TableFilterActor, type TablePrintRowQuery } from '../../common/filtering/table-filter.registry';
import { SqlFilterCompiler } from '../../common/filtering/sql-filter.compiler';
import { TablePrintService } from '../../common/printing/table-print.service';
import { hasMasterPlanPermission, hasReviewDueCreateFieldPermission, type MasterPlanActor } from './master-plan.types';
import { normalizeKdosPageSize } from '../../common/pagination';

export const reviewDueColumns = Object.fromEntries(reviewDueDateFields.map(f=>[f.key,f.key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())]));
const searchFields=['orderNumber','batchNumber','drawingNumber','inspectionTimeName'];
const admin=(a:TableFilterActor)=>a.isSystemAdmin||a.permissions.includes('*')||a.moduleAdminCodes?.includes('planning');
const readable=(a:TableFilterActor,k:string)=>!!admin(a)||a.permissions.includes(`${RESOURCE}:${k}:read`);
export function reviewDueAuthorize(a:TableFilterActor,action='read') {
  if (!['read','export','update'].includes(action)||(!admin(a)&&!a.permissions.includes(`${RESOURCE}:*:${action}`))) throw new ForbiddenException('当前权限组没有评审交期表'+(action==='export'?'导出':'查看')+'权限');
}
/** Unknown organization/field rules invalidate the whole CUSTOM alternative; never drop them. */
export function reviewDueScope(a:TableFilterActor,p:unknown[],action='read') {
  if(admin(a))return '1=1';
  const operators=new Set(['EQ','NE','GT','GTE','LT','LTE','IN','NOT_IN','CONTAINS','NOT_CONTAINS','STARTS_WITH','IS_EMPTY','IS_NOT_EMPTY']);
  const scopes=(a.tableDataScopes??[]).filter(s=>s.resource===RESOURCE&&(!s.actions||s.actions.includes(action))).filter(s=>s.scope!=='CUSTOM'||(!!s.rules?.length&&s.rules.every(r=>Object.hasOwn(reviewDueColumns,String(r.fieldKey))&&operators.has(String(r.operator))&&(r.operator==='IS_EMPTY'||r.operator==='IS_NOT_EMPTY'||r.value!=null))));
  return buildDataScopeClause({resource:RESOURCE,actor:{...a,tableDataScopes:scopes,moduleAdminCodes:[]},columns:reviewDueColumns,params:p,action,numericFields:['quantity','changeCount']});
}

/** Only advertises a dedicated create command; the generic resource create flag stays false. */
export function reviewDueCreateCapabilities(actor: MasterPlanActor) {
  const fields=reviewDueDateCreateFields.filter(field=>hasReviewDueCreateFieldPermission(actor,field.key));
  const allowed=!!actor.userId && hasMasterPlanPermission(actor,RESOURCE,'create')
    && reviewDueDateCreateFields.filter(field=>field.required).every(field=>fields.some(f=>f.key===field.key))
    && reviewDueScope(actor,[],'create')!=='1=0';
  return {create:allowed,createFields:allowed?fields:[]};
}

@Injectable()
export class ReviewDueDateQueryService implements OnModuleInit {
  constructor(private readonly db:DataSource,private readonly registry:TableFilterRegistry){}
  onModuleInit(){
    this.registry.register({code:RESOURCE,table:'mps_review_due_dates',columns:{id:'id',...reviewDueColumns},
      expressions:Object.fromEntries(reviewDueDateFields.filter(f=>f.type==='date').map(f=>[f.key,`record.${reviewDueColumns[f.key]}::text`])),
      fields:reviewDueDateFields,authorize:a=>reviewDueAuthorize(a),searchColumns:searchFields,
      buildScope:(a,p,action)=>action==='export'?`(${reviewDueScope(a,p,'read')}) AND (${reviewDueScope(a,p,'export')})`:reviewDueScope(a,p),
      defaultSort:{field:'inboundDate',order:'asc',stableColumns:['order_number','batch_number','drawing_number','id']},
      exportExactNumbers:true,exportNullAsBlank:true,exportFilename:()=>reviewDueDateExportFilename(),
      listRows:q=>this.rows(q),printRows:q=>this.rows(q),runQuery:(sql,p)=>this.read(String(p[0]),m=>m.query(sql,p))});
  }
  async list(input:Record<string,unknown>,actor:TableFilterActor){
    reviewDueAuthorize(actor);
    if(input.filters&&input.filters!=='{}')throw new BadRequestException('评审交期请使用统一高级筛选条件');
    return this.rows({actor,page:Math.max(1,Math.floor(Number(input.page)||1)),pageSize:normalizeKdosPageSize(Number(input.pageSize)||100),search:String(input.search??'').trim(),filterGroup:input.filterGroup,
      sortField:input.sortField,sortOrder:input.sortOrder,context:{},fieldKeys:reviewDueDateFields.filter(f=>readable(actor,f.key)).map(f=>f.key),action:'read'});
  }
  async export(input:Record<string,unknown>,actor:TableFilterActor){
    reviewDueAuthorize(actor,'export');reviewDueAuthorize(actor);
    if(input.filters&&input.filters!=='{}')throw new BadRequestException('评审交期请使用统一高级筛选条件');
    return this.read(actor.tenantId,async manager=>{
      const scoped=new TableFilterRegistry();scoped.register({...this.registry.get(RESOURCE),printRows:q=>this.rows(q,manager)});
      return new TablePrintService(scoped,this.db).exportXlsx(RESOURCE,{search:input.search,filterGroup:input.filterGroup,sortField:input.sortField,sortOrder:input.sortOrder,columnKeys:reviewDueDateFields.map(f=>f.key)},actor);
    });
  }
  private async rows(q:TablePrintRowQuery,manager?:EntityManager){
    reviewDueAuthorize(q.actor);if(q.action==='export')reviewDueAuthorize(q.actor,'export');
    if(Object.keys(q.context??{}).length)throw new BadRequestException('评审交期表不接受组织归属上下文');
    const keys=q.fieldKeys.filter(k=>Object.hasOwn(reviewDueColumns,k)&&readable(q.actor,k));if(!keys.length)throw new ForbiddenException('没有可见评审交期字段');
    const p:unknown[]=[q.actor.tenantId],where=['record.tenant_id=$1',reviewDueScope(q.actor,p,'read')];
    if(q.action==='export')where.push(reviewDueScope(q.actor,p,'export'));
    if(q.search){const fields=searchFields.filter(k=>readable(q.actor,k));p.push('%'+q.search+'%');where.push('('+ (fields.map(k=>`record.${reviewDueColumns[k]} ILIKE $${p.length}`).join(' OR ')||'1=0')+')');}
    const expression=(column:string)=>`record.${column}`;
    if(q.filterGroup)where.push(new SqlFilterCompiler(reviewDueDateFields,reviewDueColumns,k=>readable(q.actor,k),expression).compile(q.filterGroup,p));
    if(q.ids?.length){p.push(q.ids);where.push(`record.id=ANY($${p.length}::uuid[])`);}
    const sort=String(q.sortField??'');if(sort&&!Object.hasOwn(reviewDueColumns,sort))throw new BadRequestException('排序字段无效');if(sort&&!readable(q.actor,sort))throw new ForbiddenException('不能按隐藏字段排序');
    const source=this.registry.get(RESOURCE),order=registeredOrderBy(source,sort?expression(reviewDueColumns[sort]):undefined,q.sortOrder,k=>readable(q.actor,k));
    const work=async(m:EntityManager)=>{
      const [{n}]=await m.query(`SELECT count(*)::integer n FROM mps_review_due_dates record WHERE ${where.join(' AND ')}`,p);
      const params=[...p];
      const updateScope=hasMasterPlanPermission(q.actor as import('./master-plan.types').MasterPlanActor,RESOURCE,'update')?reviewDueScope(q.actor,params,'update'):'1=0';
      params.push(q.pageSize,(q.page-1)*q.pageSize);
      const selected=keys.map(k=>`record.${reviewDueColumns[k]}${reviewDueDateFields.find(f=>f.key===k)?.type==='date'?'::text':''} "${k}"`);
      const rows=await m.query(`SELECT record.id,record.version,(${updateScope}) AS "canUpdate",${selected.join(',')} FROM mps_review_due_dates record WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $${params.length-1} OFFSET $${params.length}`,params);
      return {rows,total:Number(n),page:q.page,pageSize:q.pageSize,visibleFields:keys};
    };
    return manager?work(manager):this.read(q.actor.tenantId,work);
  }
  async history(id:string,input:Record<string,unknown>,actor:TableFilterActor){
    reviewDueAuthorize(actor);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))throw new BadRequestException('评审交期记录ID无效');
    if(['inboundDate','previousInboundDate','changeCount','lastChangedAt'].some(k=>!readable(actor,k)))throw new ForbiddenException('变更历史需要交期及变更统计字段读取权限');
    const page=Math.max(1,Math.floor(Number(input.page)||1)),pageSize=normalizeKdosPageSize(Number(input.pageSize)||100);
    return this.read(actor.tenantId,async m=>{
      const p:unknown[]=[actor.tenantId,id],scope=reviewDueScope(actor,p,'read');
      const [row]=await m.query(`SELECT record.id FROM mps_review_due_dates record WHERE record.tenant_id=$1 AND record.id=$2::uuid AND (${scope})`,p);
      if(!row)throw new NotFoundException('评审交期记录不存在或不在授权范围');
      const [{n}]=await m.query('SELECT count(*)::int n FROM mps_review_due_date_changes WHERE tenant_id=$1 AND review_due_date_id=$2::uuid',[actor.tenantId,id]);
      const rows=await m.query(`SELECT h.id,h.changed_at "changedAt",h.old_inbound_date::text "oldInboundDate",h.new_inbound_date::text "newInboundDate",
        h.change_days "changeDays",h.change_direction "changeDirection",h.source_kind "sourceKind",h.source_batch_id "sourceBatchId",
        coalesce(nullif(u.display_name,''),u.username,'系统') "changedByName"
        FROM mps_review_due_date_changes h LEFT JOIN users u ON u.tenant_id=h.tenant_id AND u.id=h.changed_by
        WHERE h.tenant_id=$1 AND h.review_due_date_id=$2::uuid ORDER BY h.changed_at DESC,h.id DESC LIMIT $3 OFFSET $4`,[actor.tenantId,id,pageSize,(page-1)*pageSize]);
      return {rows,total:Number(n),page,pageSize};
    });
  }
  private read<T>(tenant:string,work:(m:EntityManager)=>Promise<T>){return this.db.transaction('REPEATABLE READ',async m=>{await m.query('SET TRANSACTION READ ONLY');await m.query("SELECT set_config('app.tenant_id',$1,true),set_config('TimeZone','Asia/Shanghai',true)",[tenant]);return work(m);});}
}
