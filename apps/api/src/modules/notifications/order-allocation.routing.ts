import type { EntityManager } from "typeorm";
import type { AllocationChange } from "../master-plan-system/order-allocation.domain";
export type AllocationRoute = { userId:string;displayName:string;wechatUserId:string;enabled:boolean;changes:AllocationChange[];identities:string[] };
export async function resolveAllocationRoutes(m:EntityManager,tenantId:string,changes:AllocationChange[]) {
  const users=await m.query(`SELECT id,display_name,username,wechat_user_id,enabled FROM users WHERE tenant_id=$1`,[tenantId]) as Array<Record<string,unknown>>;
  const units=await m.query(`SELECT r.division_id,r.user_ids,r.enabled,o.name,o.enabled AS unit_enabled FROM mps_allocation_recipients r JOIN organization_units o ON o.id=r.division_id WHERE r.tenant_id=$1`,[tenantId]) as Array<Record<string,unknown>>;
  const routes=new Map<string,AllocationRoute>(),errors=new Set<string>();
  const add=(user:Record<string,unknown>,change:AllocationChange,identity:string)=>{
    const id=String(user.id); if(user.enabled!==true){errors.add(`员工 ${user.display_name||user.username} 已禁用`);return;}
    const route=routes.get(id)??{userId:id,displayName:String(user.display_name||user.username),wechatUserId:String(user.wechat_user_id??'').trim(),enabled:true,changes:[],identities:[]};
    if(!route.wechatUserId)errors.add(`员工 ${route.displayName} 缺少企业微信UserId`);
    if(!route.changes.some(c=>c.after.id===change.after.id))route.changes.push(change);
    if(!route.identities.includes(identity))route.identities.push(identity);routes.set(id,route);
  };
  for(const change of changes) {
    for(const [phase,snapshot] of [["变更前",change.before],["变更后",change.after]] as const) {
      if(!snapshot)continue;
      const divisionMoved=change.before&&change.before.divisionId!==change.after.divisionId;
      const salespersonMoved=change.before&&change.before.salespersonName!==change.after.salespersonName;
      const unit=units.find(u=>u.division_id===snapshot.divisionId);
      if(!unit||unit.enabled!==true||unit.unit_enabled===false||!Array.isArray(unit.user_ids)||!unit.user_ids.length) errors.add(`承接单位 ${snapshot.divisionName??snapshot.divisionId??'未填写'} 未配置有效接收人员`);
      else for(const id of unit.user_ids as string[]) {const user=users.find(u=>u.id===id);if(!user)errors.add(`承接单位 ${unit.name} 接收人员不属于当前租户或不存在`);else add(user,change,`${unit.name}${divisionMoved?`（${phase==='变更前'?'调出':'调入'}）`:''}`);}
      const name=String(snapshot.salespersonName??'').trim();const matches=name?users.filter(u=>String(u.display_name??'').trim()===name):[];
      if(!matches.length)errors.add(`业务员 ${name||'未填写'} 未匹配当前租户员工`);
      else for(const user of matches) add(user,change,`业务员 ${name}${salespersonMoved?`（${phase==='变更前'?'移出':'移入'}）`:''}`);
    }
  }
  return {recipients:[...routes.values()],errors:[...errors]};
}
