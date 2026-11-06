import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

type Db = Pick<EntityManager,'query'>;
export const demandLinkTables = { 'mps-order-allocations':'mps_order_allocations', 'mps-base-plans':'mps_base_plans', 'mps-review-due-dates':'mps_review_due_dates' } as const;
/** Catalog-only, no deployment-positive cache; works before/after 121 without undefined columns. */
export async function demandLinksReady(m: Db): Promise<boolean> {
  const [r] = await m.query(`SELECT to_regprocedure('mps_assert_demand_link(text,jsonb)') IS NOT NULL
    AND (SELECT count(*) FROM pg_attribute WHERE attrelid IN (to_regclass('mps_order_allocations'),to_regclass('mps_base_plans'),to_regclass('mps_review_due_dates'))
      AND attname='monthly_plan_id' AND atttypid='uuid'::regtype AND NOT attisdropped)=3
    AND (SELECT count(*) FROM pg_trigger WHERE tgrelid IN(to_regclass('mps_order_allocations'),to_regclass('mps_base_plans'),to_regclass('mps_review_due_dates')) AND tgname='ab_mps_demand_link' AND tgenabled IN('O','A'))=3 AS ready`);
  return r?.ready === true;
}

/** Transaction-bound evidence, not a client-settable session bypass. Rolled back with the write. */
export async function authorizeDemandLink(m:Db,resource:string,row:Record<string,any>,demandId:string,actorId:string,actorName:string,requestId:string) {
  await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,after_json,request_id,source,created_by,updated_by)
    VALUES($1,$2::uuid,$3,$4,$5,'demand.link_authorized',jsonb_build_object('demandId',$6::text,'expectedVersion',$7::int,'xactId',pg_current_xact_id()::text),$8,'api',$2::uuid,$2::uuid)`,
    [row.tenant_id,actorId,actorName,resource,row.id,demandId,row.version,requestId]);
}

/** New records only. Historical NULLs are never mass-filled by synchronization. */
export async function linkNewDemandRecord(m: Db, resource: keyof typeof demandLinkTables, row: Record<string,any>, actorId: string, actorName: string, requestId: string) {
  if (!await demandLinksReady(m)) return row;
  const item = resource==='mps-review-due-dates' ? row.drawing_number : row.item_code;
  const [parent] = await m.query(`SELECT m.* FROM mps_monthly_plans m WHERE m.tenant_id=$1 AND m.order_number=$2 AND m.item_code=$3
    AND m.division_id IS NOT DISTINCT FROM $4::uuid FOR SHARE`,[row.tenant_id,row.order_number,item,row.division_id]);
  if (!parent || (parent.lifecycle_status && parent.lifecycle_status!=='ACTIVE')) return row;
  const [source]=await m.query("SELECT id FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid AND archived_at IS NULL AND order_status='已审核' AND manually_maintained=true FOR SHARE",[row.tenant_id,parent.allocation_id]);
  if(!source)return row; // Historical membership requires an explicit reviewed command, never an automatic activation.
  await m.query('SELECT mps_assert_demand_link($1,$2::jsonb)',[demandLinkTables[resource],JSON.stringify({...row,monthly_plan_id:parent.id})]);
  await authorizeDemandLink(m,resource,row,parent.id,actorId,actorName,requestId);
  const changed = await m.query(`UPDATE ${demandLinkTables[resource]} SET monthly_plan_id=$3::uuid
    WHERE tenant_id=$1 AND id=$2::uuid AND monthly_plan_id IS NULL RETURNING *`,[row.tenant_id,row.id,parent.id]);
  const after=Array.isArray(changed[0])?changed[0][0]:changed[0];
  if (!after) throw new ConflictException('新记录的需求关联发生并发变化');
  await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
    VALUES($1,$2::uuid,$3,$4,$5,'demand.link_created',$6::jsonb,$7::jsonb,$8,'api',$2::uuid,$2::uuid)`,
    [row.tenant_id,actorId,actorName,resource,row.id,JSON.stringify(row),JSON.stringify(after),requestId]);
  return after;
}
