import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrganizationDirectoryService } from '../organization-directory/organization-directory.service';
import { abnormalAllowsVirtual, abnormalCostResources } from '@kdos/contracts';
import { costCan, costField, type AbnormalActor } from './abnormal-cost.policy';
@Injectable()
export class AbnormalCostQueryService {
  constructor(private readonly db:DataSource,private readonly organizations:OrganizationDirectoryService){}
  async orderOptions(query:Record<string,unknown>,actor:AbnormalActor){
    const code='abnormal-responsibility-requests',field=query.orderNo?'item_codes':'order_no';
    if(!['read','create','update'].some(a=>costCan(actor,code,a))||!(costField(actor,code,field,'read')||costCan(actor,code,'create')&&!costCan(actor,code,'read')||costCan(actor,code,'update')&&costField(actor,code,field,'update')))throw new ForbiddenException('无订单候选字段访问权限');
    const page=Number(query.page??1),term=String(query.search??'').trim(),order=String(query.orderNo??'');
    if(!Number.isInteger(page)||page<1||page>10000||term.length>100||order.length>100)throw new BadRequestException('订单搜索条件无效');
    let sub:unknown=[];try{sub=JSON.parse(String(query.subCategories??'[]'));}catch{throw new BadRequestException('分类条件无效');}
    const allowVirtual=abnormalAllowsVirtual(query.majorCategory,sub);
    return this.db.transaction(async m=>{
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      const params:unknown[]=[actor.tenantId,`%${term.replace(/[\\%_]/g,'\\$&')}%`,allowVirtual,(page-1)*50];
      let rows:Array<Record<string,unknown>>;
      if(order){params.push(order);rows=await m.query(`SELECT item_code value,item_name,order_no FROM abnormal_cost_order_items WHERE tenant_id=$1 AND is_active AND deleted_at IS NULL AND ($3 OR source<>'SYSTEM_FIXED') AND order_no=$5 AND (item_code ILIKE $2 OR item_name ILIKE $2) ORDER BY item_code LIMIT 51 OFFSET $4`,params);}
      else rows=await m.query(`SELECT DISTINCT order_no value FROM abnormal_cost_order_items WHERE tenant_id=$1 AND is_active AND deleted_at IS NULL AND ($3 OR source<>'SYSTEM_FIXED') AND order_no ILIKE $2 ORDER BY order_no LIMIT 51 OFFSET $4`,params);
      return {options:rows.slice(0,50).map(r=>({value:r.value,label:order?`${r.value}${r.item_name?` · ${r.item_name}`:''}`:r.value})),hasMore:rows.length>50,page};
    });
  }
  async orderStatus(actor:AbnormalActor){
    if(!costCan(actor,'abnormal-cost-orders','read'))throw new ForbiddenException('无订单表访问权限');
    return this.db.transaction(async m=>{await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);const [last]=await m.query('SELECT status,started_at,finished_at,sources,metrics,error_code FROM abnormal_cost_order_sync_runs WHERE tenant_id=$1 ORDER BY started_at DESC LIMIT 1',[actor.tenantId]);const [success]=await m.query("SELECT finished_at FROM abnormal_cost_order_sync_runs WHERE tenant_id=$1 AND status='SUCCESS' ORDER BY finished_at DESC LIMIT 1",[actor.tenantId]);return {lastResult:last?.status??'NOT_INITIALIZED',lastSuccessAt:success?.finished_at??null,lastStartedAt:last?.started_at??null};});
  }
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
      const majorChoices=mayReference(main,'major_category'),subChoices=majorChoices&&mayReference(main,'sub_categories');
      const expenseCategories=majorChoices?await m.query(`SELECT DISTINCT major_category${subChoices?',sub_category':''} FROM abnormal_expense_categories WHERE tenant_id=$1 AND deleted_at IS NULL AND is_enabled ORDER BY major_category${subChoices?',sub_category':''}`,[actor.tenantId]):[];
      const severities=(computeLevels||levelLabels)?await m.query(`SELECT id,${computeLevels?'amount_min,amount_max,':''}severity_name FROM incident_severity_levels WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY amount_min`,[actor.tenantId]):[];
      const [admin]=mayReference(child,'responsibility_allocations')?await m.query("SELECT u.id FROM users u JOIN administrator_grants g ON g.tenant_id=u.tenant_id AND g.user_id=u.id AND g.system_admin=true WHERE u.tenant_id=$1 AND u.username='admin' AND u.enabled=true",[actor.tenantId]):[];
      return {users,categories,severities,expenseCategories,departments:departments?await this.organizations.listEnabled():[],systemAdminId:admin?.id??null};
    });
  }
}
