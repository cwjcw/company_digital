import { demandLinksReady, linkExistingDemandRecord, linkNewDemandRecord } from "./master-plan.demand-links";
import { assertMpsLifecycleSyncReady } from "./master-plan.lifecycle.service";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import type { EntityManager } from "typeorm";
import { fieldsFor, MASTER_PLAN_RESOURCE_MAP } from "./master-plan.config";
import { nextMasterPlanDeliveryCode } from "./master-plan.delivery-code";

type Row = Record<string, any>;
const columns = ["division_id", "customer_code", "item_name", "order_date", "planned_quantity", "latest_customer_due_date",
  "model_age", "image_refs", "product_attribute", "surface_nature", "manufacturing_method"] as const;
const dictionaries = { model_age: "modelAge", product_attribute: "productAttribute", surface_nature: "surfaceNature", manufacturing_method: "manufacturingMethod" };
const day = (value: any) => value == null || value === "" ? null : value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}` : String(value).slice(0, 10);
const comparable = (key: string, value: any): string => {
  if (value == null || value === "") return "null";
  if (key === "planned_quantity") return new Decimal(String(value)).toFixed(4);
  if (key.endsWith("_date")) return String(day(value));
  return JSON.stringify(value, (_key, next) => next && typeof next === "object" && !Array.isArray(next) ? Object.fromEntries(Object.keys(next).sort().map(key => [key,next[key]])) : next);
};

export function monthlyBaseValues(monthly: Row): Row {
  const values: Row = { division_id: monthly.division_id, customer_code: monthly.customer_code, item_name: monthly.item_name,
    order_date: day(monthly.order_date), planned_quantity: new Decimal(String(monthly.required_quantity)).toFixed(4),
    latest_customer_due_date: day(monthly.latest_customer_due_date), image_refs: monthly.image_refs ?? [] };
  const fields = fieldsFor(MASTER_PLAN_RESOURCE_MAP.get("mps-base-plans")!);
  for (const [column, field] of Object.entries(dictionaries)) {
    const raw = monthly[column];
    const allowed = fields.find(entry => entry.key === field)?.options ?? [];
    if (raw == null || String(raw).trim() === "") values[column] = null;
    else if (allowed.some(option => option.value === raw)) values[column] = raw;
  }
  // Review due dates and planned completion dates remain human-maintained; no date substitution.
  return values;
}

/** Three-way merge using existing audit snapshots, without adding business/source columns.
 * A legacy nonempty value is preserved when its automatic ownership cannot be proved. */
export function monthlyBasePatch(current: Row, desired: Row, previous?: Row): Row {
  const patch: Row = {};
  for (const key of columns) {
    if (!Object.hasOwn(desired, key)) continue;
    const equal = comparable(key, current[key]) === comparable(key, desired[key]);
    const owned = previous && Object.hasOwn(previous, key)
      ? comparable(key, current[key]) === comparable(key, previous[key])
      : current[key] == null || current[key] === "" || (key === "image_refs" && JSON.stringify(current[key]) === "[]");
    if (!equal && owned) patch[key] = desired[key];
  }
  return patch;
}

/** Schema readiness is checked once per run. Keep parent and legacy identity
 * predicates indexable; serializing every base row for every monthly row turns
 * a tenant-wide run into repeated full scans. */
export function monthlyBaseLookupSql(linksReady: boolean) {
  return `SELECT *,order_date::text AS order_date,latest_customer_due_date::text AS latest_customer_due_date
    FROM mps_base_plans WHERE tenant_id=$1 AND (${linksReady ? 'monthly_plan_id=$4::uuid OR ' : ''}(order_number=$2 AND item_code=$3)) ORDER BY id FOR UPDATE`;
}

export async function reconcileMonthlyBasePlans(manager: EntityManager, tenantId: string, actorId: string, actorName: string, monthlyPlanIds?: string[], includeZeroQuantityIds: string[] = [], enqueueBaseToWeekly = true, trustedInternalService = false, expectedVersions?:Map<string,number>) {
  await manager.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
  await assertMpsLifecycleSyncReady(manager,tenantId,['mps-monthly-plans', 'mps-base-plans', 'mps-weekly-plans']);
  await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${tenantId}:mps-monthly-base`]);
  const monthly: Row[] = await manager.query(`SELECT m.*,EXISTS(SELECT 1 FROM mps_order_allocations source WHERE source.tenant_id=m.tenant_id AND source.id=m.allocation_id
      AND source.archived_at IS NULL AND source.order_status='已审核' AND source.manually_maintained
      AND (source.monthly_plan_id IS NULL OR source.monthly_plan_id=m.id)
      AND (source.order_number,source.item_code,source.division_id,source.customer_code) IS NOT DISTINCT FROM (m.order_number,m.item_code,m.division_id,m.customer_code)) source_confirmed,m.order_date::text AS order_date,m.latest_customer_due_date::text AS latest_customer_due_date FROM mps_monthly_plans m
    JOIN organization_units o ON o.id=m.division_id AND o.enabled=true
    WHERE m.tenant_id=$1 AND ($2::uuid[] IS NULL OR m.id=ANY($2::uuid[])) AND btrim(m.order_number)<>'' AND btrim(m.item_code)<>''
      AND (m.required_quantity>0 OR (m.required_quantity=0 AND m.id=ANY($3::uuid[])))
    ORDER BY m.id FOR SHARE OF m`, [tenantId,monthlyPlanIds ?? null,includeZeroQuantityIds]);
  if(expectedVersions){
    if(!monthlyPlanIds||expectedVersions.size!==monthlyPlanIds.length||monthly.length!==monthlyPlanIds.length||monthly.some(plan=>Number(plan.version)!==expectedVersions.get(String(plan.id))))
      throw new Error('定向恢复月度计划集合或版本已变化，未执行基础计划同步');
    const sources:Row[]=await manager.query(`SELECT m.id FROM mps_monthly_plans m
      JOIN organization_units o ON o.id=m.division_id AND o.enabled=true
      JOIN mps_order_allocations a ON a.tenant_id=m.tenant_id AND a.id=m.allocation_id
      WHERE m.tenant_id=$1 AND m.id=ANY($2::uuid[]) AND m.required_quantity>0
        AND a.archived_at IS NULL AND a.order_status='已审核' AND a.manually_maintained=true
        AND (a.order_number,a.item_code,a.division_id) IS NOT DISTINCT FROM (m.order_number,m.item_code,m.division_id)
      ORDER BY m.id FOR SHARE OF m,a`,[tenantId,monthlyPlanIds]);
    if(sources.length!==monthlyPlanIds.length)throw new Error('定向恢复需求来源已归档、失效或身份不一致');
    const conflicts:Row[]=await manager.query(`SELECT b.id, b.monthly_plan_id, b.order_number,b.item_code,b.division_id,b.customer_code,
      m.order_number monthly_order,m.item_code monthly_item,m.division_id monthly_division,m.customer_code monthly_customer,
      COALESCE(mps_weekly_has_execution(w.tenant_id,w.id),false) has_execution
      FROM mps_base_plans b JOIN mps_monthly_plans m ON m.tenant_id=b.tenant_id AND
      (b.monthly_plan_id=m.id OR (b.order_number,b.item_code,b.division_id) IS NOT DISTINCT FROM (m.order_number,m.item_code,m.division_id))
      LEFT JOIN mps_weekly_plans w ON w.tenant_id=b.tenant_id AND w.base_plan_id=b.id
      WHERE m.tenant_id=$1 AND m.id=ANY($2::uuid[]) ORDER BY b.id FOR UPDATE OF b`,[tenantId,monthlyPlanIds]);
    // Validate legacy business-key matches by the exact scoped monthly identity before allowing one first link.
    for(const monthlyId of monthlyPlanIds){
      const [target]=monthly.filter(row=>String(row.id)===monthlyId);
      const matches=conflicts.filter(row=>row.order_number===target.order_number&&row.item_code===target.item_code&&String(row.division_id)===String(target.division_id));
      if((matches.length>1 && !matches.every(row=>String(row.monthly_plan_id)===monthlyId)) || matches.some(row=>row.monthly_plan_id!=null&&String(row.monthly_plan_id)!==monthlyId
        || row.order_number!==row.monthly_order||row.item_code!==row.monthly_item||String(row.division_id)!==String(row.monthly_division)
        || (row.customer_code&&target.customer_code&&row.customer_code!==target.customer_code)))
        throw new Error('定向恢复发现多条基础计划、身份冲突或执行事实，停止以避免覆盖历史归属');
    }
  }
  const linksReady=await demandLinksReady(manager);
  let created = 0, updated = 0, conflicts = 0, multiBatch = 0,linkedCount=0,quantityProtected=0;
  const changedBaseIds=new Set<string>();
  let unallocated = new Decimal(0), overallocated = new Decimal(0);
  const requestId = `base-sync:${randomUUID()}`;
  // Fetch all prior automatic baselines once; ordinary human audit records are not ownership evidence.
  const histories: Row[] = monthly.length ? await manager.query(`SELECT DISTINCT ON (a.record_id) a.record_id,a.after_json->'syncValues' values
    FROM audit_logs a JOIN mps_base_plans b ON b.tenant_id=a.tenant_id AND b.id::text=a.record_id
    WHERE a.tenant_id=$1 AND a.resource='mps-base-plans' AND a.action='mps-base-plans.synchronized' AND ($2::uuid[] IS NULL OR b.monthly_plan_id=ANY($2::uuid[]) OR EXISTS(SELECT 1 FROM mps_monthly_plans target WHERE target.tenant_id=b.tenant_id AND target.id=ANY($2::uuid[]) AND target.order_number=b.order_number AND target.item_code=b.item_code))
    ORDER BY a.record_id,a.created_at DESC,a.id DESC`, [tenantId,monthlyPlanIds??null]) : [];
  const controlledRows: Row[] = linksReady ? await manager.query(`SELECT DISTINCT record_id FROM audit_logs WHERE tenant_id=$1 AND resource='mps-base-plans' AND ($2::uuid[] IS NULL OR record_id IN(SELECT b.id::text FROM mps_base_plans b JOIN mps_monthly_plans target ON target.tenant_id=b.tenant_id AND target.order_number=b.order_number AND target.item_code=b.item_code WHERE b.tenant_id=$1 AND target.id=ANY($2::uuid[]))) AND (action='demand.quantity.confirmed' OR (action IN ('mps-base-plans.updated','mps-base-plans.import_updated','mps-base-plans.batch_item_updated') AND coalesce(before_json->>'plannedQuantity',before_json->>'planned_quantity') IS NOT NULL AND coalesce(after_json->>'plannedQuantity',after_json->>'planned_quantity') IS NOT NULL AND coalesce(before_json->>'plannedQuantity',before_json->>'planned_quantity')::numeric IS DISTINCT FROM coalesce(after_json->>'plannedQuantity',after_json->>'planned_quantity')::numeric))`,[tenantId,monthlyPlanIds??null]):[];
  const controlledIds=new Set(controlledRows.map(r=>r.record_id));
  const baselines = new Map(histories.map(row => [row.record_id,row.values as Row]));
  for (const monthlyPlan of monthly) {
    const sourceKey=`monthly-source:${monthlyPlan.id}`;
    if(monthlyPlan.source_confirmed===false){
      conflicts++;
      await manager.query(`INSERT INTO mps_data_exceptions(tenant_id,exception_key,resource,record_id,business_key,exception_type,severity,message,active,created_by,updated_by)
        VALUES($1,$2,'mps-monthly-plans',$3,$4,'MONTHLY_SOURCE_UNCONFIRMED','WARNING','月度正式来源尚未确认或身份不一致，保留原计划',true,$5,$5)
        ON CONFLICT(tenant_id,exception_key) DO UPDATE SET active=true,resolved_at=NULL,message=excluded.message
        WHERE NOT mps_data_exceptions.active OR mps_data_exceptions.message IS DISTINCT FROM excluded.message`,
        [tenantId,sourceKey,monthlyPlan.id,monthlyPlan.order_number+'/'+monthlyPlan.item_code,actorId]);
      continue;
    }
    await manager.query('UPDATE mps_data_exceptions SET active=false,resolved_at=now() WHERE tenant_id=$1 AND exception_key=$2 AND active',[tenantId,sourceKey]);
    // Same lock as ordinary base creation: manual creation cannot race the absence check.
    await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`mps-delivery-code:${tenantId}:${monthlyPlan.order_number}:${monthlyPlan.item_code}`]);
    const allBases: Row[] = await manager.query(monthlyBaseLookupSql(linksReady),
      linksReady ? [tenantId,monthlyPlan.order_number,monthlyPlan.item_code,monthlyPlan.id] : [tenantId,monthlyPlan.order_number,monthlyPlan.item_code]);
    const conflictKey = `monthly-base:${monthlyPlan.id}`;
    const bases = allBases.filter(base => base.monthly_plan_id ? base.monthly_plan_id===monthlyPlan.id : base.division_id===monthlyPlan.division_id);
    const formalConflict=allBases.some(base => base.monthly_plan_id && ((base.monthly_plan_id===monthlyPlan.id && (base.order_number!==monthlyPlan.order_number || base.item_code!==monthlyPlan.item_code || base.division_id!==monthlyPlan.division_id)) || (base.division_id===monthlyPlan.division_id && base.monthly_plan_id!==monthlyPlan.id)));
    const customerConflict=bases.some(base=>base.customer_code!=null&&monthlyPlan.customer_code!=null&&base.customer_code!==monthlyPlan.customer_code);
    if (!formalConflict && !customerConflict && bases.length>1 && bases.every(base=>base.monthly_plan_id===monthlyPlan.id)) {
      const assigned=bases.reduce<Decimal>((sum,base)=>sum.add(base.planned_quantity),new Decimal(0));
      const delta=new Decimal(monthlyPlan.required_quantity).sub(assigned);
      unallocated=unallocated.add(Decimal.max(delta,0));overallocated=overallocated.add(Decimal.max(delta.negated(),0));
      await manager.query(`UPDATE mps_data_exceptions SET active=false,resolved_at=now(),updated_at=now(),updated_by=$3::uuid,version=version+1 WHERE tenant_id=$1 AND exception_key=$2 AND active=true`,[tenantId,conflictKey,actorId]);
      const gapKey=`demand-quantity-gap:${monthlyPlan.id}`;
      if(!delta.isZero()){
        quantityProtected++;
        await manager.query(`INSERT INTO mps_data_exceptions(tenant_id,exception_key,resource,record_id,business_key,exception_type,severity,message,active,created_by,updated_by)
          VALUES($1,$2,'mps-monthly-plans',$3,$4,'DEMAND_ALLOCATION_GAP','WARNING',$5,true,$6,$6)
          ON CONFLICT(tenant_id,exception_key) DO UPDATE SET active=true,resolved_at=NULL,message=excluded.message
          WHERE NOT mps_data_exceptions.active OR mps_data_exceptions.message IS DISTINCT FROM excluded.message`,
          [tenantId,gapKey,monthlyPlan.id,monthlyPlan.order_number+'/'+monthlyPlan.item_code,'已确认多批次数量保留；未分配差额='+delta.toFixed(4),actorId]);
      }else await manager.query('UPDATE mps_data_exceptions SET active=false,resolved_at=now() WHERE tenant_id=$1 AND exception_key=$2 AND active',[tenantId,gapKey]);
      multiBatch++;continue; // Multiple confirmed batches are legitimate; never overwrite quantities or create another.
    }
    // Another division's legitimate monthly plan owns its own batch. An unexplained
    // legacy ownership mismatch still needs manual reconciliation, as before.
    const siblingMonthly:Row[]=allBases.some(base=>base.division_id!==monthlyPlan.division_id)?await manager.query(
      'SELECT division_id FROM mps_monthly_plans WHERE tenant_id=$1 AND order_number=$2 AND item_code=$3',[tenantId,monthlyPlan.order_number,monthlyPlan.item_code]):[];
    const unmatchedDivision=allBases.some(base=>base.division_id!==monthlyPlan.division_id&&!siblingMonthly.some(plan=>plan.division_id===base.division_id));
    if (formalConflict || customerConflict || bases.length > 1 || unmatchedDivision) {
      conflicts++;
      const reason = formalConflict ? "显式需求父关系冲突，禁止文本回退" : customerConflict ? "基础计划客户归属冲突，保留原记录" : bases.length > 1 ? "多个历史批次尚未确认需求父关系，保留原记录" : "既有基础计划与月计划事业部不一致，保留原记录";
      await manager.query(`INSERT INTO mps_data_exceptions(tenant_id,exception_key,resource,record_id,business_key,exception_type,severity,message,active,created_by,updated_by)
        VALUES($1,$2,'mps-monthly-plans',$3::uuid,$4,'MONTHLY_BASE_CONFLICT','WARNING',$5,true,$6::uuid,$6::uuid)
        ON CONFLICT(tenant_id,exception_key) DO UPDATE SET message=excluded.message,active=true,resolved_at=NULL,
          updated_at=now(),updated_by=$6::uuid,version=mps_data_exceptions.version+1
        WHERE NOT mps_data_exceptions.active OR mps_data_exceptions.message IS DISTINCT FROM excluded.message`,
      [tenantId,conflictKey,monthlyPlan.id,`${monthlyPlan.order_number}/${monthlyPlan.item_code}`,reason,actorId]);
      continue;
    }
    const desired = monthlyBaseValues(monthlyPlan);
    const before = bases[0] ?? null;
    const previous = before ? baselines.get(before.id) : undefined;
    let after: Row;
    let changed = false;
    let linkedExisting=false;
    if (!before) {
      const delivery = await nextMasterPlanDeliveryCode(manager,tenantId,monthlyPlan.order_number,monthlyPlan.item_code,actorId);
      const entries = Object.entries(desired);
      [after] = await manager.query(`INSERT INTO mps_base_plans(tenant_id,order_number,item_code,delivery_number,created_by,updated_by,${entries.map(([key]) => key).join(",")})
        VALUES($1,$2,$3,$4,$5::uuid,$5::uuid,${entries.map((_,i) => `$${i+6}`).join(",")}) RETURNING *`,
      [tenantId,monthlyPlan.order_number,monthlyPlan.item_code,delivery,actorId,...entries.map(([key,value]) => key === "image_refs" ? JSON.stringify(value) : value)]);
      if(linksReady) after=await linkNewDemandRecord(manager,'mps-base-plans',after,actorId,actorName,requestId,trustedInternalService);
      created++; changed = true;
    } else {
      after = before;
      if(linksReady && before.monthly_plan_id==null && (expectedVersions||trustedInternalService)){
        if(!previous || String(previous.division_id)!==String(monthlyPlan.division_id)
          || (previous.customer_code&&monthlyPlan.customer_code&&previous.customer_code!==monthlyPlan.customer_code)){
          conflicts++;
          await manager.query(`INSERT INTO mps_data_exceptions(tenant_id,exception_key,resource,record_id,business_key,exception_type,severity,message,active,created_by,updated_by)
            VALUES($1,$2,'mps-base-plans',$3,$4,'MONTHLY_BASE_CONFLICT','WARNING','历史基础计划没有可证明的自动来源基线，保留人工归属',true,$5,$5)
            ON CONFLICT(tenant_id,exception_key) DO UPDATE SET active=true,resolved_at=NULL,message=excluded.message`,[tenantId,conflictKey,before.id,monthlyPlan.order_number+'/'+monthlyPlan.item_code,actorId]);
          continue;
        }
        after=await linkExistingDemandRecord(manager,'mps-base-plans',before,String(monthlyPlan.id),actorId,actorName,requestId,trustedInternalService);
        linkedExisting=true;linkedCount++;
      }
      const patch = monthlyBasePatch(before,desired,previous);
      if(controlledIds.has(before.id))delete patch.planned_quantity; // Explicit allocation remains user-owned even if quantities later coincide.
      const entries = Object.entries(patch);
      if (entries.length) {
        const result = await manager.query(`UPDATE mps_base_plans SET ${entries.map(([key],i) => `${key}=$${i+5}`).join(",")},
          updated_at=now(),updated_by=$3::uuid,version=version+1
          WHERE tenant_id=$1 AND id=$2::uuid AND version=$4 RETURNING *`,
        [tenantId,before.id,actorId,after.version,...entries.map(([key,value]) => key === "image_refs" ? JSON.stringify(value) : value)]);
        after = Array.isArray(result[0]) ? result[0][0] : result[0];
        if (!after) throw new Error("基础计划发生并发变化，请重试同步");
        updated++; changed = true;
      }
    }
    if(changed||linkedExisting)changedBaseIds.add(String(after.id));
    const delta=new Decimal(monthlyPlan.required_quantity).sub(after.planned_quantity);
    const gapKey=`demand-quantity-gap:${monthlyPlan.id}`;
    if(!delta.isZero()){
      quantityProtected++;unallocated=unallocated.add(Decimal.max(delta,0));overallocated=overallocated.add(Decimal.max(delta.negated(),0));
      await manager.query(`INSERT INTO mps_data_exceptions(tenant_id,exception_key,resource,record_id,business_key,exception_type,severity,message,active,created_by,updated_by)
        VALUES($1,$2,'mps-monthly-plans',$3,$4,'DEMAND_ALLOCATION_GAP','WARNING',$5,true,$6,$6)
        ON CONFLICT(tenant_id,exception_key) DO UPDATE SET active=true,resolved_at=NULL,message=excluded.message
        WHERE NOT mps_data_exceptions.active OR mps_data_exceptions.message IS DISTINCT FROM excluded.message`,
        [tenantId,gapKey,monthlyPlan.id,monthlyPlan.order_number+'/'+monthlyPlan.item_code,'基础计划数量由人工或历史所有权保护；未分配差额='+delta.toFixed(4),actorId]);
    }else await manager.query('UPDATE mps_data_exceptions SET active=false,resolved_at=now() WHERE tenant_id=$1 AND exception_key=$2 AND active',[tenantId,gapKey]);
    // Remember source values separately from the record's manual values in the existing audit only.
    // No-op reruns do not append audit entries or increment row versions.
    if (changed || !previous || Object.keys(previous).sort().join() !== Object.keys(desired).sort().join() || columns.some(key => comparable(key,previous[key]) !== comparable(key,desired[key]))) {
      await manager.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1,$2::uuid,$3,'mps-base-plans',$4::uuid,'mps-base-plans.synchronized',$5::jsonb,$6::jsonb,$7,'api',$2::uuid,$2::uuid)`,
      [tenantId,actorId,actorName,after.id,before == null ? null : JSON.stringify(before),JSON.stringify({...after,syncValues:desired}),requestId]);
    }
    await manager.query(`UPDATE mps_data_exceptions SET active=false,resolved_at=now(),updated_at=now(),updated_by=$3::uuid,version=version+1
      WHERE tenant_id=$1 AND exception_key=$2 AND active=true`, [tenantId,conflictKey,actorId]);
  }
  if (enqueueBaseToWeekly && (created + updated > 0 || changedBaseIds.size>0)) {
    const scopedIds=expectedVersions?[...changedBaseIds]:null;
    const scopeJson=scopedIds?.length?{basePlanIds:scopedIds}:null;
    await manager.query(`INSERT INTO mps_reconciliation_outbox(tenant_id,resource,record_id,sync_key,scope_json,idempotency_key,actor_id,actor_name,created_by,updated_by)
      VALUES($1,'mps-base-plans',$2::uuid,'base-to-weekly',$3::jsonb,$4,$5::uuid,$6,$5::uuid,$5::uuid)
      ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,[tenantId,scopedIds?.[0]??null,scopeJson?JSON.stringify(scopeJson):null,
      `${requestId}:base-to-weekly`,actorId,actorName]);
  }
  return { count:created+updated+linkedCount,balance:{unallocated:unallocated.toFixed(4),overallocated:overallocated.toFixed(4)},metrics:{base_created:created,base_updated:updated,base_conflicts:conflicts,monthly_eligible:monthly.length,base_multi_batch:multiBatch,base_linked:linkedCount,base_quantity_protected:quantityProtected} };
}
