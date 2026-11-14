import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** The only provenance change allowed here is archived-zero source -> same demand's active source. */
export async function recoverMonthlyAllocationSource(m:EntityManager,before:Record<string,any>,sourceId:string,
  actorId:string,actorName:string,requestId:string){
  const [ready]=await m.query("SELECT to_regprocedure('mps_allocation_source_recovery_allowed(jsonb,jsonb)') IS NOT NULL ready");
  if(!ready?.ready)throw new ConflictException('来源自动恢复数据库能力尚未安装');
  await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,after_json,request_id,source,created_by,updated_by)
    VALUES($1,$2::uuid,$3,'mps-monthly-plans',$4,'allocation.source_recovery_authorized',
      jsonb_build_object('oldSourceId',$5::text,'newSourceId',$6::text,'expectedVersion',$7::int,'xactId',pg_current_xact_id()::text),$8,'api',$2::uuid,$2::uuid)`,
    [before.tenant_id,actorId,actorName,before.id,before.allocation_id,sourceId,before.version,requestId]);
  await m.query('SET LOCAL ROLE mps_demand_link_service');
  const changed=await m.query(`UPDATE mps_monthly_plans SET allocation_id=$3::uuid WHERE tenant_id=$1 AND id=$2::uuid
    AND version=$4 AND allocation_id=$5::uuid RETURNING id`,[before.tenant_id,before.id,sourceId,before.version,before.allocation_id]);
  await m.query('RESET ROLE');
  if(!(Array.isArray(changed[0])?changed[0]:changed).length)throw new ConflictException('月度来源发生并发变化');
  const result=await m.query(`UPDATE mps_monthly_plans SET version=version+1,updated_at=now(),updated_by=$3::uuid
    WHERE tenant_id=$1 AND id=$2::uuid AND version=$4 RETURNING *`,[before.tenant_id,before.id,actorId,before.version]);
  const after=Array.isArray(result[0])?result[0][0]:result[0];
  if(!after)throw new ConflictException('月度来源版本发生并发变化');
  await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
    VALUES($1,$2::uuid,$3,'mps-monthly-plans',$4,'allocation.source_recovered',$5::jsonb,$6::jsonb,$7,'api',$2::uuid,$2::uuid)`,
    [before.tenant_id,actorId,actorName,before.id,JSON.stringify(before),JSON.stringify(after),requestId]);
  return after;
}
