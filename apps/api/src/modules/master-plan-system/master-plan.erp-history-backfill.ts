import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { DataSource } from "typeorm";
import { reconcileMonthlyBasePlans } from "./master-plan.monthly-base";
import { monthlyInboundCandidatesSql, monthlyInboundParams, MONTHLY_INBOUND_DIVISION_ID } from "./master-plan.monthly-inbound";
import type { MasterPlanActor } from "./master-plan.types";

type Row = Record<string, any>;
export interface ErpHistoryScope { divisionId: string; sources: Array<{ id: string; version: number }>; requestId: string }

/** Explicit operator command only: no route, scheduler, ERP→allocation policy or live
 * admission change. Source IDs/versions freeze the reviewed tenant/division/missing-week scope.
 * Existing monthly records stay unchanged; bases use the shared manual-protection merge.
 * Order-level derived totals include newly added items. */
export class MasterPlanErpHistoryBackfill {
  constructor(private readonly db: DataSource) {}
  async apply(scope: ErpHistoryScope, actor: MasterPlanActor) {
    if (!actor.isSystemAdmin || !actor.userId || !actor.tenantId) throw new ForbiddenException("历史补齐仅限已认证系统管理员");
    if (!scope.requestId || scope.sources.length < 1 || scope.sources.length > 5000 || new Set(scope.sources.map(s=>s.id)).size !== scope.sources.length)
      throw new BadRequestException("必须提供去重的已审阅来源ID、版本及幂等键");
    if(scope.divisionId!==MONTHLY_INBOUND_DIVISION_ID)throw new BadRequestException("本次历史补齐仅适用于事业四部");
    const requestHash=createHash("sha256").update(JSON.stringify(scope)).digest("hex");
    return this.db.transaction("REPEATABLE READ", async m => {
      const tenant=actor.tenantId, who=actor.userId!;
      await m.query("SELECT set_config('app.tenant_id',$1,true),set_config('TimeZone','Asia/Shanghai',true),set_config('jit','off',true)",[tenant]);
      const [grant]=await m.query("SELECT system_admin FROM administrator_grants WHERE tenant_id=$1 AND user_id=$2::uuid",[tenant,who]);
      if (!grant?.system_admin) throw new ForbiddenException("管理员授权已变化");
      await m.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${tenant}:mps-allocation-projection`]);
      await m.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${tenant}:mps-existing-monthly-inbound`]);
      const key=`erp-history:${tenant}:${scope.requestId}`;
      const [prior]=await m.query("SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1",[key]);
      if(prior){if(prior.request_hash!==requestHash)throw new ConflictException("幂等键的补齐范围发生变化");return {...prior.response_json,repeated:true};}
      const sources: Row[]=await m.query(`SELECT e.*,e.order_date::text AS order_date,e.customer_due_date::text AS customer_due_date,
        e.preproduction_review_date::text AS preproduction_review_date FROM mps_erp_order_lines e
        WHERE e.tenant_id=$1 AND e.id=ANY($2::uuid[]) ORDER BY e.order_number,e.item_code,e.id FOR SHARE`,[tenant,scope.sources.map(s=>s.id)]);
      if(sources.length!==scope.sources.length || sources.some(e=>scope.sources.find(s=>s.id===e.id)?.version!==Number(e.version)))
        throw new ConflictException("ERP来源已变化，请重新预览");
      const [ownership]=await m.query(`SELECT count(*)::int valid FROM mps_erp_order_lines e
        JOIN mps_customer_division_mappings c ON c.tenant_id=e.tenant_id AND c.customer_code=e.customer_code AND c.enabled=true
        JOIN organization_units o ON o.id=c.primary_division_id AND o.enabled=true
        WHERE e.tenant_id=$1 AND e.id=ANY($2::uuid[]) AND c.primary_division_id=$3::uuid`,[tenant,scope.sources.map(s=>s.id),scope.divisionId]);
      if(Number(ownership.valid)!==sources.length)throw new ConflictException("事业部归属已变化，请重新预览");
      const audit=async(resource:string,before:Row|null,after:Row,detail:Row={})=>{
        await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
          VALUES($1,$2::uuid,$3,$4,$5,'historical.erp_backfilled',$6::jsonb,$7::jsonb,$8,'api',$2::uuid,$2::uuid)`,
        [tenant,who,actor.username,resource,after.id,before?JSON.stringify(before):null,JSON.stringify({...after,backfill:detail}),scope.requestId]);
      };
      const monthlyIds:string[]=[], createdMonthlyIds:string[]=[], orderNumbers=new Set<string>(), conflicts:Row[]=[];
      let monthlyCreated=0, anchorsCreated=0, retained=0, groupCreated=0, groupUpdated=0;
      const keys=new Map<string,Row[]>();
      for(const e of sources){const k=JSON.stringify([e.order_number,e.item_code]);keys.set(k,[...(keys.get(k)??[]),e]);}
      for(const rows of keys.values()){
        const e=rows[0]!;
        const [week]=await m.query("SELECT id FROM mps_weekly_plans WHERE tenant_id=$1 AND division_id=$2::uuid AND order_number=$3 AND item_code=$4 LIMIT 1",[tenant,scope.divisionId,e.order_number,e.item_code]);
        if(week){retained++;continue;}
        const monthly:Row[]=await m.query("SELECT * FROM mps_monthly_plans WHERE tenant_id=$1 AND order_number=$2 AND item_code=$3 ORDER BY id FOR UPDATE",[tenant,e.order_number,e.item_code]);
        if(monthly.length){
          if(monthly.length!==1||monthly[0]!.division_id!==scope.divisionId||monthly[0]!.customer_code!==e.customer_code){conflicts.push({order:e.order_number,item:e.item_code,reason:"已有月度归属冲突，保留"});continue;}
          monthlyIds.push(monthly[0]!.id);orderNumbers.add(e.order_number);retained++;continue;
        }
        if(rows.some(x=>!x.source_active||!x.customer_code||Number(x.order_quantity)<=0)||new Set(rows.map(x=>x.customer_code)).size!==1){conflicts.push({order:e.order_number,item:e.item_code,reason:"来源失效、客户或数量冲突"});continue;}
        const allocations:Row[]=await m.query(`SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND order_number=$2 AND item_code=$3
          AND division_id=$4::uuid AND customer_code=$5 ORDER BY created_at,id FOR SHARE`,[tenant,e.order_number,e.item_code,scope.divisionId,e.customer_code]);
        let parent=allocations[0];
        if(!parent){
          // Required stable FK only. Zero/archived/non-manual is never effective allocation demand.
          [parent]=await m.query(`INSERT INTO mps_order_allocations(tenant_id,order_number,item_code,item_name,customer_code,division_id,order_date,
            allocated_quantity,manually_maintained,archived_at,remark,created_by,updated_by)
            VALUES($1,$2,$3,$4,$5,$6::uuid,$7,0,false,now(),'历史ERP计划补齐引用，不参与有效订单分配',$8::uuid,$8::uuid) RETURNING *`,
          [tenant,e.order_number,e.item_code,e.item_name,e.customer_code,scope.divisionId,e.order_date,who]);
          anchorsCreated++;await audit("mps-order-allocations",null,parent!,{kind:"INACTIVE_HISTORICAL_REFERENCE",sourceIds:rows.map(x=>x.id)});
        }
        const [created]=await m.query(`INSERT INTO mps_monthly_plans(tenant_id,allocation_id,order_number,item_code,item_name,customer_code,division_id,
          order_date,customer_due_date,preproduction_review_date,latest_customer_due_date,required_quantity,pending_quantity,created_by,updated_by)
          SELECT $1::varchar,$2::uuid,$3::varchar,$4::varchar,$5::varchar,$6::varchar,$7::uuid,$8::date,$9::date,$10::date,$9::date,sum(order_quantity),sum(order_quantity),$12::uuid,$12::uuid
          FROM mps_erp_order_lines WHERE tenant_id=$1 AND id=ANY($11::uuid[]) RETURNING *`,
        [tenant,parent!.id,e.order_number,e.item_code,e.item_name,e.customer_code,scope.divisionId,e.order_date,e.customer_due_date,e.preproduction_review_date,rows.map(x=>x.id),who]);
        monthlyCreated++;createdMonthlyIds.push(created.id);monthlyIds.push(created.id);orderNumbers.add(e.order_number);await audit("mps-monthly-plans",null,created,{sourceIds:rows.map(x=>x.id)});
      }
      // Reuse verified incoming facts for newly inserted history only. No zeroing or
      // fact changes to existing plans, and no allocation-derived group recalculation.
      let inboundUpdated=0;
      if(createdMonthlyIds.length){
        const facts:Row[]=await m.query(`${monthlyInboundCandidatesSql} AND p.id=ANY($4::uuid[]) FOR UPDATE OF p`,[...monthlyInboundParams(tenant),createdMonthlyIds]);
        for(const fact of facts){
          const [before]=await m.query("SELECT * FROM mps_monthly_plans WHERE tenant_id=$1 AND id=$2::uuid",[tenant,fact.id]);
          const result=await m.query(`UPDATE mps_monthly_plans SET cumulative_inbound_quantity=$3::numeric,pending_quantity=$4::numeric,
            completion_rate=$5::numeric,version=version+1,updated_at=now(),updated_by=$6::uuid
            WHERE tenant_id=$1 AND id=$2::uuid AND version=$7 RETURNING *`,[tenant,fact.id,fact.after_inbound,fact.after_pending,fact.after_rate,who,fact.version]);
          const rows=Array.isArray(result[0])?result[0]:result;if(rows.length!==1)throw new ConflictException("历史入库事实发生并发变化");
          inboundUpdated++;await audit("mps-monthly-plans",before,rows[0],{kind:"VERIFIED_INBOUND"});
        }
      }
      for(const order of orderNumbers){
        const [totals]=await m.query(`SELECT sum(required_quantity) required,sum(least(cumulative_inbound_quantity,required_quantity)) completed,
          sum(greatest(required_quantity-cumulative_inbound_quantity,0)) pending,
          round(avg(CASE WHEN required_quantity<=0 THEN 0 ELSE least(greatest(cumulative_inbound_quantity,0)/required_quantity,1) END),4) rate
          FROM mps_monthly_plans WHERE tenant_id=$1 AND order_number=$2`,[tenant,order]);
        const [before]=await m.query("SELECT * FROM mps_group_plans WHERE tenant_id=$1 AND order_number=$2 FOR UPDATE",[tenant,order]);
        if(!before){
          const [g]=await m.query(`INSERT INTO mps_group_plans(tenant_id,order_number,customer_code,order_date,source_accounts,order_type,customer_due_date,
            preproduction_review_date,order_amount,primary_division_id,required_quantity,completed_quantity,pending_quantity,completion_rate,created_by,updated_by)
            SELECT $1::varchar,$2::varchar,min(customer_code),min(order_date),string_agg(DISTINCT coalesce(source_account_name,source_database),','),max(order_type),
            max(customer_due_date),max(preproduction_review_date),CASE WHEN count(tax_included_amount)=count(*) THEN sum(tax_included_amount) END,
            $3::uuid,$4::numeric,$5::numeric,$6::numeric,$7::numeric,$8::uuid,$8::uuid FROM mps_erp_order_lines
            WHERE tenant_id=$1 AND order_number=$2 HAVING count(DISTINCT customer_code)=1 RETURNING *`,[tenant,order,scope.divisionId,totals.required,totals.completed,totals.pending,totals.rate,who]);
          if(!g)throw new ConflictException("集团订单客户不唯一");groupCreated++;await audit("mps-group-plans",null,g);
        }else{
          const changed=await m.query(`UPDATE mps_group_plans SET required_quantity=$3,completed_quantity=$4,pending_quantity=$5,completion_rate=$6,
            version=version+1,updated_at=now(),updated_by=$7::uuid WHERE tenant_id=$1 AND id=$2::uuid AND
            (required_quantity,completed_quantity,pending_quantity,completion_rate) IS DISTINCT FROM ($3::numeric,$4::numeric,$5::numeric,$6::numeric) RETURNING *`,
          [tenant,before.id,totals.required,totals.completed,totals.pending,totals.rate,who]);
          const rows=Array.isArray(changed[0])?changed[0]:changed;if(rows.length){groupUpdated++;await audit("mps-group-plans",before,rows[0]);}
        }
      }
      const bases=await reconcileMonthlyBasePlans(m,tenant,who,actor.username,monthlyIds);
      const response={monthlyCreated,anchorsCreated,inboundUpdated,retained,groupCreated,groupUpdated,bases,monthlyIds,conflicts};
      await m.query("INSERT INTO idempotency_keys(key,request_hash,response_json,created_by,updated_by) VALUES($1,$2,$3::jsonb,$4::uuid,$4::uuid)",[key,requestHash,JSON.stringify(response),who]);
      return response;
    });
  }
}
