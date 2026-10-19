import { Injectable,OnModuleInit,ForbiddenException,BadRequestException } from '@nestjs/common';
import { financeMovementResources,financeMovementFields } from '@kdos/contracts';
import { TableFilterRegistry,TableFilterActor,TablePrintRowQuery } from '../../common/filtering/table-filter.registry';
import { SqlFilterCompiler } from '../../common/filtering/sql-filter.compiler';
import { FinanceRepository } from './finance.repository';
import { financeAdmin } from './finance.types';
import { orderAuthorize,orderColumns,orderField,orderScope } from './finance-orders.types';
import { normalizeKdosPageSize } from '../../common/pagination';
@Injectable()
export class FinanceMovementsQueryService implements OnModuleInit {
 constructor(private readonly repository:FinanceRepository,private readonly registry:TableFilterRegistry){}
 onModuleInit(){for(const r of financeMovementResources){
  const columns=orderColumns(r),fields=financeMovementFields(r);
  if(r==='finance-e10-changes'){
   this.registry.register({code:r,table:'finance_e10_changes',columns,expressions:{orderDate:'record.order_date::text'},fields,authorize:a=>{orderAuthorize(a,r);for(const k of ['customerCode','departmentCategory',...(r==='finance-e10-changes'?['effectiveAt']:[])])if(!orderField(a,r,k))throw new ForbiddenException('发生额查询需要日期和归属字段读取权限');},buildScope:(a,p,action)=>this.scope(a,r,p,action),buildContext:(c,p)=>this.context(c,p,r),runQuery:(s,p)=>this.repository.query(s,p),searchColumns:['orderNo','customerCode','itemCode','changeNo'],exportExactNumbers:true,exportNullAsBlank:true});
  }else{
   this.registry.register({code:r,table:'finance_e10_movement_source',columns,fields,authorize:a=>{orderAuthorize(a,r);for(const k of ['customerCode','departmentCategory'])if(!orderField(a,r,k))throw new ForbiddenException('发生额查询需要日期和归属字段读取权限');},buildScope:(a,p,action)=>this.scope(a,r,p,action),buildContext:(c,p)=>this.context(c,p,r),runQuery:(s,p)=>this.repository.query(s,p),searchColumns:['customerCode','departmentCategory'],listRows:q=>this.report(r,q),printRows:q=>this.report(r,q),candidateVariant:()=>({listRows:undefined}),exportExactNumbers:true,exportNullAsBlank:true});
  }
 }}
 private scope(a:TableFilterActor,r:string,p:unknown[],action='read'){
  // Export scope must intersect read scope even for custom aggregate providers.
  const scope=orderScope(a,r,p,'read');return action==='export'?`(${scope}) AND (${orderScope(a,r,p,'export')})`:scope;
 }
 private context(c:Record<string,unknown>,p:unknown[],r:string){
  if(Object.keys(c).some(k=>!['dateFrom','dateTo','departmentCategory','customerCode'].includes(k)))throw new BadRequestException('发生额查询条件无效');
  const out:string[]=[];
  for(const [key,op] of [['dateFrom','>='],['dateTo','<=']])if(c[key]){
   const v=String(c[key]);if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new BadRequestException('日期无效');
   p.push(v);const col=r==='finance-e10-changes'?"(record.effective_at AT TIME ZONE 'Asia/Shanghai')::date":'record.occurrence_date';out.push(`${col}${op}$${p.length}::date`);
  }
  for(const k of ['departmentCategory','customerCode'])if(c[k]){const col=k==='customerCode'?'customer_code':'department_category';if(c[k]==='待分类'&&k==='departmentCategory')out.push(`record.${col} IS NULL`);else{p.push(String(c[k]));out.push(`record.${col}=$${p.length}`);}}
  return out.join(' AND ')||'1=1';
 }
 async report(r:string,q:TablePrintRowQuery){
  orderAuthorize(q.actor,r);if(q.action==='export')orderAuthorize(q.actor,r,'export');
  const fields=financeMovementFields(r),columns=orderColumns(r),p:unknown[]=[q.actor.tenantId];
  for(const k of ['departmentCategory','customerCode'])if(q.context[k]&&!orderField(q.actor,r,k))throw new ForbiddenException('不能按隐藏字段筛选');
  const sourceWhere=['record.tenant_id=$1',this.scope(q.actor,r,p,q.action),this.context(q.context,p,r)];
  const dims=r==='finance-e10-movements'?['year_month']:r==='finance-e10-movement-departments'?['year_month','department_category','sales_channel']:['year_month','customer_code','department_category','sales_channel'];
  const selected=['year_month','customer_code','department_category','sales_channel'].map(c=>dims.includes(c)?c:`NULL::text ${c}`);
  const cte=`WITH grouped AS(SELECT md5(concat_ws('|',tenant_id,${dims.map(c=>`coalesce(${c},'')`).join(',')}))::uuid id,tenant_id,
   ${selected.join(',')},${['base_amount','increase_amount','decrease_amount','change_amount','order_total'].map(c=>`sum(${c}) ${c}`).join(',')}
   FROM finance_e10_movement_source record WHERE ${sourceWhere.join(' AND ')} GROUP BY tenant_id,${dims.join(',')})`;
  const where=['record.tenant_id=$1'];
  if(q.filterGroup)where.push(new SqlFilterCompiler(fields,columns,k=>orderField(q.actor,r,k),c=>`record.${c}`).compile(q.filterGroup,p));
  if(q.search){const keys=['yearMonth','customerCode','departmentCategory'].filter(k=>orderField(q.actor,r,k));if(!keys.length)where.push('1=0');else{p.push('%'+q.search+'%');where.push(`(${keys.map(k=>`record.${columns[k]} ILIKE $${p.length}`).join(' OR ')})`);}}
  if(q.ids){p.push(q.ids);where.push(`record.id=ANY($${p.length}::uuid[])`);}
  const sort=q.sortField?String(q.sortField):'yearMonth';if(!fields.some(f=>f.key===sort))throw new BadRequestException('排序字段无效');if(!orderField(q.actor,r,sort))throw new ForbiddenException('不能按隐藏字段排序');
  const page=Math.max(1,Number(q.page)||1),pageSize=normalizeKdosPageSize(q.pageSize);const clauses=where.join(' AND ');
  // Count and rows share a single SQL snapshot and exactly the same source/group filters.
  const [result]=await this.repository.query(`${cte}, selected AS MATERIALIZED(SELECT * FROM grouped record WHERE ${clauses})
   SELECT (SELECT count(*)::integer FROM selected) total,(SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM(
    SELECT id,${fields.map(f=>`${columns[f.key]}${f.type==='number'?'::text':''} AS "${f.key}"`).join(',')}
    FROM selected ORDER BY ${columns[sort]} ${q.sortOrder==='asc'?'ASC':'DESC'} NULLS LAST,id LIMIT $${p.length+1} OFFSET $${p.length+2}) x) rows`,[...p,pageSize,(page-1)*pageSize]);
  return {rows:result.rows,total:result.total,page,pageSize};
 }
 async runs(a:TableFilterActor){
  orderAuthorize(a,'finance-e10-changes');if(!financeAdmin(a))return {rows:[],canRefresh:false};
  return {canRefresh:true,rows:await this.repository.query(`SELECT id,status,mode,started_at AS "startedAt",completed_at AS "completedAt",changed_count AS "changedCount",error_summary AS "errorSummary" FROM finance_e10_movement_runs WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 20`,[a.tenantId])};
 }
}
