import { BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { buildDataScopeClause } from "../../common/filtering/data-scope";
import { normalizeKdosPageSize } from "../../common/pagination";
import { SqlFilterCompiler } from "../../common/filtering/sql-filter.compiler";
import type { TableFilterActor } from "../../common/filtering/table-filter.registry";
import { mpsDivisionOrderProgressColumns, mpsDivisionOrderProgressFieldKeys, mpsDivisionOrderProgressResource, tablePermissionFieldsFor, type MpsDivisionOrderProgressPage, type MpsDivisionOrderProgressRow } from "@kdos/contracts";
import { RdOrderBomReportQueryService } from "../rd/rd-order-bom-report.query.service";
import { MASTER_PLAN_ERP_ADMISSION } from "./master-plan.erp-admission";
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";

// This identity was verified against organization_units and current allocation records.
// Add future division configurations here after their stable IDs and source ownership are verified.
export const MPS_DIVISION_ORDER_PROGRESS_CONFIGS = {
  fourth: { label: "事业四部", divisionId: "d23442f9-4862-4641-b4a7-c8d470bc56ea" }
} as const;
export type MpsDivisionReportCode = keyof typeof MPS_DIVISION_ORDER_PROGRESS_CONFIGS;
export const mpsDivisionOrderProgressMaxExportRows = 50000;
const processColumns = { welding: "welding_quantity", blank: "blank_quantity", surfaceTreatment: "surface_treatment_quantity", packaging: "packaging_quantity" } as const;
const sortable: Record<string,string> = {
  customerCode:"customer_code", orderNumber:"order_number", itemCode:"item_code", itemName:"item_name", orderDate:"order_date",
  expectedShippingDate:"expected_shipping_date", orderQuantity:"order_quantity", reviewDueDate:"review_due_date",
  weldingQuantity:"welding_quantity", blankQuantity:"blank_quantity",
  surfaceTreatmentQuantity:"surface_treatment_quantity", packagingQuantity:"packaging_quantity", inboundQuantity:"inbound_quantity"
};
const filterExpressions: Record<string,string> = {
  customerCode:"customer_code", orderNumber:"order_number", itemCode:"item_code", itemName:"item_name",
  orderDate:"order_date", expectedShippingDate:"expected_shipping_date", orderQuantity:"order_quantity", reviewDueDate:"review_due_date",
  weldingQuantity:"welding_quantity", blankQuantity:"blank_quantity", surfaceTreatmentQuantity:"surface_treatment_quantity", packagingQuantity:"packaging_quantity",
  inboundQuantity:"CASE WHEN inbound_source_count=0 THEN 0::numeric WHEN inbound_verified THEN COALESCE(inbound_quantity,0) ELSE NULL END"
};
const dateParam = (value: unknown) => {
  if (value == null || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed=new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
};
type Query = {
  page?: unknown; pageSize?: unknown; search?: unknown; orderDateFrom?: unknown; orderDateTo?: unknown;
  shippingDateFrom?: unknown; shippingDateTo?: unknown; reviewDueFrom?: unknown; reviewDueTo?: unknown;
  incomplete?: unknown; processCode?: unknown; processStatus?: unknown; sortField?: unknown; sortOrder?: unknown;
  filterGroup?: unknown; ids?: unknown;
};

@Injectable()
export class MasterPlanDivisionOrderProgressService {
  constructor(private readonly db: DataSource, private readonly bom: RdOrderBomReportQueryService) {}

  assert(actor: MasterPlanActor, action: "read" | "export" = "read") {
    if (!hasMasterPlanPermission(actor, mpsDivisionOrderProgressResource, "read") || (action === "export" && !hasMasterPlanPermission(actor, mpsDivisionOrderProgressResource, "export"))) {
      throw new ForbiddenException("没有事业部订单生产进度报表权限");
    }
  }

  canReadFilterField(actor: TableFilterActor, field:string){
    const principal:MasterPlanActor={tenantId:actor.tenantId,userId:actor.userId,username:actor.username??"",permissions:actor.permissions,
      isSystemAdmin:actor.isSystemAdmin,moduleAdminCodes:actor.moduleAdminCodes,tableDataScopes:actor.tableDataScopes??[],requestId:"",source:"system"};
    return hasMasterPlanFieldPermission(principal,mpsDivisionOrderProgressResource,field,"read");
  }

  metadata(actor: MasterPlanActor) {
    this.assert(actor);
    return { columns: mpsDivisionOrderProgressColumns, canExport: hasMasterPlanPermission(actor,mpsDivisionOrderProgressResource,"export") };
  }

  private normalize(input: Query) {
    for (const key of ["orderDateFrom","orderDateTo","shippingDateFrom","shippingDateTo","reviewDueFrom","reviewDueTo"] as const) {
      if (!dateParam(input[key])) throw new BadRequestException("日期筛选格式无效");
    }
    for (const key of ["search","sortField","sortOrder","processCode","processStatus"] as const) {
      if (input[key] != null && (typeof input[key] !== "string" || input[key].length > 200)) throw new BadRequestException("查询参数无效");
    }
    if (input.incomplete != null && !["true","false"].includes(String(input.incomplete))) throw new BadRequestException("未完成筛选条件无效");
    if (input.ids != null && (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 5000 || input.ids.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))) throw new BadRequestException("选中记录范围无效");
    if (input.processCode != null && !Object.keys(processColumns).includes(String(input.processCode))) throw new BadRequestException("工序编码无效");
    if (input.processStatus != null && !["complete","incomplete"].includes(String(input.processStatus))) throw new BadRequestException("工序完成筛选无效");
    if (input.sortField != null && !Object.hasOwn(sortable,String(input.sortField))) throw new BadRequestException("排序字段无效");
    if (input.sortOrder != null && !["asc","desc"].includes(String(input.sortOrder).toLowerCase())) throw new BadRequestException("排序方向无效");
    for (const [from,to] of [["orderDateFrom","orderDateTo"],["shippingDateFrom","shippingDateTo"],["reviewDueFrom","reviewDueTo"]] as const) {
      if (input[from] && input[to] && String(input[from]) > String(input[to])) throw new BadRequestException("日期范围起止顺序无效");
    }
    const page = Math.max(1,Math.floor(Number(input.page)||1));
    const pageSize = normalizeKdosPageSize(input.pageSize);
    return { page,pageSize, search:String(input.search??"").trim(), orderDateFrom:input.orderDateFrom as string|undefined, orderDateTo:input.orderDateTo as string|undefined,
      shippingDateFrom:input.shippingDateFrom as string|undefined, shippingDateTo:input.shippingDateTo as string|undefined,
      reviewDueFrom:input.reviewDueFrom as string|undefined, reviewDueTo:input.reviewDueTo as string|undefined,
      incomplete:input.incomplete === "true", processCode:input.processCode as string|undefined, processStatus:input.processStatus as string|undefined,
      sortField:String(input.sortField??"orderNumber"),sortOrder:String(input.sortOrder??"asc").toLowerCase(),filterGroup:input.filterGroup,ids:input.ids as string[]|undefined };
  }

  private scope(actor: MasterPlanActor, params: unknown[], action: "read"|"export") {
    for (const scope of actor.tableDataScopes.filter(s=>s.resource===mpsDivisionOrderProgressResource&&s.scope==="CUSTOM"&&(!s.actions||s.actions.includes(action)))) {
      if (!scope.rules?.length || scope.rules.some(rule=>rule.fieldKey!=="divisionId"||!["EQ","IN"].includes(String(rule.operator??""))
        || (rule.operator==="EQ" && !/^[0-9a-f-]{36}$/i.test(String(rule.value)))
        || (rule.operator==="IN" && (!Array.isArray(rule.value)||!rule.value.length||rule.value.some(v=>!/^[0-9a-f-]{36}$/i.test(String(v))))))) {
        throw new ForbiddenException("事业部报表自定义数据范围无效");
      }
    }
    return buildDataScopeClause({resource:mpsDivisionOrderProgressResource,actor,params,action,columns:{divisionId:"division_id",createdBy:"created_by"}});
  }

  /** Candidate requests use the approved allocation source and this report's existing data-scope rules. */
  filterCandidateScope(actor: TableFilterActor, params: unknown[], action: "read"|"export" = "read") {
    const principal: MasterPlanActor = { tenantId:actor.tenantId,userId:actor.userId,username:actor.username??"",permissions:actor.permissions,
      isSystemAdmin:actor.isSystemAdmin,moduleAdminCodes:actor.moduleAdminCodes,tableDataScopes:actor.tableDataScopes??[],requestId:"",source:"system" };
    this.assert(principal,action);
    const scope=this.scope(principal,params,action);
    params.push(MPS_DIVISION_ORDER_PROGRESS_CONFIGS.fourth.divisionId);
    return `record.division_id=$${params.length}::uuid AND record.archived_at IS NULL AND record.order_status='已审核'
      AND EXISTS(SELECT 1 FROM organization_units org WHERE org.id=record.division_id AND org.name='事业四部' AND org.enabled=true) AND (${scope})`;
  }

  private sourceCtes(actor: MasterPlanActor, divisionId: string, params: unknown[], action: "read"|"export") {
    const bind=(value:unknown)=>{params.push(value);return `$${params.length}`;};
    const tenant="$1", division=bind(divisionId), readScope=this.scope(actor,params,"read");
    const exportScope=action==="export"?this.scope(actor,params,"export"):null;
    const sourceDb=bind(MASTER_PLAN_ERP_ADMISSION.sourceDatabase);
    return { bind, ctes:`
      org_guard AS MATERIALIZED (SELECT id FROM organization_units WHERE id=${division}::uuid AND name='事业四部' AND enabled=true),
      allocation AS MATERIALIZED (
        SELECT min(record.id::text)::uuid id,record.tenant_id,record.division_id,min(record.customer_code) customer_code,record.order_number,record.item_code,max(record.item_name) item_name,
          min(record.order_date) order_date,min(record.expected_shipping_date) expected_shipping_date,
          array_agg(DISTINCT record.order_date ORDER BY record.order_date) FILTER(WHERE record.order_date IS NOT NULL) order_date_values,
          array_agg(DISTINCT record.expected_shipping_date ORDER BY record.expected_shipping_date) FILTER(WHERE record.expected_shipping_date IS NOT NULL) shipping_date_values,
          count(DISTINCT record.order_date)::int order_date_count,count(DISTINCT record.expected_shipping_date)::int shipping_date_count,
          sum(record.order_quantity) order_quantity
        FROM mps_order_allocations record CROSS JOIN org_guard
        WHERE record.tenant_id=${tenant} AND record.division_id=${division}::uuid AND record.archived_at IS NULL AND record.order_status='已审核'
          AND (${readScope}) ${exportScope?`AND (${exportScope})`:""}
        GROUP BY record.tenant_id,record.division_id,record.order_number,record.item_code
      ),
      base_valid AS MATERIALIZED (
        SELECT a.id allocation_id,b.id base_id,b.latest_review_due_date,w.id weekly_id,w.pending_quantity,
          COALESCE(to_jsonb(b)->>'lifecycle_status','ACTIVE') lifecycle_status
        FROM allocation a JOIN mps_base_plans b ON b.tenant_id=a.tenant_id AND b.order_number=a.order_number AND b.item_code=a.item_code
          AND b.division_id=a.division_id AND b.customer_code IS NOT DISTINCT FROM a.customer_code
        LEFT JOIN mps_monthly_plans parent_monthly ON parent_monthly.tenant_id=b.tenant_id AND parent_monthly.id=b.monthly_plan_id
        LEFT JOIN mps_shipping_plans parent_shipping ON parent_shipping.tenant_id=b.tenant_id AND parent_shipping.id=b.shipping_plan_id
        LEFT JOIN mps_weekly_plans w ON w.tenant_id=b.tenant_id AND w.base_plan_id=b.id AND w.order_number=b.order_number
          AND w.item_code=b.item_code AND w.division_id=b.division_id
        WHERE (b.monthly_plan_id IS NULL OR parent_monthly.id IS NULL OR (parent_monthly.order_number=b.order_number
            AND parent_monthly.item_code=b.item_code AND parent_monthly.division_id=b.division_id
            AND parent_monthly.customer_code IS NOT DISTINCT FROM b.customer_code))
          AND (b.shipping_plan_id IS NULL OR parent_shipping.id IS NULL OR (parent_shipping.order_number=b.order_number
            AND parent_shipping.item_code=b.item_code AND parent_shipping.division_id=b.division_id))
          AND COALESCE(to_jsonb(b)->>'admission_status','SYNCED') IN ('READY','SYNCED')
      ),
      base_candidates AS MATERIALIZED (
        SELECT * FROM base_valid WHERE lifecycle_status NOT IN ('ON_HOLD','CANCELLED','COMPLETED')
          AND (weekly_id IS NULL OR pending_quantity>0)
      ),
      base_identity AS MATERIALIZED (
        SELECT allocation_id,count(DISTINCT base_id)::int base_plan_count FROM base_valid GROUP BY allocation_id
      ),
      base_rollup AS MATERIALIZED (
        SELECT allocation_id,count(DISTINCT base_id)::int unfinished_base_count,
          min(latest_review_due_date) FILTER(WHERE latest_review_due_date IS NOT NULL) review_due_date,
          string_agg(DISTINCT latest_review_due_date::text,', ' ORDER BY latest_review_due_date::text) FILTER(WHERE latest_review_due_date IS NOT NULL) review_due_tooltip
        FROM base_candidates GROUP BY allocation_id
      ),
      valid_weekly AS MATERIALIZED (
        SELECT DISTINCT a.id allocation_id,w.id weekly_id
        FROM allocation a JOIN mps_base_plans b ON b.tenant_id=a.tenant_id AND b.order_number=a.order_number AND b.item_code=a.item_code
          AND b.division_id=a.division_id AND b.customer_code IS NOT DISTINCT FROM a.customer_code
          AND COALESCE(to_jsonb(b)->>'admission_status','SYNCED') IN ('READY','SYNCED')
          AND COALESCE(to_jsonb(b)->>'lifecycle_status','ACTIVE') NOT IN ('ON_HOLD','CANCELLED','COMPLETED')
        LEFT JOIN mps_monthly_plans parent_monthly ON parent_monthly.tenant_id=b.tenant_id AND parent_monthly.id=b.monthly_plan_id
        LEFT JOIN mps_shipping_plans parent_shipping ON parent_shipping.tenant_id=b.tenant_id AND parent_shipping.id=b.shipping_plan_id
        JOIN mps_weekly_plans w ON w.tenant_id=b.tenant_id AND w.base_plan_id=b.id AND w.order_number=b.order_number
          AND w.item_code=b.item_code AND w.division_id=b.division_id
        WHERE (b.monthly_plan_id IS NULL OR parent_monthly.id IS NULL OR (parent_monthly.order_number=b.order_number
            AND parent_monthly.item_code=b.item_code AND parent_monthly.division_id=b.division_id
            AND parent_monthly.customer_code IS NOT DISTINCT FROM b.customer_code))
          AND (b.shipping_plan_id IS NULL OR parent_shipping.id IS NULL OR (parent_shipping.order_number=b.order_number
            AND parent_shipping.item_code=b.item_code AND parent_shipping.division_id=b.division_id))
      ),
      process_rollup AS MATERIALIZED (
        SELECT v.allocation_id,
          sum(r.production_quantity) FILTER(WHERE r.process_code='welding') welding_quantity,
          sum(r.production_quantity) FILTER(WHERE r.process_code='blank') blank_quantity,
          sum(r.production_quantity) FILTER(WHERE r.process_code='surfaceTreatment') surface_treatment_quantity,
          sum(r.production_quantity) FILTER(WHERE r.process_code='packaging') packaging_quantity
        FROM valid_weekly v JOIN allocation a ON a.id=v.allocation_id
        JOIN mps_process_reports r ON r.tenant_id=${tenant} AND r.weekly_plan_id=v.weekly_id
          AND r.division_id=${division}::uuid AND r.order_number=a.order_number AND r.item_code=a.item_code
        WHERE r.process_code=ANY(ARRAY['welding','blank','surfaceTreatment','packaging']::varchar[])
        GROUP BY v.allocation_id
      ),
      raw_inbound AS MATERIALIZED (
        SELECT r.tenant_id,r.source_system,r.source_database,r.source_id,
          bool_and(r.source_active) source_active,bool_and(r.is_cancelled) is_cancelled,
          bool_and(r.record_type='INBOUND_LINE' AND r.source_table='ST_RDRecord_b' AND r.source_active=true AND r.is_cancelled=false
          AND r.status_code='189') trusted,
          bool_and(r.order_number IS NOT NULL AND r.item_code IS NOT NULL) has_business_keys
        FROM erp_staging_raw_records r WHERE r.tenant_id=${tenant} AND r.source_system='T+' AND r.source_database=${sourceDb}
          AND r.source_table='ST_RDRecord_b' AND r.record_type='INBOUND_LINE'
        GROUP BY r.tenant_id,r.source_system,r.source_database,r.source_id
      ),
      -- T+ can carry the sales order number on the receipt line even when the detail ID is invalid.
      -- Exact order+item equality below is the attribution gate; same-item-only matching is never used.
      inbound_rollup AS MATERIALIZED (
        SELECT a.id allocation_id,count(f.id) FILTER(WHERE COALESCE(raw.source_active,true) AND NOT COALESCE(raw.is_cancelled,false))::int row_count,
          bool_and(COALESCE(raw.trusted AND raw.has_business_keys AND r.order_number=f.sales_order_number AND r.item_code=f.inventory_code,false))
            FILTER(WHERE COALESCE(raw.source_active,true) AND NOT COALESCE(raw.is_cancelled,false)) trusted,
          sum(f.received_quantity) FILTER(WHERE COALESCE(raw.source_active,true) AND NOT COALESCE(raw.is_cancelled,false)
            AND raw.trusted AND raw.has_business_keys AND r.order_number=f.sales_order_number AND r.item_code=f.inventory_code) quantity
        FROM allocation a LEFT JOIN finished_goods_inbound f ON f.sales_order_number=a.order_number AND f.inventory_code=a.item_code
          AND f.source_system='T+' AND f.source_database=${sourceDb} AND f.source_key IS NOT NULL
        LEFT JOIN raw_inbound raw ON raw.tenant_id=a.tenant_id AND raw.source_system=f.source_system AND raw.source_database=f.source_database AND raw.source_id=f.source_key
        LEFT JOIN erp_staging_raw_records r ON r.tenant_id=a.tenant_id AND r.source_system=f.source_system AND r.source_database=f.source_database
          AND r.source_id=f.source_key AND r.source_table='ST_RDRecord_b' AND r.record_type='INBOUND_LINE'
        GROUP BY a.id
      ),
      fact_rows AS MATERIALIZED (
        SELECT a.*,bi.base_plan_count,br.unfinished_base_count,br.review_due_date,br.review_due_tooltip,pr.welding_quantity,pr.blank_quantity,pr.surface_treatment_quantity,pr.packaging_quantity,
          ir.row_count inbound_source_count,ir.trusted inbound_verified,ir.quantity inbound_quantity
        FROM allocation a LEFT JOIN base_identity bi ON bi.allocation_id=a.id LEFT JOIN base_rollup br ON br.allocation_id=a.id LEFT JOIN process_rollup pr ON pr.allocation_id=a.id
        LEFT JOIN inbound_rollup ir ON ir.allocation_id=a.id
      )` };
  }

  private filters(q: ReturnType<MasterPlanDivisionOrderProgressService["normalize"]>, bind: (v:unknown)=>string) {
    const where:string[]=[];
    if(q.search){const p=bind(`%${q.search}%`);where.push(`(customer_code ILIKE ${p} OR order_number ILIKE ${p} OR item_code ILIKE ${p} OR item_name ILIKE ${p})`);}
    for(const [field,operator,value] of [["review_due_date",">=",q.reviewDueFrom],["review_due_date","<=",q.reviewDueTo]] as const){if(value)where.push(`${field}${operator}${bind(value)}::date`);}
    for(const [values,from,to] of [["order_date_values",q.orderDateFrom,q.orderDateTo],["shipping_date_values",q.shippingDateFrom,q.shippingDateTo]] as const){
      if(from||to){const start=bind(from??null),end=bind(to??null);where.push(`EXISTS(SELECT 1 FROM unnest(${values}) date_value WHERE (${start}::date IS NULL OR date_value>=${start}::date) AND (${end}::date IS NULL OR date_value<=${end}::date))`);}
    }
    if(q.incomplete)where.push(`(order_quantity<=0 OR COALESCE(welding_quantity,0)<order_quantity OR COALESCE(blank_quantity,0)<order_quantity OR COALESCE(surface_treatment_quantity,0)<order_quantity OR COALESCE(packaging_quantity,0)<order_quantity OR inbound_verified IS DISTINCT FROM true OR COALESCE(inbound_quantity,0)<order_quantity)`);
    if(q.processCode&&q.processStatus){const field=({welding:"welding_quantity",blank:"blank_quantity",surfaceTreatment:"surface_treatment_quantity",packaging:"packaging_quantity"} as const)[q.processCode as keyof typeof processColumns];where.push(q.processStatus==="complete"?`order_quantity>0 AND COALESCE(${field},0)>=order_quantity`:`(order_quantity<=0 OR COALESCE(${field},0)<order_quantity)`);}
    return where.length?`WHERE ${where.join(" AND ")}`:"";
  }

  async page(report: string, input: Query, actor: MasterPlanActor, action: "read"|"export"="read"): Promise<MpsDivisionOrderProgressPage> {
    this.assert(actor,action);
    if(!Object.hasOwn(MPS_DIVISION_ORDER_PROGRESS_CONFIGS,report))throw new BadRequestException("事业部报表配置不存在");
    const config=MPS_DIVISION_ORDER_PROGRESS_CONFIGS[report as MpsDivisionReportCode],q=this.normalize(input);
    const readableFields=mpsDivisionOrderProgressFieldKeys.filter(key=>hasMasterPlanFieldPermission(actor,mpsDivisionOrderProgressResource,key,"read"));
    if(readableFields.length!==mpsDivisionOrderProgressFieldKeys.length)throw new ForbiddenException("没有报表所需的字段查看权限");
    const params:unknown[]=[actor.tenantId],source=this.sourceCtes(actor,config.divisionId,params,action);
    const businessWhere=this.filters(q,source.bind);
    const compiler=new SqlFilterCompiler(tablePermissionFieldsFor(mpsDivisionOrderProgressResource),filterExpressions,
      key=>hasMasterPlanFieldPermission(actor,mpsDivisionOrderProgressResource,key,"read"));
    const advancedWhere=compiler.compile(q.filterGroup,params);
    const selectedWhere=q.ids?.length?`id=ANY(${source.bind(q.ids)}::uuid[])`:"true";
    const clauses=[businessWhere.replace(/^WHERE\s+/i,""),advancedWhere,selectedWhere].filter(part=>part&&part!=="true");
    const where=clauses.length?`WHERE ${clauses.map(part=>`(${part})`).join(" AND ")}`:"";
    const orderColumn=sortable[q.sortField]??"order_number",direction=q.sortOrder==="desc"?"DESC":"ASC";
    const limit=source.bind(q.pageSize),offset=source.bind((q.page-1)*q.pageSize);
    const sql=`WITH ${source.ctes}, filtered AS MATERIALIZED (SELECT * FROM fact_rows ${where}),
      diagnostic AS (SELECT count(*) FILTER(WHERE base_plan_count IS NULL)::int base_unlinked,
        count(*) FILTER(WHERE unfinished_base_count>0 AND review_due_date IS NULL)::int base_due_date_missing,
        count(*) FILTER(WHERE inbound_source_count>0 AND inbound_verified IS DISTINCT FROM true)::int inbound_unverified FROM filtered),
      rows AS (SELECT id::text id,customer_code "customerCode",order_number "orderNumber",item_code "itemCode",item_name "itemName",
        CASE WHEN order_date_count>1 THEN '多日期' ELSE order_date::text END "orderDate",CASE WHEN shipping_date_count>1 THEN '多日期' ELSE expected_shipping_date::text END "expectedShippingDate",
        array_to_string(order_date_values,', ') "orderDateTooltip",array_to_string(shipping_date_values,', ') "shippingDateTooltip",
        order_quantity::text "orderQuantity",review_due_date::text "reviewDueDate",
        review_due_tooltip "reviewDueTooltip",welding_quantity::text "weldingQuantity",blank_quantity::text "blankQuantity",
        surface_treatment_quantity::text "surfaceTreatmentQuantity",packaging_quantity::text "packagingQuantity",
        CASE WHEN inbound_source_count=0 THEN '0' WHEN inbound_verified THEN COALESCE(inbound_quantity,0)::text ELSE NULL END "inboundQuantity",
        (inbound_source_count=0 OR inbound_verified) "inboundVerified",
        (order_quantity>0 AND COALESCE(welding_quantity,0)>=order_quantity) "weldingComplete",(order_quantity>0 AND COALESCE(blank_quantity,0)>=order_quantity) "blankComplete",
        (order_quantity>0 AND COALESCE(surface_treatment_quantity,0)>=order_quantity) "surfaceTreatmentComplete",(order_quantity>0 AND COALESCE(packaging_quantity,0)>=order_quantity) "packagingComplete",
        CASE WHEN inbound_source_count=0 OR inbound_verified THEN order_quantity>0 AND COALESCE(inbound_quantity,0)>=order_quantity ELSE NULL END "inboundComplete"
        FROM filtered ORDER BY ${orderColumn} ${direction} NULLS LAST,order_number,item_code,id LIMIT ${limit} OFFSET ${offset})
      SELECT (SELECT count(*)::int FROM filtered) total,COALESCE((SELECT jsonb_agg(to_jsonb(rows)) FROM rows),'[]'::jsonb) rows,
        (SELECT base_unlinked FROM diagnostic) base_unlinked,(SELECT base_due_date_missing FROM diagnostic) base_due_date_missing,(SELECT inbound_unverified FROM diagnostic) inbound_unverified`;
    const data=await this.db.transaction("REPEATABLE READ",async manager=>{
      await manager.query("SET TRANSACTION READ ONLY");
      await manager.query("SELECT set_config('app.tenant_id',$1,true),set_config('TimeZone','Asia/Shanghai',true),set_config('statement_timeout','20000',true),set_config('jit','off',true)",[actor.tenantId]);
      const [org]=await manager.query("SELECT id FROM organization_units WHERE id=$1::uuid AND name=$2 AND enabled=true",[config.divisionId,config.label]);
      if(!org)throw new ServiceUnavailableException("事业部组织身份未通过核验，报表暂不可用");
      return (await manager.query(sql,params))[0];
    });
    const rows=data.rows as Array<Record<string,unknown>>;
    const bom=await this.bom.resolveBomStatuses(rows.map(row=>String(row.itemCode)),actor.tenantId);
    const resultRows=rows.map(row=>{
      const status=bom.statuses.get(String(row.itemCode))??"NO_BOM";
      const drawing=status==="HAS_BOM"?"Y":"N";
      const val=(key:string)=>row[key]==null?null:String(row[key]);
      return {id:String(row.id),customerCode:val("customerCode"),orderNumber:val("orderNumber"),itemCode:val("itemCode"),itemName:val("itemName"),
        orderDate:val("orderDate"),expectedShippingDate:val("expectedShippingDate"),orderDateTooltip:val("orderDateTooltip"),shippingDateTooltip:val("shippingDateTooltip"),orderQuantity:val("orderQuantity"),reviewDueDate:val("reviewDueDate"),
        drawing,materialReady:"N",cutting:"N",weldingQuantity:val("weldingQuantity")??"0",blankQuantity:val("blankQuantity")??"0",
        surfaceTreatmentQuantity:val("surfaceTreatmentQuantity")??"0",packagingQuantity:val("packagingQuantity")??"0",inboundQuantity:val("inboundQuantity"),
        bomStatus:status,materialReadyHint:"齐套数据源暂未接入",cuttingHint:"下料状态数据源暂未接入",inboundVerified:Boolean(row.inboundVerified),
        reviewDueTooltip:val("reviewDueTooltip"),weldingComplete:Boolean(row.weldingComplete),blankComplete:Boolean(row.blankComplete),
        surfaceTreatmentComplete:Boolean(row.surfaceTreatmentComplete),packagingComplete:Boolean(row.packagingComplete),
        inboundComplete:row.inboundComplete==null?null:Boolean(row.inboundComplete)} as MpsDivisionOrderProgressRow;
    });
    const processUnlinked=await this.unlinkedProcessCount(actor,config.divisionId);
    return {rows:resultRows,total:Number(data.total),page:q.page,pageSize:q.pageSize,diagnostics:{basePlanUnlinked:Number(data.base_unlinked),baseDueDateMissing:Number(data.base_due_date_missing),processUnlinked,inboundUnverified:Number(data.inbound_unverified)}};
  }

  private async unlinkedProcessCount(actor:MasterPlanActor,divisionId:string) {
    return this.db.transaction(async manager=>{
      await manager.query("SET TRANSACTION READ ONLY");await manager.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      const [row]=await manager.query(`SELECT count(DISTINCT r.id)::int count FROM mps_process_reports r
        JOIN mps_weekly_plans w ON w.tenant_id=r.tenant_id AND w.id=r.weekly_plan_id AND w.division_id=r.division_id
        JOIN mps_base_plans b ON b.tenant_id=w.tenant_id AND b.id=w.base_plan_id AND b.division_id=w.division_id
        WHERE r.tenant_id=$1 AND r.division_id=$2::uuid AND r.process_code=ANY(ARRAY['welding','blank','surfaceTreatment','packaging']::varchar[])
          AND NOT EXISTS(SELECT 1 FROM mps_order_allocations a WHERE a.tenant_id=r.tenant_id AND a.order_number=r.order_number AND a.item_code=r.item_code
            AND a.division_id=r.division_id AND a.archived_at IS NULL AND a.order_status='已审核')`,[actor.tenantId,divisionId]);
      return Number(row.count);
    });
  }
}
