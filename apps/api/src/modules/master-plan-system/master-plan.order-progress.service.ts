import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { standardProcesses } from "@tracker/shared";
import { mpsDashboardDateRange, mpsOrderProgressResource as resource, mpsOrderProgressOrderColumns, mpsOrderProgressItemExportColumns, tablePermissionFieldsFor, type MpsDashboardFilters, type MpsProgressPage, type MpsProgressRow } from "@kdos/contracts";
import { buildDataScopeClause } from "../../common/filtering/data-scope";
import { normalizeKdosPageSize } from "../../common/pagination";
import { masterPlanProductionProgressSql, masterPlanProcessStatusSql, masterPlanAuxiliaryStatusSql, masterPlanMaterialStatusSql, masterPlanDeliveryDateSql, masterPlanHumanExceptionSources, masterPlanExceptionPartSql } from "./master-plan.config";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";

export type OrderProgressQuery = MpsDashboardFilters & { page?: unknown; pageSize?: unknown; orderId?: string; itemId?: string; onlyUnfinishedOrders?: string; onlyUnfinishedItems?: string; sortField?: string; sortOrder?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const processes = [...standardProcesses].sort((a,b)=>a.order-b.order);
const registeredFields = new Set(tablePermissionFieldsFor(resource).map(f=>f.key));
type Kind = "orders" | "items";

@Injectable()
export class MasterPlanOrderProgressService {
  constructor(private readonly db: DataSource, private readonly formal: MasterPlanQueryService) {}
  assert(actor: MasterPlanActor, action = "read") {
    if (!hasMasterPlanPermission(actor,resource,action)) throw new ForbiddenException("没有在制订单进度看板权限");
  }
  allowed(actor: MasterPlanActor, key: string): boolean {
    if(!registeredFields.has(key))return false;
    const deps: Record<string,string[]> = {
      orderCompletionRate:["orderRequiredQuantity","orderCompletedQuantity"], itemCompletionRate:["requiredQuantity","cumulativeInboundQuantity"],
      unfinishedItemCount:["pendingQuantity","planStatus"], coverageStatus:["planStatus"]
    };
    const compositeDependencies = ["requiredQuantity","cumulativeInboundQuantity",...processes.flatMap(p=>[p.code+"ReportedQuantity",p.code+"TaskCount"])];
    for (const key of ["orderProductionProgress","itemProductionProgress","orderProgressBasis","itemProgressBasis"]) deps[key]=compositeDependencies;
    for(const p of processes)deps[p.code+"ProductionProgress"]=[p.code+"RequiredQuantity",p.code+"ReportedQuantity"];
    return hasMasterPlanFieldPermission(actor,resource,key,"read") && (deps[key]??[]).every(k=>hasMasterPlanFieldPermission(actor,resource,k,"read"));
  }
  private normalize(input: OrderProgressQuery,actor: MasterPlanActor,kind:Kind) {
    this.assert(actor);const q={...input};
    for(const k of ["orderNumbers","itemCodes"] as const){let v:unknown=q[k];if(typeof v==="string"){try{v=JSON.parse(v)}catch{throw new BadRequestException("多选筛选必须为数组")}}
      if(v!=null&&(!Array.isArray(v)||v.length>100||v.some(x=>typeof x!=="string"||!x.trim()||x.length>200)))throw new BadRequestException("多选条件无效");q[k]=v as string[]|undefined;}
    for(const [k,f] of [["divisionId","divisionId"],["customerCode","customerCode"],["orderNumbers","orderNumber"],["itemCodes","itemCode"]] as const){if(q[k]?.length&&!this.allowed(actor,f))throw new ForbiddenException("没有筛选字段权限")}
    if(q.divisionId&&!uuid.test(q.divisionId))throw new BadRequestException("事业部必须使用稳定组织ID");
    for(const k of ["customerCode","dateType","datePeriod","dateValue","dateFrom","dateTo","sortField","sortOrder"] as const)if(q[k]!=null&&(typeof q[k]!=="string"||q[k]!.length>200))throw new BadRequestException("查询参数无效");
    for(const k of ["orderId","itemId"] as const)if(q[k]&&!uuid.test(q[k]!))throw new BadRequestException("记录定位无效");
    for(const k of ["onlyUnfinishedOrders","onlyUnfinishedItems"] as const)if(q[k]!=null&&!["true","false"].includes(q[k]!))throw new BadRequestException("未完成条件无效");
    q.onlyUnfinishedOrders??="true";q.onlyUnfinishedItems??="true";
    if(q.onlyUnfinishedOrders==="true"&&(!this.allowed(actor,"orderPendingQuantity")||!this.allowed(actor,"coverageStatus")))throw new ForbiddenException("没有未完成订单筛选所需字段权限");
    if(q.onlyUnfinishedItems==="true"&&(!this.allowed(actor,"pendingQuantity")||!this.allowed(actor,"planStatus")))throw new ForbiddenException("没有未完成品项筛选所需字段权限");
    if(q.dateType&&q.dateType!=="NONE"&&!this.allowed(actor,q.dateType==="ORDER"?"orderDate":"deliveryDate"))throw new ForbiddenException("没有日期字段权限");
    try{mpsDashboardDateRange(q)}catch(e){throw new BadRequestException((e as Error).message)}
    const columns=kind==="orders"?mpsOrderProgressOrderColumns:mpsOrderProgressItemExportColumns;
    if(q.sortField&&!columns.some(([k])=>k===q.sortField))throw new BadRequestException("排序字段无效");
    if(q.sortField&&!this.allowed(actor,q.sortField))throw new ForbiddenException("没有排序字段权限");
    if(q.sortOrder&&!["asc","desc"].includes(q.sortOrder))throw new BadRequestException("排序方向无效");
    return q;
  }
  private scope(actor:MasterPlanActor,params:unknown[],division="division_id",action="read") {
    for(const s of actor.tableDataScopes.filter(s=>s.resource===resource&&s.scope==="CUSTOM"&&(!s.actions||s.actions.includes(action)))){
      if(!s.rules?.length||s.rules.some(r=>r.fieldKey!=="divisionId"||!["EQ","IN"].includes(r.operator??"")||(r.operator==="EQ"?!uuid.test(String(r.value)):!Array.isArray(r.value)||!r.value.length||r.value.some(v=>!uuid.test(String(v))))))throw new ForbiddenException("自定义数据范围只支持事业部组织ID等于或包含");
    }
    return buildDataScopeClause({resource,actor,params,action,columns:{divisionId:division,createdBy:"created_by"}});
  }
  private facts(q:OrderProgressQuery,actor:MasterPlanActor,params:unknown[],action:"read"|"export") {
    const bind=(v:unknown)=>{params.push(v);return `$${params.length}`};
    const authorized=(table:string,division="division_id",extra="")=>`SELECT record.* FROM ${table} record WHERE record.tenant_id=$1 AND (${this.scope(actor,params,division)}) ${action==="export"?`AND (${this.scope(actor,params,division,"export")})`:""} ${extra}`;
    const parent=q.orderId?`AND record.id=${bind(q.orderId)}::uuid`:"";
    const ctes=[`a_group AS MATERIALIZED (${authorized("mps_group_plans","primary_division_id",parent)})`,
      ...["monthly","shipping","base","weekly"].map(k=>`a_${k} AS MATERIALIZED (${authorized(`mps_${k}_plans`,"division_id",q.orderId?"AND EXISTS(SELECT 1 FROM a_group g WHERE g.order_number=record.order_number)":"")})`),
      `a_allocation AS MATERIALIZED (${authorized("mps_order_allocations","division_id","AND record.archived_at IS NULL")})`,
      // ERP has no division; its formal group is the only authoritative owner.
      `a_erp AS MATERIALIZED (SELECT record.* FROM (SELECT e.*,g.primary_division_id division_id,count(*) OVER(PARTITION BY e.tenant_id,e.order_number,e.item_code) source_line_count FROM mps_erp_order_lines e JOIN a_group g ON g.tenant_id=e.tenant_id AND g.order_number=e.order_number WHERE e.tenant_id=$1 AND e.source_active=true) record WHERE (${this.scope(actor,params)}) ${action==="export"?`AND (${this.scope(actor,params,"division_id","export")})`:""})`,
      `weekly_parents AS MATERIALIZED (SELECT w.*,s.monthly_plan_id parent_monthly_id FROM a_weekly w LEFT JOIN a_base b ON b.tenant_id=w.tenant_id AND b.id=w.base_plan_id LEFT JOIN a_shipping s ON s.tenant_id=b.tenant_id AND s.id=b.shipping_plan_id)`,
      `related_weekly AS MATERIALIZED (SELECT w.*,m.id monthly_id FROM weekly_parents w JOIN a_monthly m ON m.tenant_id=w.tenant_id AND m.id=w.parent_monthly_id AND m.division_id IS NOT DISTINCT FROM w.division_id WHERE w.parent_monthly_id IS NOT NULL UNION ALL SELECT w.*,m.id monthly_id FROM weekly_parents w JOIN a_monthly m ON m.tenant_id=w.tenant_id AND m.order_number=w.order_number AND m.item_code=w.item_code AND m.division_id IS NOT DISTINCT FROM w.division_id WHERE w.parent_monthly_id IS NULL)`,
      `actual_tasks AS MATERIALIZED (SELECT t.* FROM mps_weekly_process_plans t JOIN related_weekly w ON w.tenant_id=t.tenant_id AND w.id=t.weekly_plan_id WHERE t.tenant_id=$1 AND t.execution_enabled=true AND w.manufacturing_method IN ('自制','自制+外协'))`];
    ctes.push(`actual_process AS MATERIALIZED (SELECT r.* FROM (${authorized("mps_process_reports")}) r JOIN related_weekly w ON w.tenant_id=r.tenant_id AND w.id=r.weekly_plan_id JOIN actual_tasks t ON t.tenant_id=r.tenant_id AND t.weekly_plan_id=r.weekly_plan_id AND t.process_code=r.process_code AND t.execution_enabled=true)`);
    for(const name of ["technical","material","outsourcing"])ctes.push(`actual_${name} AS MATERIALIZED (SELECT r.* FROM (${authorized(`mps_${name}_reports`)}) r JOIN related_weekly w ON w.tenant_id=r.tenant_id AND w.id=r.weekly_plan_id)`);
    ctes.push(
      `weekly_totals AS MATERIALIZED (SELECT monthly_id,sum(planned_quantity) dispatched,min(latest_customer_due_date) FILTER(WHERE pending_quantity>0) outstanding_due,max(latest_customer_due_date) latest_due FROM related_weekly GROUP BY monthly_id)`,
      `process_totals AS MATERIALIZED (SELECT tenant_id,weekly_plan_id,process_code,sum(production_quantity) reported,max(production_date) last_report FROM actual_process GROUP BY 1,2,3)`,
      `process_facts AS MATERIALIZED (SELECT w.monthly_id,p.process_code,sum(p.reported) reported,max(p.last_report) last_report FROM related_weekly w JOIN process_totals p ON p.tenant_id=w.tenant_id AND p.weekly_plan_id=w.id GROUP BY 1,2)`,
      `task_facts AS MATERIALIZED (SELECT w.monthly_id,t.process_code,count(*) task_count,${masterPlanProcessStatusSql("t.status")} status FROM related_weekly w JOIN actual_tasks t ON t.tenant_id=w.tenant_id AND t.weekly_plan_id=w.id GROUP BY 1,2)`,
      `process_by_monthly AS MATERIALIZED (SELECT monthly_id,jsonb_object_agg(process_code,jsonb_build_object('reported',reported::text,'lastReport',last_report::text)) metrics FROM process_facts GROUP BY monthly_id)`,
      `task_by_monthly AS MATERIALIZED (SELECT monthly_id,jsonb_object_agg(process_code,jsonb_build_object('status',status,'count',task_count)) metrics FROM task_facts GROUP BY monthly_id)`,
      `technical_facts AS MATERIALIZED (SELECT w.monthly_id,${masterPlanAuxiliaryStatusSql("r.status")} status FROM related_weekly w JOIN actual_technical r ON r.tenant_id=w.tenant_id AND r.weekly_plan_id=w.id GROUP BY 1)`,
      `material_facts AS MATERIALIZED (SELECT w.monthly_id,r.material_name,${masterPlanAuxiliaryStatusSql(masterPlanMaterialStatusSql("r.received","r.actual_inbound_date","CASE WHEN r.material_name='五金' THEN w.hardware_due_date ELSE w.wood_due_date END"))} status FROM related_weekly w JOIN actual_material r ON r.tenant_id=w.tenant_id AND r.weekly_plan_id=w.id GROUP BY 1,2)`,
      `outsourcing_facts AS MATERIALIZED (SELECT w.monthly_id,${masterPlanAuxiliaryStatusSql("r.status")} status FROM related_weekly w JOIN actual_outsourcing r ON r.tenant_id=w.tenant_id AND r.weekly_plan_id=w.id GROUP BY 1)`,
      `exception_records AS MATERIALIZED (${masterPlanHumanExceptionSources.map((source,index)=>`SELECT w.monthly_id,${index} source_order,'${source.label}' source_label,report.exception_text FROM related_weekly w JOIN actual_${source.table.replace("mps_","").replace("_reports","")} report ON report.tenant_id=w.tenant_id AND report.weekly_plan_id=w.id WHERE ${source.condition} AND btrim(COALESCE(report.exception_text,''))<>''`).join(" UNION ALL ")})`,
      `exception_parts AS (SELECT monthly_id,source_order,source_label,string_agg(DISTINCT exception_text,'、' ORDER BY exception_text) texts FROM exception_records GROUP BY 1,2,3)`,
      `exception_facts AS MATERIALIZED (SELECT monthly_id,string_agg(${masterPlanExceptionPartSql("source_label","texts")},'；' ORDER BY source_order) summary FROM exception_parts GROUP BY 1)`
    );
    // Use only actual enabled snapshots. Never infer stages from the canonical registry or refresh a locked route.
    const processNames = processes.map(p=>`WHEN '${p.code}' THEN '${p.name}'`).join(" ");
    ctes.push(
      `composite_stages AS MATERIALIZED (SELECT t.monthly_id,count(*) stage_count,
        string_agg(CASE t.process_code ${processNames} END,'、' ORDER BY t.process_code) process_names,
        sum(least(1,greatest(0,COALESCE(m.cumulative_inbound_quantity,0)/NULLIF(m.required_quantity,0),COALESCE(p.reported,0)/NULLIF(m.required_quantity,0)))) stage_sum
        FROM task_facts t JOIN a_monthly m ON m.id=t.monthly_id
        LEFT JOIN process_facts p ON p.monthly_id=t.monthly_id AND p.process_code=t.process_code
        WHERE t.process_code IN (${processes.map(p=>`'${p.code}'`).join(',')}) GROUP BY t.monthly_id)`,
      `composite_methods AS MATERIALIZED (SELECT monthly_id,count(*) weekly_count,
        bool_and(COALESCE(manufacturing_method IN ('外协','纯外协','中心外购'),false)) procurement_only,
        bool_or(manufacturing_method IS NULL OR manufacturing_method NOT IN ('自制','自制+外协','外协','纯外协','中心外购')
          OR (manufacturing_method IN ('自制','自制+外协') AND NOT EXISTS(SELECT 1 FROM actual_tasks t WHERE t.weekly_plan_id=related_weekly.id))) unresolved
        FROM related_weekly GROUP BY monthly_id)`,
      `composite_items AS MATERIALIZED (SELECT m.id,
        CASE WHEN m.required_quantity IS NULL OR m.required_quantity<=0 THEN NULL
          WHEN m.cumulative_inbound_quantity>=m.required_quantity THEN 1
          WHEN methods.unresolved THEN NULL
          WHEN COALESCE(s.stage_count,0)>0 THEN
            (least(1,greatest(0,COALESCE(m.cumulative_inbound_quantity,0)/m.required_quantity))+s.stage_sum)/(s.stage_count+1)
          WHEN methods.procurement_only OR m.manufacturing_method IN ('外协','纯外协','中心外购') THEN least(1,greatest(0,COALESCE(m.cumulative_inbound_quantity,0)/m.required_quantity))
          ELSE NULL END production_progress,
        CASE WHEN m.required_quantity IS NULL OR m.required_quantity<=0 THEN '需求数量无效，待核实'
          WHEN methods.unresolved AND COALESCE(m.cumulative_inbound_quantity,0)<m.required_quantity THEN '部分周计划工艺未确认，综合进度待核实'
          WHEN COALESCE(s.stage_count,0)>0 THEN '周计划有效工序快照：'||s.process_names||'；各工序与入库等权'
          WHEN methods.procurement_only OR m.manufacturing_method IN ('外协','纯外协','中心外购') THEN '纯外协/中心外购，仅按入库'
          WHEN m.cumulative_inbound_quantity>=m.required_quantity THEN '已全部入库'
          ELSE '有效工序未确认，综合进度待核实' END progress_basis
        FROM a_monthly m LEFT JOIN composite_stages s ON s.monthly_id=m.id LEFT JOIN composite_methods methods ON methods.monthly_id=m.id)`
    );
    ctes.push(`source_items AS MATERIALIZED (
      SELECT m.id,m.tenant_id,m.order_number,m.item_code,m.item_name,m.division_id,m.customer_code,m.order_date,${masterPlanDeliveryDateSql("wt.outstanding_due","wt.latest_due","m.latest_customer_due_date")} delivery_date,'月计划'::text source_kind,NULL::numeric source_quantity,m.required_quantity,m.cumulative_inbound_quantity,m.pending_quantity,m.completion_rate,'已建立月计划'::text plan_status FROM a_monthly m LEFT JOIN weekly_totals wt ON wt.monthly_id=m.id
      UNION ALL SELECT a.id,a.tenant_id,a.order_number,a.item_code,a.item_name,a.division_id,a.customer_code,a.order_date,NULL::date,'订单分配',a.allocated_quantity,NULL,NULL,NULL,NULL,'尚未建立月计划' FROM a_allocation a WHERE NOT EXISTS(SELECT 1 FROM a_monthly m WHERE m.tenant_id=a.tenant_id AND m.allocation_id=a.id)
      UNION ALL SELECT e.id,e.tenant_id,e.order_number,e.item_code,e.item_name,e.division_id,e.customer_code,e.order_date,NULL::date,'ERP订单行',e.order_quantity,NULL,NULL,NULL,NULL,CASE WHEN EXISTS(SELECT 1 FROM a_monthly m WHERE m.tenant_id=e.tenant_id AND m.order_number=e.order_number AND m.item_code=e.item_code) THEN '来源行与月计划关联待核实' ELSE '尚未建立月计划' END FROM a_erp e WHERE e.source_line_count>1 OR (NOT EXISTS(SELECT 1 FROM a_monthly m WHERE m.tenant_id=e.tenant_id AND m.order_number=e.order_number AND m.item_code=e.item_code) AND NOT EXISTS(SELECT 1 FROM a_allocation a WHERE a.tenant_id=e.tenant_id AND a.order_number=e.order_number AND a.item_code=e.item_code))
    )`);
    ctes.push(`composite_orders AS MATERIALIZED (SELECT i.order_number,
      CASE WHEN count(*) FILTER(WHERE c.production_progress IS NULL)>0 THEN NULL ELSE avg(c.production_progress) END production_progress,
      CASE WHEN count(*) FILTER(WHERE c.production_progress IS NULL)>0 THEN count(*) FILTER(WHERE c.production_progress IS NULL)::text||'个品项工艺或需求待核实'
      ELSE '品项综合进度等权平均；有效工序＋入库分阶段等权' END progress_basis
      FROM source_items i LEFT JOIN composite_items c ON c.id=i.id GROUP BY i.order_number)`);
    const itemWhere:string[]=[],groupWhere:string[]=[];
    if(q.divisionId){const b=bind(q.divisionId);itemWhere.push(`i.division_id=${b}::uuid`);groupWhere.push(`g.primary_division_id=${b}::uuid`)}
    if(q.customerCode){const b=bind(q.customerCode);itemWhere.push(`i.customer_code=${b}`);groupWhere.push(`g.customer_code=${b}`)}
    if(q.orderNumbers?.length){const b=bind(q.orderNumbers);itemWhere.push(`i.order_number=ANY(${b}::text[])`);groupWhere.push(`g.order_number=ANY(${b}::text[])`)}
    if(q.itemCodes?.length){itemWhere.push(`i.item_code=ANY(${bind(q.itemCodes)}::text[])`);groupWhere.push("EXISTS(SELECT 1 FROM view_items i WHERE i.order_number=g.order_number)")}
    const range=mpsDashboardDateRange(q);
    if(range){const from=bind(range.start),to=bind(range.end),column=q.dateType==="ORDER"?"COALESCE(g.order_date,i.order_date)":"i.delivery_date";
      itemWhere.push(`${column}>=${from}::date AND ${column}<${to}::date`);
      groupWhere.push(q.dateType==="ORDER"?`g.order_date>=${from}::date AND g.order_date<${to}::date`:"EXISTS(SELECT 1 FROM view_items i WHERE i.order_number=g.order_number)");}
    ctes.push(`view_items AS MATERIALIZED (SELECT i.* FROM source_items i JOIN a_group g ON g.tenant_id=i.tenant_id AND g.order_number=i.order_number WHERE ${itemWhere.join(" AND ")||"true"})`,
      `view_orders AS MATERIALIZED (SELECT g.*,(SELECT min(delivery_date) FROM view_items i WHERE i.order_number=g.order_number) delivery_date,(SELECT count(*) FROM view_items i WHERE i.order_number=g.order_number AND (i.pending_quantity>0 OR i.plan_status<>'已建立月计划')) unfinished_items,(SELECT count(*) FROM view_items i WHERE i.order_number=g.order_number AND i.plan_status<>'已建立月计划') uncovered_items FROM a_group g WHERE ${groupWhere.join(" AND ")||"true"})`,
      `filtered_orders AS MATERIALIZED (SELECT * FROM view_orders WHERE ${q.onlyUnfinishedOrders==="true"?"pending_quantity>0 OR uncovered_items>0 OR NOT EXISTS(SELECT 1 FROM view_items i WHERE i.order_number=view_orders.order_number)":"true"})`,
      `filtered_items AS MATERIALIZED (SELECT i.* FROM view_items i JOIN filtered_orders g ON g.tenant_id=i.tenant_id AND g.order_number=i.order_number WHERE (${q.onlyUnfinishedItems==="true"?"i.pending_quantity>0 OR i.plan_status<>'已建立月计划'":"true"}) ${q.itemId?`AND i.id=${bind(q.itemId)}::uuid`:""})`);
    return ctes.join(",\n");
  }
  /** Public for read-only production EXPLAIN/reconciliation and PostgreSQL regression. */
  querySql(input:OrderProgressQuery,actor:MasterPlanActor,kind:Kind,action:"read"|"export"="read",all=false) {
    const q=this.normalize(input,actor,kind);if(action==="export")this.assert(actor,"export");
    const params:unknown[]=[actor.tenantId],facts=this.facts(q,actor,params,action),page=Math.max(1,Math.floor(Number(q.page)||1)),pageSize=normalizeKdosPageSize(Number(q.pageSize)||100);
    const json=(values:Record<string,string>)=>{const entries=Object.entries(values),chunks:string[]=[];for(let i=0;i<entries.length;i+=40)chunks.push(`jsonb_build_object(${entries.slice(i,i+40).flatMap(([k,v])=>[`'${k}'`,v]).join(",")})`);return chunks.join(" || ")};
    const itemValues:Record<string,string>={id:"i.id::text",orderId:"g.id::text",divisionId:"i.division_id",divisionName:"o.name",orderNumber:"i.order_number",itemCode:"i.item_code",itemName:"i.item_name",customerCode:"i.customer_code",orderDate:"COALESCE(g.order_date,i.order_date)::text",deliveryDate:"i.delivery_date::text",sourceKind:"i.source_kind",sourceQuantity:"i.source_quantity::text",planStatus:"i.plan_status",requiredQuantity:"i.required_quantity::text",cumulativeInboundQuantity:"i.cumulative_inbound_quantity::text",pendingQuantity:"i.pending_quantity::text",itemCompletionRate:"i.completion_rate::text",itemProductionProgress:"ci.production_progress::text",itemProgressBasis:"ci.progress_basis",dispatchedWeeklyQuantity:`CASE WHEN record.id IS NOT NULL THEN COALESCE(wt.dispatched,0)::text END`,exceptionSummary:`CASE WHEN record.id IS NOT NULL THEN COALESCE(ef.summary,'') END`};
    for(const [key,alias]of Object.entries({technical:"tf",hardware:"hf",wood:"wf",outsourcing:"ofc"}))itemValues[key+"Status"]=`${alias}.status`;
    for(const p of processes){const k=p.code,reported=`COALESCE((pf.metrics->'${k}'->>'reported')::numeric,0)`;
      itemValues[k+"RequiredQuantity"]="i.required_quantity::text";
      itemValues[k+"ReportedQuantity"]=`CASE WHEN record.id IS NOT NULL THEN (${reported})::text END`;
      itemValues[k+"ProductionProgress"]=`(${masterPlanProductionProgressSql(reported,"i.required_quantity")})::text`;
      itemValues[k+"Status"]=`pt.metrics->'${k}'->>'status'`;
      itemValues[k+"TaskCount"]=`CASE WHEN record.id IS NOT NULL THEN COALESCE((pt.metrics->'${k}'->>'count')::int,0) END`;
      itemValues[k+"LastReportDate"]=`pf.metrics->'${k}'->>'lastReport'`;
    }
    const orderValues:Record<string,string>={id:"g.id::text",divisionId:"g.primary_division_id",divisionName:"o.name",customerCode:"g.customer_code",orderNumber:"g.order_number",orderDate:"g.order_date::text",deliveryDate:"g.delivery_date::text",orderRequiredQuantity:"g.required_quantity::text",orderCompletedQuantity:"g.completed_quantity::text",orderPendingQuantity:"g.pending_quantity::text",orderCompletionRate:"g.completion_rate::text",orderProductionProgress:"co.production_progress::text",orderProgressBasis:"co.progress_basis",unfinishedItemCount:"g.unfinished_items",coverageStatus:"CASE WHEN g.uncovered_items>0 THEN '月计划未完全覆盖' WHEN NOT EXISTS(SELECT 1 FROM view_items i WHERE i.order_number=g.order_number) THEN '暂无品项数据' ELSE '已建立月计划' END",exceptionSummary:`CASE WHEN EXISTS(SELECT 1 FROM exception_facts e JOIN view_items i ON i.id=e.monthly_id WHERE i.order_number=g.order_number) THEN '存在人工报工异常' ELSE '' END`};
    const values=kind==="orders"?orderValues:itemValues,projection=json(values);
    // Whitelisted projection expressions are safe identifiers; never interpolate user SQL.
    const sort=q.sortField?`(${values[q.sortField]??"NULL"})${/Quantity$|Rate$|Progress$|Count$/.test(q.sortField)?"::numeric":""} ${q.sortOrder==="desc"?"DESC":"ASC"} NULLS LAST,`:"";
    const tail=all?"":`LIMIT ${pageSize} OFFSET ${(page-1)*pageSize}`;
    const rows=kind==="orders"?`SELECT ${projection} row FROM filtered_orders g LEFT JOIN composite_orders co ON co.order_number=g.order_number LEFT JOIN organization_units o ON o.id=g.primary_division_id ORDER BY ${sort}g.order_date DESC NULLS LAST,g.order_number,g.id ${tail}`:
      `SELECT ${projection} row FROM filtered_items i JOIN filtered_orders g ON g.tenant_id=i.tenant_id AND g.order_number=i.order_number LEFT JOIN a_monthly record ON record.tenant_id=i.tenant_id AND record.id=i.id LEFT JOIN composite_items ci ON ci.id=i.id LEFT JOIN weekly_totals wt ON wt.monthly_id=record.id LEFT JOIN exception_facts ef ON ef.monthly_id=record.id LEFT JOIN process_by_monthly pf ON pf.monthly_id=record.id LEFT JOIN task_by_monthly pt ON pt.monthly_id=record.id LEFT JOIN technical_facts tf ON tf.monthly_id=record.id LEFT JOIN material_facts hf ON hf.monthly_id=record.id AND hf.material_name='五金' LEFT JOIN material_facts wf ON wf.monthly_id=record.id AND wf.material_name='木作' LEFT JOIN outsourcing_facts ofc ON ofc.monthly_id=record.id LEFT JOIN organization_units o ON o.id=i.division_id ORDER BY ${sort}i.order_number,i.item_code,i.source_kind,i.id ${tail}`;
    return {sql:`WITH ${facts} SELECT jsonb_build_object('total',(SELECT count(*) FROM ${kind==="orders"?"filtered_orders":"filtered_items"}),'rows',COALESCE((SELECT jsonb_agg(row) FROM (${rows}) x),'[]'::jsonb)) data`,params,page,pageSize};
  }
  async page(input:OrderProgressQuery,actor:MasterPlanActor,kind:Kind,action:"read"|"export"="read",all=false):Promise<MpsProgressPage> {
    const query=this.querySql(input,actor,kind,action,all);
    const data=await this.db.transaction("REPEATABLE READ",async m=>{await m.query("SET TRANSACTION READ ONLY");await m.query("SELECT set_config('app.tenant_id',$1,true),set_config('TimeZone','Asia/Shanghai',true),set_config('statement_timeout','15000',true),set_config('jit','off',true)",[actor.tenantId]);return (await m.query(query.sql,query.params))[0].data});
    const visibleFields=tablePermissionFieldsFor(resource).map(f=>f.key).filter(k=>this.allowed(actor,k));
    return {...data,page:query.page,pageSize:query.pageSize,visibleFields,rows:data.rows.map((row:MpsProgressRow)=>Object.fromEntries(Object.entries(row).filter(([k])=>["id","orderId"].includes(k)||this.allowed(actor,k==="divisionName"?"divisionId":k))) as MpsProgressRow)};
  }
  async candidates(field:string,search:string,input:OrderProgressQuery,actor:MasterPlanActor) {
    if(!["divisionId","customerCode","orderNumber","itemCode"].includes(field))throw new BadRequestException("候选字段无效");
    if(!this.allowed(actor,field))throw new ForbiddenException("没有候选字段权限");
    if(search!=null&&(typeof search!=="string"||search.length>200))throw new BadRequestException("搜索过长");
    const q={...input,sortField:undefined,sortOrder:undefined};delete q[field==="orderNumber"?"orderNumbers":field==="itemCode"?"itemCodes":field as keyof OrderProgressQuery];
    this.normalize(q,actor,"orders");const params:unknown[]=[actor.tenantId],facts=this.facts(this.normalize(q,actor,"orders"),actor,params,"read");
    params.push(`%${search??""}%`);const p=`$${params.length}`;
    const column={divisionId:"division_id",customerCode:"customer_code",orderNumber:"order_number",itemCode:"item_code"}[field]!;
    const sql=`WITH ${facts}, candidates AS (SELECT i.${column}::text value,${field==="divisionId"?"o.name":field==="itemCode"&&this.allowed(actor,"itemName")?"concat_ws(' · ',i.item_code,max(i.item_name))":`i.${column}::text`} label FROM view_items i JOIN filtered_orders g ON g.tenant_id=i.tenant_id AND g.order_number=i.order_number LEFT JOIN organization_units o ON o.id=i.division_id GROUP BY i.${column}${field==="divisionId"?",o.name":""} UNION SELECT ${field==="divisionId"?"g.primary_division_id::text,o.name":field==="customerCode"?"g.customer_code,g.customer_code":field==="orderNumber"?"g.order_number,g.order_number":"NULL::text,NULL::text"} FROM filtered_orders g LEFT JOIN organization_units o ON o.id=g.primary_division_id) SELECT DISTINCT value,label FROM candidates WHERE value IS NOT NULL AND label ILIKE ${p} ORDER BY label,value LIMIT 51`;
    const rows=await this.db.transaction(async m=>{await m.query("SET TRANSACTION READ ONLY");await m.query("SELECT set_config('app.tenant_id',$1,true),set_config('TimeZone','Asia/Shanghai',true),set_config('jit','off',true),set_config('statement_timeout','15000',true)",[actor.tenantId]);return m.query(sql,params)});
    return {options:rows.slice(0,50),hasMore:rows.length>50};
  }
  async detail(code:string,input:OrderProgressQuery,actor:MasterPlanActor) {
    const sources:Record<string,string>={"mps-weekly-plans":"related_weekly","mps-technical-reports":"actual_technical","mps-material-reports":"actual_material","mps-outsourcing-reports":"actual_outsourcing","mps-weekly-process-plans":"actual_tasks","mps-process-reports":"actual_process"};
    if(!sources[code]||!input.itemId||!input.orderId)throw new BadRequestException("详情定位或资源无效");
    if(!hasMasterPlanPermission(actor,code,"read"))throw new ForbiddenException("当前权限组没有该表查看权限");
    const q=this.normalize({...input,sortField:undefined,sortOrder:undefined},actor,"items");
    const selected=await this.page(q,actor,"items");if(!selected.total)throw new NotFoundException("当前范围没有该品项");
    const data=await this.formal.list(code,{page:q.page,pageSize:q.pageSize},actor,params=>`EXISTS(WITH ${this.facts(q,actor,params,"read")} SELECT 1 FROM filtered_items i JOIN related_weekly w ON w.monthly_id=i.id WHERE ${code==="mps-weekly-plans"?"w.id=record.id":"w.id=record.weekly_plan_id"} AND w.tenant_id=record.tenant_id)`);
    const map=(key:string,row:Record<string,unknown>)=>{
      if(key==="divisionName")return "divisionId";
      if(key==="plannedQuantity")return "dispatchedWeeklyQuantity";
      if(key==="latestCustomerDueDate")return "deliveryDate";
      if(key==="status")return code==="mps-technical-reports"?"technicalStatus":code==="mps-outsourcing-reports"?"outsourcingStatus":String(row.processCode)+"Status";
      if(key==="productionQuantity")return String(row.processCode)+"ReportedQuantity";
      if(key==="productionDate")return String(row.processCode)+"LastReportDate";
      if(key==="exceptionText")return code==="mps-weekly-process-plans"?"__plan_hint_not_manual_exception":"exceptionSummary";
      if(key==="received"||key==="materialName")return row.materialName==="五金"?"hardwareStatus":row.materialName==="木作"?"woodStatus":"outsourcingStatus";
      if(key==="actualInboundDate")return code==="mps-outsourcing-reports"?"outsourcingActualInboundDate":row.materialName==="五金"?"hardwareActualInboundDate":"woodActualInboundDate";
      return key;
    };
    const rows=data.rows.map((row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).filter(([k])=>k==="id"||k==="processCode"||this.allowed(actor,map(k,row)))));
    return {...data,rows,visibleFields:data.visibleFields.filter(k=>rows.some((r:Record<string,unknown>)=>k in r))};
  }
}
