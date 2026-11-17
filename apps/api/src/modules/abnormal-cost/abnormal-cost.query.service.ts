import { ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrganizationDirectoryService } from '../organization-directory/organization-directory.service';
import { abnormalCostResources } from '@kdos/contracts';
import { costCan, costField, type AbnormalActor } from './abnormal-cost.policy';
@Injectable()
export class AbnormalCostQueryService {
  constructor(private readonly db:DataSource,private readonly organizations:OrganizationDirectoryService){}
  async options(actor:AbnormalActor){
    if(!abnormalCostResources.some(r=>['read','create','update'].some(action=>costCan(actor,r.code,action))))throw new ForbiddenException('无异常费用访问权限');
    const main='abnormal-responsibility-requests',child='abnormal-responsibility-judgments';
    const mayReference=(code:string,key:string)=>['read','create','update'].some(action=>costCan(actor,code,action))&&(costField(actor,code,key,'read')||costCan(actor,code,'create')&&(costField(actor,code,key,'update')||!costCan(actor,code,'read'))||costCan(actor,code,'update')&&costField(actor,code,key,'update'));
    const directory=mayReference(main,'initiator_id')||mayReference(child,'judge_user_id')||mayReference(child,'responsibility_allocations')||abnormalCostResources.some(r=>costCan(actor,r.code,'read')&&['createdBy','updatedBy'].some(key=>costField(actor,r.code,key,'read')));
    const departments=mayReference(main,'division_id')||mayReference(child,'judgment_department_id');
    const categoryChoices=mayReference(child,'category_id');
    const computeLevels=['create','update'].some(action=>costCan(actor,main,action))&&mayReference(main,'confirmed_amount');
    const levelLabels=costCan(actor,main,'read')&&costField(actor,main,'severity_level_id','read');
    return this.db.transaction(async m=>{
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      const users=directory?await m.query("SELECT id,COALESCE(NULLIF(display_name,''),username) name,username,enabled,position FROM users WHERE tenant_id=$1 ORDER BY display_name,username",[actor.tenantId]):[];
      const categories=categoryChoices?await m.query('SELECT id,category_name FROM abnormal_categories WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY category_name',[actor.tenantId]):[];
      const severities=(computeLevels||levelLabels)?await m.query(`SELECT id,${computeLevels?'amount_min,amount_max,':''}severity_name FROM incident_severity_levels WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY amount_min`,[actor.tenantId]):[];
      const [admin]=mayReference(child,'responsibility_allocations')?await m.query("SELECT u.id FROM users u JOIN administrator_grants g ON g.tenant_id=u.tenant_id AND g.user_id=u.id AND g.system_admin=true WHERE u.tenant_id=$1 AND u.username='admin' AND u.enabled=true",[actor.tenantId]):[];
      return {users,categories,severities,departments:departments?await this.organizations.listEnabled():[],systemAdminId:admin?.id??null};
    });
  }
}
