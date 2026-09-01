import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import Decimal from "decimal.js";
import ExcelJS from "exceljs";
import { v7 as uuidv7 } from "uuid";
import { DataSource, EntityManager } from "typeorm";
import type { SyncActor } from "./order-sync.types";

const tenant = () => process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN";
const RULE_VERSION = "erp-order-duplicate-v1";
const normalize = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^0-9A-Z\u4e00-\u9fff]/g, "");
const closeDate = (left?: string | null, right?: string | null) => {
  if (!left || !right) return false;
  return Math.abs(new Date(left).getTime() - new Date(right).getTime()) <= 7 * 86400000;
};
type Raw = Record<string, any>;

@Injectable()
export class OrderReviewService {
  constructor(private readonly dataSource: DataSource) {}
  private async scope(manager: EntityManager) { await manager.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenant()]); }

  async list(level?: string, status?: string, page = 1, pageSize = 50) {
    if (![20,50,100,200].includes(pageSize)) throw new BadRequestException("pageSize仅支持20/50/100/200");
    return this.dataSource.transaction(async (manager) => {
      await this.scope(manager); const values: unknown[] = [tenant()]; const filters = ["tenant_id=$1"];
      if (level) { values.push(level); filters.push(`duplicate_level=$${values.length}`); }
      if (status) { values.push(status); filters.push(`business_confirmation_status=$${values.length}`); }
      const where = filters.join(" AND ");
      const [{ count }] = await manager.query(`SELECT count(*)::integer count FROM duplicate_order_reviews WHERE ${where}`, values);
      values.push(pageSize, Math.max(0,(page-1)*pageSize));
      const rows = await manager.query(`SELECT id,duplicate_level "duplicateLevel",suggested_action "suggestedAction",e10_order_number "e10OrderNumber",
        tplus_order_number "tplusOrderNumber",source_account_name "sourceAccountName",customer_summary "customerSummary",
        e10_item_quantity_summary "e10ItemQuantitySummary",tplus_item_quantity_summary "tplusItemQuantitySummary",
        total_quantity_consistent "totalQuantityConsistent",delivery_date_consistent "deliveryDateConsistent",matching_rule "matchingRule",
        matching_reason "matchingReason",system_suggestion "systemSuggestion",business_confirmation_status "businessConfirmationStatus",
        business_confirmed_by "businessConfirmedBy",business_confirmed_at "businessConfirmedAt",business_remark "businessRemark",
        rule_version "ruleVersion",version,created_at "createdAt",updated_at "updatedAt"
        FROM duplicate_order_reviews WHERE ${where} ORDER BY
        CASE duplicate_level WHEN 'HIGH_CONFIDENCE_DUPLICATE' THEN 1 WHEN 'NEEDS_REVIEW' THEN 2 WHEN 'SAME_NUMBER_CONFLICT' THEN 3 ELSE 4 END,
        updated_at DESC LIMIT $${values.length-1} OFFSET $${values.length}`, values);
      return { rows, total: count, page, pageSize };
    });
  }

  async confirm(id: string, input: { expectedVersion: number; status: string; remark?: string | null }, actor: SyncActor) {
    if (!Number.isInteger(input.expectedVersion) || !["PENDING","CONFIRMED_DUPLICATE","CONFIRMED_SEPARATE"].includes(input.status)) throw new BadRequestException("复核状态或版本无效");
    return this.dataSource.transaction(async (manager) => {
      await this.scope(manager);
      const [before] = await manager.query(`SELECT * FROM duplicate_order_reviews WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenant(), id]);
      if (!before) throw new NotFoundException("重复订单复核记录不存在");
      if (before.version !== input.expectedVersion) throw new BadRequestException("记录已被他人更新，请刷新后重试");
      const [after] = await manager.query(`UPDATE duplicate_order_reviews SET business_confirmation_status=$3,business_confirmed_by=$4,
        business_confirmed_at=CASE WHEN $3='PENDING' THEN NULL ELSE now() END,business_remark=$5,updated_by=$6,updated_at=now(),version=version+1
        WHERE tenant_id=$1 AND id=$2 RETURNING *`, [tenant(),id,input.status,actor.userId,input.remark ?? null,actor.displayName]);
      await manager.query(`INSERT INTO audit_logs(actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1::uuid,$2,'duplicate-order-review',$3,'review.confirmed',$4::jsonb,$5::jsonb,$6,$7,$1::uuid,$1::text)`,
        [actor.userId,actor.displayName,id,JSON.stringify(before),JSON.stringify(after),actor.requestId,actor.source.toLowerCase()]);
      return after;
    });
  }

  async rebuild(actor: SyncActor) {
    return this.dataSource.transaction(async (manager) => {
      await this.scope(manager);
      const rows: Raw[] = await manager.query(`SELECT id,source_system,source_database,source_table,source_id,source_order_id,source_order_line_id,
        order_number,business_date,customer_code,customer_name,item_code,quantity,delivery_date
        FROM erp_staging_raw_records WHERE tenant_id=$1 AND record_type IN ('ORDER_HEADER','ORDER_LINE') ORDER BY source_system,source_database,source_order_id`, [tenant()]);
      const headers = rows.filter(row => row.source_order_line_id == null);
      const lines = rows.filter(row => row.source_order_line_id != null);
      const byOrder = new Map<string,Raw[]>();
      for (const row of lines) { const key=`${row.source_system}\0${row.source_database}\0${row.source_order_id}`; byOrder.set(key,[...(byOrder.get(key) ?? []),row]); }

      const existing: Raw[] = await manager.query(`SELECT business_order_id,source_system,source_database,source_table,source_order_id FROM business_order_sources
        WHERE tenant_id=$1 AND source_order_line_id IS NULL`, [tenant()]);
      const businessIds = new Map(existing.map(row => [`${row.source_system}\0${row.source_database}\0${row.source_table}\0${row.source_order_id}`,row.business_order_id]));
      const missingOrders:Raw[]=[];
      for (const header of headers) {
        const origin=`${header.source_system}\0${header.source_database}\0${header.source_table}\0${header.source_order_id}`;
        if (!businessIds.has(origin)) {
          const id=uuidv7(); businessIds.set(origin,id);
          missingOrders.push({businessOrderId:id,...header});
        }
      }
      for(let offset=0;offset<missingOrders.length;offset+=1000){ const chunk=missingOrders.slice(offset,offset+1000);
        await manager.query(`INSERT INTO business_orders(id,tenant_id,rule_version,created_by,updated_by)
          SELECT x."businessOrderId",$2,$3,$4,$5 FROM jsonb_to_recordset($1::jsonb) x("businessOrderId" uuid)`,[JSON.stringify(chunk),tenant(),RULE_VERSION,actor.userId,actor.displayName]);
        await manager.query(`INSERT INTO business_order_sources(tenant_id,business_order_id,source_system,source_database,source_table,source_order_id,source_order_number,
          source_order_line_id,rule_version,created_by,updated_by) SELECT $2,x."businessOrderId",x.source_system,x.source_database,x.source_table,x.source_order_id,x.order_number,
          NULL,$3,$4,$5 FROM jsonb_to_recordset($1::jsonb) x("businessOrderId" uuid,source_system varchar,source_database varchar,source_table varchar,source_order_id varchar,order_number varchar)
          ON CONFLICT DO NOTHING`,[JSON.stringify(chunk),tenant(),RULE_VERSION,actor.userId,actor.displayName]);
      }
      const headerByOrder=new Map(headers.map(header=>[`${header.source_system}\0${header.source_database}\0${header.source_order_id}`,header]));
      const lineSources=lines.flatMap(line=>{const header=headerByOrder.get(`${line.source_system}\0${line.source_database}\0${line.source_order_id}`);if(!header)return [];
        return [{businessOrderId:businessIds.get(`${header.source_system}\0${header.source_database}\0${header.source_table}\0${header.source_order_id}`),...line}];});
      for(let offset=0;offset<lineSources.length;offset+=1000){const chunk=lineSources.slice(offset,offset+1000);await manager.query(`INSERT INTO business_order_sources(
        tenant_id,business_order_id,source_system,source_database,source_table,source_order_id,source_order_number,source_order_line_id,rule_version,created_by,updated_by)
        SELECT $2,x."businessOrderId",x.source_system,x.source_database,x.source_table,x.source_order_id,x.order_number,x.source_order_line_id,$3,$4,$5
        FROM jsonb_to_recordset($1::jsonb) x("businessOrderId" uuid,source_system varchar,source_database varchar,source_table varchar,source_order_id varchar,order_number varchar,source_order_line_id varchar)
        ON CONFLICT DO NOTHING`,[JSON.stringify(chunk),tenant(),RULE_VERSION,actor.userId,actor.displayName]);}

      const itemCache=new Map<string,Map<string,Decimal>>();
      const itemMap = (header: Raw) => {const orderKey=`${header.source_system}\0${header.source_database}\0${header.source_order_id}`;const cached=itemCache.get(orderKey);if(cached)return cached;
        const items=new Map<string,Decimal>();for(const line of byOrder.get(orderKey)??[]){const code=normalize(line.item_code);items.set(code,(items.get(code)??new Decimal(0)).plus(line.quantity??0));}itemCache.set(orderKey,items);return items;};
      const summarize = (items: Map<string,Decimal>) => [...items].sort().map(([code,qty]) => `${code}:${qty.toString()}`).join("；");
      const total = (items: Map<string,Decimal>) => [...items.values()].reduce((sum,value)=>sum.plus(value),new Decimal(0));
      const candidates: Raw[]=[];
      const substrings=new Map<string,number[]>();
      headers.forEach((header,index)=>{const order=normalize(header.order_number);const seen=new Set<string>();for(let start=0;start<=order.length-5;start++)for(let length=5;length<=order.length-start;length++)seen.add(order.slice(start,start+length));for(const part of seen)substrings.set(part,[...(substrings.get(part)??[]),index]);});
      const candidatePairs=new Set<string>();headers.forEach((header,leftIndex)=>{const order=normalize(header.order_number);for(const rightIndex of substrings.get(order)??[]){if(leftIndex===rightIndex)continue;candidatePairs.add(leftIndex<rightIndex?`${leftIndex}:${rightIndex}`:`${rightIndex}:${leftIndex}`);}});
      for (const pair of candidatePairs) {
        const [leftIndex,rightIndex]=pair.split(":").map(Number);
        const left=headers[leftIndex]!,right=headers[rightIndex]!;
        if (left.source_system===right.source_system && left.source_database===right.source_database) continue;
        const ln=normalize(left.order_number),rn=normalize(right.order_number); if (!ln || !rn) continue;
        const exact=ln===rn; const related=exact || (Math.min(ln.length,rn.length)>=5 && (ln.includes(rn)||rn.includes(ln))); if (!related) continue;
        const leftItems=itemMap(left),rightItems=itemMap(right); const sameItems=leftItems.size===rightItems.size && [...leftItems].every(([key,value])=>rightItems.get(key)?.eq(value));
        const sameTotal=total(leftItems).eq(total(rightItems)); const sameCustomer=Boolean(normalize(left.customer_code||left.customer_name)) && normalize(left.customer_code||left.customer_name)===normalize(right.customer_code||right.customer_name);
        const leftDates=[...(byOrder.get(`${left.source_system}\0${left.source_database}\0${left.source_order_id}`)??[])].map(row=>row.delivery_date).filter(Boolean);
        const rightDates=[...(byOrder.get(`${right.source_system}\0${right.source_database}\0${right.source_order_id}`)??[])].map(row=>row.delivery_date).filter(Boolean);
        const dueClose=leftDates.some(value=>rightDates.some(other=>closeDate(value,other))); const score=[sameCustomer,sameItems,sameTotal,dueClose,!exact].filter(Boolean).length;
        const level=exact && !sameItems && !sameTotal ? "SAME_NUMBER_CONFLICT" : score>=2 ? "HIGH_CONFIDENCE_DUPLICATE" : "NEEDS_REVIEW";
        const e10=left.source_system==="E10"?left:right.source_system==="E10"?right:left; const tplus=e10===left?right:left;
        candidates.push({leftId:left.id,rightId:right.id,level,e10Order:e10.order_number,tplusOrder:tplus.order_number,accounts:`${left.source_database} / ${right.source_database}`,
          customer:`${left.customer_name??left.customer_code??""} / ${right.customer_name??right.customer_code??""}`,e10Summary:summarize(itemMap(e10)),tplusSummary:summarize(itemMap(tplus)),sameTotal,dueClose,
          reason:`订单号${exact?"规范化相同":"存在已识别包含关系"}；客户${sameCustomer?"一致":"不一致/未映射"}；品项数量${sameItems?"一致":"存在差异"}；总数量${sameTotal?"一致":"不一致"}；交期${dueClose?"接近":"不一致或缺失"}`});
      }
      for (const row of candidates) {
        const suggestion=row.level==="HIGH_CONFIDENCE_DUPLICATE"?"建议不要重复录入，请引用已有订单。":"请业务确认，不允许系统自动合并。";
        await manager.query(`INSERT INTO duplicate_order_reviews(tenant_id,left_source_record_id,right_source_record_id,duplicate_level,suggested_action,e10_order_number,
          tplus_order_number,source_account_name,customer_summary,e10_item_quantity_summary,tplus_item_quantity_summary,total_quantity_consistent,delivery_date_consistent,
          matching_rule,matching_reason,system_suggestion,rule_version,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$5,$16,$17,$18)
          ON CONFLICT(tenant_id,left_source_record_id,right_source_record_id,rule_version) DO UPDATE SET duplicate_level=EXCLUDED.duplicate_level,suggested_action=EXCLUDED.suggested_action,
          customer_summary=EXCLUDED.customer_summary,e10_item_quantity_summary=EXCLUDED.e10_item_quantity_summary,tplus_item_quantity_summary=EXCLUDED.tplus_item_quantity_summary,
          total_quantity_consistent=EXCLUDED.total_quantity_consistent,delivery_date_consistent=EXCLUDED.delivery_date_consistent,matching_reason=EXCLUDED.matching_reason,
          system_suggestion=EXCLUDED.system_suggestion,updated_by=EXCLUDED.updated_by,updated_at=now(),version=duplicate_order_reviews.version+1`,
          [tenant(),row.leftId,row.rightId,row.level,suggestion,row.e10Order,row.tplusOrder,row.accounts,row.customer,row.e10Summary,row.tplusSummary,row.sameTotal,row.dueClose,
            "NORMALIZED_ORDER_RELATION+CUSTOMER+ITEM_QUANTITY+DUE_DATE",row.reason,RULE_VERSION,actor.userId,actor.displayName]);
      }
      const counts=Object.fromEntries(["HIGH_CONFIDENCE_DUPLICATE","NEEDS_REVIEW","SAME_NUMBER_CONFLICT"].map(level=>[level,candidates.filter(row=>row.level===level).length]));
      await manager.query(`INSERT INTO audit_logs(actor_id,actor_name,resource,action,after_json,request_id,source,created_by,updated_by)
        VALUES($1::uuid,$2,'duplicate-order-review','candidates.rebuilt',$3::jsonb,$4,$5,$1::uuid,$1::text)`,[actor.userId,actor.displayName,JSON.stringify(counts),actor.requestId,actor.source.toLowerCase()]);
      return { ruleVersion:RULE_VERSION,total:candidates.length,counts };
    });
  }

  async workbook() {
    const result=await this.list(undefined,undefined,1,200); const all=[...result.rows];
    for (let page=2;all.length<result.total;page++) all.push(...(await this.list(undefined,undefined,page,200)).rows);
    const workbook=new ExcelJS.Workbook(); const sheet=workbook.addWorksheet("重复订单业务复核",{views:[{state:"frozen",ySplit:1}]});
    const fields: Array<[string,string]>=[["duplicateLevel","重复等级"],["suggestedAction","建议动作"],["e10OrderNumber","E10订单号"],["tplusOrderNumber","T+订单号"],["sourceAccountName","来源账套"],["customerSummary","客户"],["e10ItemQuantitySummary","E10品项及数量摘要"],["tplusItemQuantitySummary","T+品项及数量摘要"],["totalQuantityConsistent","总数量是否一致"],["deliveryDateConsistent","交期是否一致"],["matchingRule","匹配规则"],["matchingReason","匹配理由"],["systemSuggestion","系统建议"],["businessConfirmationStatus","业务确认状态"],["businessConfirmedBy","业务确认人"],["businessConfirmedAt","业务确认日期"],["businessRemark","备注"]];
    sheet.addRow(fields.map(([,label])=>label)); for (const row of all) sheet.addRow(fields.map(([key])=>row[key]??null)); sheet.autoFilter={from:"A1",to:"Q1"}; sheet.getRow(1).font={bold:true};
    fields.forEach((_,index)=>sheet.getColumn(index+1).width=[24,28,20,20,34,30,44,44,16,14,36,60,34,20,18,22,34][index]!);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async qualityReport() {
    return this.dataSource.transaction(async manager=>{ await this.scope(manager);
      const counts=await manager.query(`SELECT source_system "sourceSystem",source_database "sourceDatabase",record_type "recordType",count(*)::integer count FROM erp_staging_raw_records WHERE tenant_id=$1 GROUP BY 1,2,3 ORDER BY 1,2,3`,[tenant()]);
      const [e10Outbound]=await manager.query(`SELECT count(*)::integer total_count,COALESCE(sum(quantity),0)::text total_quantity,
        count(*) FILTER(WHERE order_link_stable)::integer linked_count,COALESCE(sum(quantity) FILTER(WHERE order_link_stable),0)::text linked_quantity,
        count(*) FILTER(WHERE NOT COALESCE(order_link_stable,false))::integer unlinked_count,COALESCE(sum(quantity) FILTER(WHERE NOT COALESCE(order_link_stable,false)),0)::text unlinked_quantity
        FROM erp_staging_raw_records WHERE tenant_id=$1 AND source_system='E10' AND record_type='OUTBOUND_LINE'`,[tenant()]);
      const unlinkedSamples=await manager.query(`SELECT source_id "sourceId",order_number "orderNumber",item_code "itemCode",quantity,modified_at "modifiedAt",link_rule "linkRule" FROM erp_staging_raw_records WHERE tenant_id=$1 AND source_system='E10' AND record_type='OUTBOUND_LINE' AND NOT COALESCE(order_link_stable,false) ORDER BY modified_at DESC NULLS LAST LIMIT 100`,[tenant()]);
      const statuses=await manager.query(`SELECT source_system "sourceSystem",source_database "sourceDatabase",status_code "statusCode",count(*)::integer count FROM erp_staging_raw_records WHERE tenant_id=$1 AND record_type='ORDER_HEADER' GROUP BY 1,2,3 ORDER BY 1,2,3`,[tenant()]);
      const orderLineMissing=await manager.query(`SELECT h.source_system "sourceSystem",h.source_database "sourceDatabase",count(*)::integer "missingOrderCount"
        FROM erp_staging_raw_records h WHERE h.tenant_id=$1 AND h.record_type='ORDER_HEADER' AND NOT EXISTS (
          SELECT 1 FROM erp_staging_raw_records l WHERE l.tenant_id=h.tenant_id AND l.source_system=h.source_system
          AND l.source_database=h.source_database AND l.record_type='ORDER_LINE' AND l.source_order_id=h.source_order_id)
        GROUP BY h.source_system,h.source_database ORDER BY h.source_system,h.source_database`,[tenant()]);
      const deliveryPlanDuplicates=await manager.query(`SELECT source_system "sourceSystem",source_database "sourceDatabase",count(*)::integer "duplicateGroupCount",
        COALESCE(sum(group_count-1),0)::integer "extraRecordCount" FROM (
          SELECT source_system,source_database,source_order_line_id,delivery_date,quantity,count(*) group_count
          FROM erp_staging_raw_records WHERE tenant_id=$1 AND record_type='DELIVERY_PLAN'
          GROUP BY source_system,source_database,source_order_line_id,delivery_date,quantity HAVING count(*)>1
        ) duplicates GROUP BY source_system,source_database ORDER BY source_system,source_database`,[tenant()]);
      const duplicates=await manager.query(`SELECT duplicate_level "duplicateLevel",count(*)::integer count FROM duplicate_order_reviews WHERE tenant_id=$1 GROUP BY 1`,[tenant()]);
      return {counts,orderLineMissing,deliveryPlanDuplicates,e10Outbound:{...e10Outbound,unlinkedRatio:e10Outbound?.total_count?Number(e10Outbound.unlinked_count)/Number(e10Outbound.total_count):0,linkRule:"E10订单交付计划直接关联，或销售交货明细回溯订单"},unlinkedSamples,statusDictionaryUnconfirmed:statuses,duplicates};
    });
  }
}
