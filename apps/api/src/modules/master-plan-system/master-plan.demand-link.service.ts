import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { DataSource, type EntityManager } from 'typeorm';
import { mpsDemandLinkCapability, type MpsBindDemandRequest, type MpsDemandLinkInfo } from '@kdos/contracts';
import { buildDataScopeClause } from '../../common/filtering/data-scope';
import { columnsFor, fieldsFor, MASTER_PLAN_RESOURCE_MAP } from './master-plan.config';
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from './master-plan.types';
import { reviewDueScope } from './review-due-date.query.service';
import { demandLinksReady, demandLinkTables, authorizeDemandLink } from './master-plan.demand-links';
const uuid=/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

@Injectable()
export class MasterPlanDemandLinkService {
  constructor(private readonly db: DataSource) {}
  private table(resource:string) {
    if (!Object.hasOwn(demandLinkTables,resource)) throw new BadRequestException('不支持的需求关联资源');
    return demandLinkTables[resource as keyof typeof demandLinkTables];
  }
  canBind(resource:string, actor:MasterPlanActor) {
    return !!actor.userId && hasMasterPlanPermission(actor,resource,'update') && hasMasterPlanPermission(actor,mpsDemandLinkCapability.code,'update') && hasMasterPlanPermission(actor,'mps-monthly-plans','read');
  }
  async availability(resource:string, actor:MasterPlanActor) {
    return { schemaReady:await demandLinksReady(this.db.manager), canBind:this.canBind(resource,actor), canRead:hasMasterPlanPermission(actor,resource,'read')&&hasMasterPlanPermission(actor,'mps-monthly-plans','read') };
  }
  private async scoped(m:EntityManager, resource:string, id:string, actor:MasterPlanActor, write=false, lock=false) {
    if (!hasMasterPlanPermission(actor,resource,'read') || (write&&!hasMasterPlanPermission(actor,resource,'update'))) throw new ForbiddenException('没有关联资源查看/修改权限');
    const review=resource==='mps-review-due-dates';
    const keys=review?['orderNumber','drawingNumber','divisionId']:['orderNumber','itemCode','divisionId'];
    if (!keys.every(k=>hasMasterPlanFieldPermission(actor,resource,k,'read'))) throw new ForbiddenException('需求关联需要身份字段读取权限');
    const def=MASTER_PLAN_RESOURCE_MAP.get(resource as Parameters<typeof MASTER_PLAN_RESOURCE_MAP.get>[0]);
    if(!def)throw new BadRequestException('未知关联资源');
    const p:unknown[]=[actor.tenantId,id];
    const clauses=(write?['read','update']:['read']).map(action=>review?reviewDueScope(actor,p,action):buildDataScopeClause({resource,action,params:p,columns:columnsFor(def),numericFields:fieldsFor(def).filter(f=>f.type==='number').map(f=>f.key),actor:{...actor,tableDataScopes:actor.tableDataScopes.filter(s=>s.scope!=='NONE')}}));
    const [row]=await m.query(`SELECT record.* FROM ${def.table} record WHERE record.tenant_id=$1 AND record.id=$2::uuid AND (${clauses.join(') AND (')})${lock?' FOR UPDATE':''}`,p);
    if(!row)throw new NotFoundException('记录不存在或不在授权范围');
    return row;
  }
  async target(id:string,actor:MasterPlanActor) {
    if(!uuid.test(id))throw new BadRequestException('需求ID无效');
    return this.db.transaction(async m=>{
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      const r=await this.scoped(m,'mps-monthly-plans',id,actor);
      return {id:r.id,version:r.version,orderNumber:r.order_number,itemCode:r.item_code,divisionId:r.division_id};
    });
  }
  async info(resource:string,id:string,actor:MasterPlanActor):Promise<MpsDemandLinkInfo> {
    this.table(resource);if(!uuid.test(id))throw new BadRequestException('记录ID无效');
    return this.db.transaction(async m=>{
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      const row=await this.scoped(m,resource,id,actor);
      const ready=await demandLinksReady(m);
      const parent=row.monthly_plan_id?await this.scoped(m,'mps-monthly-plans',row.monthly_plan_id,actor):null;
      if(parent && (parent.order_number!==row.order_number || parent.item_code!==(resource==='mps-review-due-dates'?row.drawing_number:row.item_code) || parent.division_id!==row.division_id))throw new ConflictException('显式需求父关系身份冲突，禁止文本回退');
      const result:MpsDemandLinkInfo={schemaReady:ready,recordId:id,recordVersion:row.version,demandId:parent?.id??null,demandVersion:parent?.version??null,canBind:ready&&this.canBind(resource,actor)&&!parent};
      if(parent&&(!parent.lifecycle_status||parent.lifecycle_status==='ACTIVE')&&hasMasterPlanFieldPermission(actor,'mps-monthly-plans','requiredQuantity','read')&&hasMasterPlanPermission(actor,'mps-base-plans','read')&&hasMasterPlanFieldPermission(actor,'mps-base-plans','plannedQuantity','read')) {
        const bases=await m.query(`SELECT id,planned_quantity,COALESCE(to_jsonb(b)->>'lifecycle_status','ACTIVE') status FROM mps_base_plans b WHERE tenant_id=$1 AND monthly_plan_id=$2::uuid ORDER BY id`,[actor.tenantId,parent.id]);
        for(const base of bases){try{await this.scoped(m,'mps-base-plans',base.id,actor);}catch(error){if(error instanceof NotFoundException||error instanceof ForbiddenException)return result;throw error;}}
        if(bases.some((b:any)=>['CANCELLED','LEGACY_RETAINED'].includes(b.status)))return result; // Remaining-demand/fulfillment accounting is deliberately not inferred.
        const p=bases.filter((b:any)=>b.status!=='CANCELLED').reduce((s:Decimal,b:any)=>s.add(b.planned_quantity),new Decimal(0));
        const delta=new Decimal(parent.required_quantity).sub(p);
        result.balance={required:new Decimal(parent.required_quantity).toFixed(4),allocated:p.toFixed(4),difference:delta.toFixed(4),unallocated:Decimal.max(delta,0).toFixed(4),overallocated:Decimal.max(delta.negated(),0).toFixed(4),provisional:true};
      }
      return result;
    });
  }
  async bind(resource:string,id:string,body:MpsBindDemandRequest,actor:MasterPlanActor,attempt=0):Promise<{id:string;version:number;demandId:string;repeated:boolean}> {
    const table=this.table(resource);
    if(!this.canBind(resource,actor))throw new ForbiddenException('缺少需求首次关联确认及原记录修改权限');
    if(!uuid.test(id)||!body||!uuid.test(body.demandId)||!uuid.test(body.idempotencyKey)||![body.expectedVersion,body.expectedDemandVersion].every(n=>Number.isSafeInteger(n)&&n>0)||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>1000)throw new BadRequestException('关联ID、版本、幂等键或原因无效');
    const hash=createHash('sha256').update(JSON.stringify([resource,id,body.demandId,body.expectedVersion,body.expectedDemandVersion,body.reason.trim()])).digest('hex');
    const key=JSON.stringify(['mps-demand-link',actor.tenantId,actor.userId,body.idempotencyKey]);
    try { return await this.db.transaction('SERIALIZABLE',async m=>{
      await m.query("SELECT set_config('app.tenant_id',$1,true),set_config('lock_timeout','5s',true)",[actor.tenantId]);
      if(!await demandLinksReady(m))throw new ConflictException({code:'MPS_DEMAND_SCHEMA_UNAVAILABLE',message:'需求关联结构尚未发布'});
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
      const parent=await this.scoped(m,'mps-monthly-plans',body.demandId,actor,false,true);
      const before=await this.scoped(m,resource,id,actor,true,true);
      const [prior]=await m.query('SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1',[key]);
      if(prior){if(prior.request_hash!==hash)throw new ConflictException('幂等键内容冲突');return {...prior.response_json,repeated:true};}
      if(before.monthly_plan_id)throw new ConflictException('已有需求父关系，不能重新绑定');
      if(before.version!==body.expectedVersion||parent.version!==body.expectedDemandVersion)throw new ConflictException('记录或需求版本已变化，请重新加载');
      await m.query('SELECT mps_assert_demand_link($1,$2::jsonb)',[table,JSON.stringify({...before,monthly_plan_id:parent.id})]);
      await authorizeDemandLink(m,resource,before,parent.id,actor.userId!,actor.username,actor.requestId);
      const changed=await m.query(`UPDATE ${table} SET monthly_plan_id=$3::uuid,version=version+1,updated_at=now(),updated_by=$4::uuid WHERE tenant_id=$1 AND id=$2::uuid AND version=$5 AND monthly_plan_id IS NULL RETURNING *`,[actor.tenantId,id,parent.id,actor.userId,body.expectedVersion]);
      const after=Array.isArray(changed[0])?changed[0][0]:changed[0];
      if(!after)throw new ConflictException('首次关联发生并发变化');
      await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by) VALUES($1,$2::uuid,$3,$4,$5,'demand.first_link_confirmed',$6::jsonb,$7::jsonb,$8,$9,$2::uuid,$2::uuid)`,[actor.tenantId,actor.userId,actor.username,resource,id,JSON.stringify(before),JSON.stringify({...after,reason:body.reason.trim(),demandVersion:parent.version}),actor.requestId,actor.source==='system'?'api':actor.source]);
      const response={id,version:after.version,demandId:parent.id,repeated:false};
      await m.query('INSERT INTO idempotency_keys(key,request_hash,response_json,created_by,updated_by)VALUES($1,$2,$3::jsonb,$4::uuid,$4::uuid)',[key,hash,JSON.stringify(response),actor.userId]);
      return response;
    }); }catch(error){const code=(error as any)?.driverError?.code??(error as any)?.code;if(['40001','40P01'].includes(code)&&attempt<2)return this.bind(resource,id,body,actor,attempt+1);if(['23514','23503','40001','40P01','55P03'].includes(code))throw new ConflictException('需求关联冲突或并发变化，请核对来源身份并重新加载');throw error;}
  }
}
