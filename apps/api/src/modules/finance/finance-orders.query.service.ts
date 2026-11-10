import { Injectable, OnModuleInit, ForbiddenException } from '@nestjs/common';
import DecimalBase from 'decimal.js';
import { createHash } from 'node:crypto';
const Decimal=DecimalBase.clone({precision:40});
import { financeOrderResources, financeOrderFields, financeMonthlyFields, financeMonthlyFilterFields, financeRankingFields, financeDashboardRequiredFields } from '@kdos/contracts';
import { TableFilterRegistry, TableFilterActor, TablePrintRowQuery, TableFilterCandidateQuery } from '../../common/filtering/table-filter.registry';
import { SqlFilterCompiler } from '../../common/filtering/sql-filter.compiler';
import { FinanceRepository } from './finance.repository';
import { financeAdmin } from './finance.types';
import { orderColumns,orderAuthorize,orderField,orderScope,orderContext,orderMonthlyContext } from './finance-orders.types';
export function financeDashboardMonthSeries(context:Record<string,unknown>,observedMonths:string[]):string[]{
 const legacyFrom=context.month?`${context.year}-${String(context.month).padStart(2,'0')}`:context.dateFrom?String(context.dateFrom).slice(0,7):context.year?`${context.year}-01`:undefined;
 const legacyTo=context.month?legacyFrom:context.dateTo?String(context.dateTo).slice(0,7):context.year?`${context.year}-12`:undefined;
 const monthFrom=String(context.monthFrom??legacyFrom??observedMonths[0]??'');const monthTo=String(context.monthTo??legacyTo??observedMonths.at(-1)??'');
 const hasCalendarFilter=context.monthFrom!==undefined||context.monthTo!==undefined||context.year!==undefined||context.dateFrom!==undefined||context.dateTo!==undefined;
 if(!hasCalendarFilter||!monthFrom||!monthTo)return observedMonths;
 const toIndex=(value:string)=>{const [year,month]=value.split('-').map(Number);return year*12+month-1;};
 const months:string[]=[];for(let index=toIndex(monthFrom);index<=toIndex(monthTo);index++)months.push(`${Math.floor(index/12)}-${String(index%12+1).padStart(2,'0')}`);
 return months;
}
@Injectable()
export class FinanceOrdersQueryService implements OnModuleInit {
 constructor(private readonly repository:FinanceRepository,private readonly registry:TableFilterRegistry){}
 onModuleInit(){for(const r of financeOrderResources){
  const fields=r==='finance-e10-lines'?financeOrderFields:r==='finance-e10-ranking'?financeRankingFields:financeMonthlyFilterFields;
  const columns:Record<string,string>=orderColumns(r);
  // SQL DATE is a business day: emit its exact date text, never a driver Date/UTC timestamp.
  const expressions=Object.fromEntries(fields.filter(f=>f.type==='date').map(f=>[f.key,`record.${columns[f.key]}::text`]));
  for(const key of Object.keys(expressions))delete columns[key];
  this.registry.register({code:r,exportNullAsBlank:true,exportExactNumbers:true,table:r==='finance-e10-lines'?'finance_e10_raw':r==='finance-e10-ranking'?'finance_e10_ranking':'finance_e10_order_monthly_movements',columns,expressions,fields,
   authorize:a=>orderAuthorize(a,r),buildScope:(a,p,action)=>r==='finance-e10-ranking'?'1=0':orderScope(a,r,p,action),
   buildContext:(c,p,a)=>{if(r==='finance-e10-monthly')return orderMonthlyContext(c,p,a);if(Object.keys(c).length)throw new ForbiddenException('列表请使用统一字段筛选');return r==='finance-e10-lines'?'NOT record.source_missing':'1=1';},
   ...(r==='finance-e10-lines'?{exportMaxRows:200000}:{}),
   ...(['finance-e10-lines','finance-e10-monthly'].includes(r)?{defaultSort:{field:'orderDate',order:'asc' as const,stableColumns:['source_database','source_order_id',...(r==='finance-e10-lines'?['source_line_id']:['year_month']),'id']}}:{}),
   ...(r==='finance-e10-monthly'?{listRows:(q:TablePrintRowQuery)=>this.monthlyRows(q)}:{}),
   ...(r==='finance-e10-ranking'?{printRows:(q:TablePrintRowQuery)=>this.ranking(q.context,q.actor,q),listRows:(q:TablePrintRowQuery)=>this.ranking(q.context,q.actor,q),candidateValues:(q:TableFilterCandidateQuery)=>this.rankingCandidates(q)}:{}),
   runQuery:(sql,p)=>r==='finance-e10-monthly'?this.repository.transaction(String(p[0]),async m=>{
    // Annual filters plus stable date ordering can select the same underestimated
    // derived-order join as the dashboard. Cover rows, candidates and Excel via
    // the registered executor; settings remain local to the tenant transaction.
    await m.query('SET LOCAL enable_mergejoin = off');
    await m.query('SET LOCAL enable_nestloop = off');
    await m.query('SET LOCAL jit = off');
    return m.query(sql,p);
   }):this.repository.query(sql,p),searchColumns:r==='finance-e10-ranking'?['customerCode']:['customerCode','orderNo']});
 }}
 private async monthlyRows(q:TablePrintRowQuery){
  const resource='finance-e10-monthly',a=q.actor,source=this.registry.get(resource);
  orderAuthorize(a,resource);
  const readable=(key:string)=>orderField(a,resource,key);
  const params:unknown[]=[a.tenantId];
  const where=[`record.tenant_id=$1`,orderScope(a,resource,params,'read'),orderMonthlyContext(q.context,params,a)];
  if(q.search){
   const searchable=['customerCode','orderNo'].filter(readable).map(key=>`COALESCE(record.${orderColumns(resource)[key]}::text,'') ILIKE $${params.length+1}`);
   if(searchable.length){params.push(`%${q.search}%`);where.push(`(${searchable.join(' OR ')})`);}else where.push('1=0');
  }
  if(q.filterGroup){
   const columns=orderColumns(resource),expressions=Object.fromEntries(financeMonthlyFilterFields.filter(f=>f.type==='date').map(f=>[f.key,`record.${columns[f.key]}::text`]));
   for(const key of Object.keys(expressions))delete columns[key];
   const bindings={...Object.fromEntries(Object.entries(columns).map(([key,column])=>[key,`record.${column}`])),...expressions};
   where.push(new SqlFilterCompiler(financeMonthlyFilterFields,bindings,readable,column=>column).compile(q.filterGroup,params));
  }
  if(q.sortField&&(!source.fields.some(f=>f.key===q.sortField)||!readable(String(q.sortField))))throw new ForbiddenException('当前权限组不能按该字段排序');
  const defaultSort=source.defaultSort,sortField=String(q.sortField??(defaultSort&&readable(defaultSort.field)?defaultSort.field:'id'));
  const sortOrder=q.sortField?(String(q.sortOrder).toLowerCase()==='desc'?'DESC':'ASC'):(defaultSort?.order==='desc'?'DESC':'ASC');
  const stableColumns=defaultSort?.stableColumns??[];
  const sortDefinition=financeMonthlyFilterFields.find(f=>f.key===sortField);
  const numericSort=Boolean(q.sortField&&sortDefinition?.type==='number');
  const orderBy=[`${numericSort?'"__sort_value"':`"${sortField}"`} ${sortOrder} NULLS LAST`,...stableColumns.map(column=>`"__stable_${column}" ASC`)].join(',');
  const fields=q.fieldKeys.filter(readable).filter(key=>Boolean(source.columns[key]||source.expressions?.[key]));
  const selected=[`record.${source.columns.id} AS id`,...(numericSort?[`${source.expressions?.[sortField]??`record.${source.columns[sortField]}`} AS "__sort_value"`]:[]),...stableColumns.map(column=>`record.${column} AS "__stable_${column}"`),...fields.map(key=>{
   const expression=source.expressions?.[key]??`record.${source.columns[key]}`;
   return `${expression}${financeMonthlyFilterFields.find(f=>f.key===key)?.type==='number'?'::text':''} AS "${key}"`;
  })];
  const page=Math.max(1,Number(q.page)||1),pageSize=Math.min(1000,Math.max(1,Number(q.pageSize)||10));
  params.push(pageSize,(page-1)*pageSize);
  const [result]=await source.runQuery!(`WITH selected AS MATERIALIZED (
    SELECT ${selected.join(',')} FROM ${source.table} record WHERE ${where.join(' AND ')}
   )
   SELECT (SELECT count(*)::integer FROM selected) total,
    (SELECT coalesce(jsonb_agg(row_to_json(p)),'[]'::jsonb) FROM (SELECT "id"${fields.map(key=>`,"${key}"`).join('')} FROM selected ORDER BY ${orderBy} LIMIT $${params.length-1} OFFSET $${params.length}) p) rows`,params);
  return {rows:result.rows,total:Number(result.total)};
 }
 async ranking(context:Record<string,unknown>,a:TableFilterActor,q?:Partial<TablePrintRowQuery>){
  const resource='finance-e10-ranking';orderAuthorize(a,resource);
  if(!['customerCode','orderTotal'].every(f=>orderField(a,resource,f)))throw new ForbiddenException('客户排名需要客户和金额读取权限');
  orderAuthorize(a,'finance-e10-dashboard');
  if(financeDashboardRequiredFields.some(f=>!orderField(a,'finance-e10-dashboard',f.key)))throw new ForbiddenException('客户排名筛选需要大屏字段权限');
  const limit=Number(context.rankLimit??20);if(limit!==20)throw new ForbiddenException('客户排名固定展示前20名');
  const businessContext={...context};delete businessContext.rankLimit;
  if(context.salesperson&&!orderField(a,'finance-e10-dashboard','salesperson'))throw new ForbiddenException('不能按隐藏业务员字段筛选');
  const p:unknown[]=[a.tenantId];const clauses=['record.tenant_id=$1',orderScope(a,'finance-e10-dashboard',p,'read'),orderContext(businessContext,p,'finance-e10-dashboard',a)];
  if(q?.search){p.push('%'+q.search+'%');clauses.push(`record.customer_code ILIKE $${p.length}`);}
  const cte=`WITH grouped AS MATERIALIZED(SELECT md5(tenant_id||customer_code)::uuid id,tenant_id,min(created_by::text)::uuid created_by,customer_code,sum(order_total) order_total FROM finance_e10_order_monthly_movements record WHERE ${clauses.join(' AND ')} GROUP BY tenant_id,customer_code)`;
  let scope=orderScope(a,resource,p,'read');
  if(q?.action==='export'){orderAuthorize(a,resource,'export');scope+=` AND (${orderScope(a,resource,p,'export')})`;}
  if(q?.filterGroup)scope+=' AND '+new SqlFilterCompiler(financeRankingFields,orderColumns(resource),()=>true,c=>`record.${c}`).compile(q.filterGroup,p);
  if(q?.sortField&&!['customerCode','orderTotal'].includes(String(q.sortField)))throw new ForbiddenException('客户排名排序字段无效');
  if(q?.ids){p.push(q.ids);scope+=` AND record.id=ANY($${p.length}::uuid[])`;}
  const page=Math.max(1,Number(q?.page)||1),pageSize=Math.min(1000,Math.max(1,Number(q?.pageSize)||10));
  const sort='order_total';
  const order='DESC';
  const size=limit?Math.max(0,Math.min(pageSize,limit-(page-1)*pageSize)):pageSize;
  // Count and page reuse one authorized aggregate and one MVCC snapshot.
  const [{total,rows}]=await this.repository.transaction(a.tenantId,async m=>{
   await m.query('SET LOCAL enable_mergejoin = off');await m.query('SET LOCAL enable_nestloop = off');await m.query('SET LOCAL jit = off');
   return m.query(`${cte}, selected AS MATERIALIZED(SELECT * FROM grouped record WHERE ${scope})
   SELECT (SELECT count(*)::integer FROM selected) total,
    (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM(SELECT id,customer_code AS "customerCode",order_total::text AS "orderTotal"
     FROM selected ORDER BY ${sort} ${order},customer_code LIMIT $${p.length+1} OFFSET $${p.length+2}) x) rows`,[...p,size,(page-1)*pageSize]);});
  return {rows,total:limit?Math.min(total,limit):total,page,pageSize};
 }
 private async rankingCandidates(query:TableFilterCandidateQuery){
  if(query.fieldKey!=='customerCode')return {options:[],hasMore:false};
  const result=await this.ranking(query.context,query.actor,{page:1,pageSize:1000,search:query.tableSearch||query.search,filterGroup:query.filterGroup}) as {rows:Array<Record<string,unknown>>;total:number};
  const term=query.search.trim().toLocaleLowerCase();
  const matching=result.rows.filter(row=>!term||String(row.customerCode??'').toLocaleLowerCase().includes(term));
  return {options:matching.slice(0,query.limit).map(row=>({value:String(row.customerCode),label:String(row.customerCode)})),hasMore:matching.length>query.limit};
 }
 async revision(a:TableFilterActor){
  return this.scopedRevision(a,'finance-e10-dashboard');
 }
 async monthlyRevision(a:TableFilterActor){
  return this.scopedRevision(a,'finance-e10-monthly');
 }
 private async scopedRevision(a:TableFilterActor,resource:string){
  orderAuthorize(a,resource);
  // Small tenant-local freshness token; no amounts, identities or source rows leave this endpoint.
  const [result]=await this.repository.query(`SELECT md5(coalesce((SELECT id::text FROM finance_e10_runs
   WHERE tenant_id=$1 AND status='SUCCESS' ORDER BY completed_at DESC,id DESC LIMIT 1),'')||':'||
   coalesce((SELECT id::text FROM finance_e10_movement_runs WHERE tenant_id=$1 AND status='SUCCESS' ORDER BY completed_at DESC,id DESC LIMIT 1),'')||':'||
   coalesce((SELECT string_agg(id::text||':'||version::text||':'||updated_at::text,',' ORDER BY id)
    FROM finance_customer_mappings WHERE tenant_id=$1),'')) revision`,[a.tenantId]);
  // Include live authorization resolved by AuthGuard, so same-account scope/field
  // changes invalidate cached amounts as well as source/classification changes.
  const resources=resource==='finance-e10-dashboard'?['finance-e10-dashboard','finance-e10-ranking']:[resource];
  const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const accessRevision=createHash('sha256').update(JSON.stringify({tenant:a.tenantId,user:a.userId??null,admin:financeAdmin(a),
   permissions:a.permissions.filter(p=>p==='*'||resources.some(r=>p.startsWith(r+':'))).sort(),
   scopes:(a.tableDataScopes??[]).filter(s=>resources.includes(s.resource)).map(s=>JSON.stringify(canonical(s))).sort()})).digest('hex');
  return {revision:createHash('sha256').update(result.revision+':finance-order-month-occurrence-v3:'+accessRevision).digest('hex'),accessRevision};
 }
 async runs(a:TableFilterActor){orderAuthorize(a,'finance-e10-lines');
  const inspect=financeAdmin(a);
  if(!inspect&&(financeOrderFields.some(f=>!orderField(a,'finance-e10-lines',f.key))||orderScope(a,'finance-e10-lines',[])!=='1=1'))return {rows:[],canInspectExceptions:false};
  return {canInspectExceptions:inspect,rows:await this.repository.query(`SELECT id,status,mode,started_at AS "startedAt",completed_at AS "completedAt",page_count AS "pageCount",line_count AS "lineCount",changed_count AS "changedCount",error_summary AS "errorSummary",source_summary AS "sourceSummary" FROM finance_e10_runs WHERE tenant_id=$1 ${inspect?'':'AND actor_id=$2'} ORDER BY started_at DESC LIMIT 20`,inspect?[a.tenantId]:[a.tenantId,a.userId])};
 }
 async exceptions(a:TableFilterActor){orderAuthorize(a,'finance-e10-lines');if(!financeAdmin(a))throw new ForbiddenException('异常日志需要财务管理员权限');
  return this.repository.query(`SELECT order_no AS "orderNo",customer_code AS "customerCode",year_month AS "yearMonth",order_total AS "orderTotal",conflict,delivery_date_conflict AS "deliveryDateConflict",duplicate_sequence AS "duplicateSequence",duplicate_order_no AS "duplicateOrderNo",negative_lines AS "negativeLines",missing_lines AS "missingLines",issue_lines AS "issueLines" FROM finance_e10_orders_all WHERE tenant_id=$1 AND (conflict OR delivery_date_conflict OR duplicate_sequence OR duplicate_order_no OR negative_lines>0 OR missing_lines>0 OR issue_lines>0) ORDER BY order_date DESC LIMIT 1000`,[a.tenantId]);
 }
 async dashboard(input:Record<string,unknown>,a:TableFilterActor){
  const resource='finance-e10-dashboard';orderAuthorize(a,resource);
  // Aggregates must not reveal hidden amounts, classifications or customer identifiers.
  if(financeDashboardRequiredFields.some(f=>!orderField(a,resource,f.key)))throw new ForbiddenException('统计大屏需要完整报表字段读取权限');
  const p:unknown[]=[a.tenantId];const context=input.context&&typeof input.context==='object'?input.context as Record<string,unknown>:{};
  if(context.salesperson&&!orderField(a,resource,'salesperson'))throw new ForbiddenException('不能按隐藏业务员字段筛选');
  const where=[`record.tenant_id=$1`,orderScope(a,resource,p),orderContext(context,p,resource,a)];
  if(input.filterGroup)where.push(new SqlFilterCompiler(financeMonthlyFields,orderColumns(resource),key=>orderField(a,resource,key),c=>`record.${c}`).compile(input.filterGroup,p));
  return this.repository.transaction(a.tenantId,async m=>{
   // The derived-order cardinality is underestimated: a partial-key merge replays
   // the order aggregate for every item. Keep the full-key hash plan local to this
   // transaction; pooled connections and every other query retain their defaults.
   await m.query('SET LOCAL enable_mergejoin = off');
   await m.query('SET LOCAL enable_nestloop = off');
    await m.query('SET LOCAL jit = off');
   // One statement/materialized source keeps all financial dimensions on the same database snapshot.
   const cte=`WITH selected AS MATERIALIZED(SELECT record.source_database,record.source_order_id,record.customer_code,record.order_total,record.department_category,record.sales_channel,record.year_month,record.delivery_date_conflict FROM finance_e10_order_monthly_movements record WHERE ${where.join(' AND ')})`;
   const [result]=await m.query(`${cte} SELECT
   (SELECT row_to_json(t) FROM(SELECT count(DISTINCT(source_database,source_order_id))::integer orders,COALESCE(sum(order_total),0)::text amount,count(DISTINCT customer_code)::integer customers,
    count(DISTINCT(source_database,source_order_id)) FILTER(WHERE department_category IS NULL OR sales_channel IS NULL)::integer "pendingOrders",
    count(DISTINCT customer_code) FILTER(WHERE department_category IS NULL OR sales_channel IS NULL)::integer "pendingCustomers",
    COALESCE(sum(order_total) FILTER(WHERE department_category IS NULL OR sales_channel IS NULL),0)::text "pendingAmount",
    count(*) FILTER(WHERE order_total=0)::integer "zeroOrders",
    ${orderField(a,resource,'deliveryDateConflict')?'count(*) FILTER(WHERE delivery_date_conflict)::integer':'NULL::integer'} "deliveryDateConflicts" FROM selected)t) totals,
   (SELECT COALESCE(jsonb_agg(g),'[]'::jsonb) FROM(
    SELECT 'department' kind,department_category category,sum(order_total)::text amount FROM selected GROUP BY department_category
    UNION ALL SELECT 'channel',sales_channel,sum(order_total)::text FROM selected GROUP BY sales_channel)g) groups,
   (SELECT COALESCE(jsonb_agg(g),'[]'::jsonb) FROM(SELECT year_month AS "month",sum(order_total)::text amount,count(*)::integer orders FROM selected GROUP BY year_month ORDER BY year_month)g) months,
   (SELECT COALESCE(jsonb_agg(g),'[]'::jsonb) FROM(SELECT department_category AS "departmentCategory",sales_channel AS "salesChannel",sum(order_total)::text amount FROM selected GROUP BY department_category,sales_channel)g) matrix,
   NULL::json quality`,p);
   const {totals,groups,months,matrix,quality}=result;
   const total=new Decimal(totals.amount);const share=(amt:string)=>total.isZero()?null:new Decimal(amt).div(total).toFixed(8);
   const bucket=(kind:string,labels:string[])=>[...labels,null].map(category=>{const amount=groups.find((g:any)=>g.kind===kind&&g.category===category)?.amount??'0.00';return {category:category??'待分类',amount,share:share(amount)};});
   const actualMonths=months.map((r:any)=>String(r.month));
   const visibleMonths=financeDashboardMonthSeries(context,actualMonths);
   const monthly=visibleMonths.map(month=>{const amount=months.find((r:any)=>r.month===month)?.amount??'0.00';return {month,amount,wan:new Decimal(amount).div(10000).toFixed(6)};});
   return {totals:{...totals,average:totals.orders?total.div(totals.orders).toFixed(2):null},channels:bucket('channel',['内销','外销']),departments:bucket('department',['业务一部','业务二部','业务三部','业务四部']),months:monthly,matrix,quality};
  });
 }
}
