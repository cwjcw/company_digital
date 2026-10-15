import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { NotificationService } from "../notifications/notification.service";
import { allocationChange, allocationVendorTargetError } from "./order-allocation.domain";
import { DataSource, EntityManager } from "typeorm";
import type { MasterPlanActor } from "./master-plan.types";
import { OrganizationDirectoryService } from "../organization-directory/organization-directory.service";
import { MASTER_PLAN_SYSTEM_USER_ID } from "./master-plan.sync.service";
export const ALLOCATION_EVENT = "mps.order_allocation.batch_changed";
export const ALLOCATION_RULE_KEY = "pmc-order-allocation-changes";
export const ALLOCATION_VENDOR_SEEDS = [["事业一部","事业一部"],["事业二部","事业二部"],["厦门凯南智能制造有限公司","事业三部"],["厦门科加智能制造有限公司","事业四部"],["供应链","采购部"]];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
@Injectable()
export class OrderAllocationConfigService implements OnModuleInit {
  private readonly logger=new Logger(OrderAllocationConfigService.name);
  constructor(private readonly db: DataSource, private readonly notifications: NotificationService, private readonly directory: OrganizationDirectoryService) {}
  async onModuleInit() {
    const issues=await this.seed(process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN", MASTER_PLAN_SYSTEM_USER_ID);
    if(issues.length)this.logger.warn(issues.map(issue=>`${issue.supplierName}：${issue.message}`).join("；"));
  }
  async seed(tenantId: string, actorId: string, manager?: EntityManager) {
    const work = async (m: EntityManager) => {
      await m.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      const units = await m.query("SELECT id,name,enabled FROM organization_units", []);
      for (const [supplier, name] of ALLOCATION_VENDOR_SEEDS) {
        const matches = units.filter((u: { name:string;enabled:boolean })=>u.enabled&&u.name===name);
        // Any unresolved required seed is returned as a diagnostic, never silently guessed.
        if(matches.length===1){
        const inserted=await m.query(`INSERT INTO mps_allocation_vendor_mappings(tenant_id,supplier_name,division_id,created_by,updated_by) VALUES($1,$2,$3::uuid,$4::uuid,$4::uuid) ON CONFLICT(tenant_id,supplier_name) DO NOTHING RETURNING *`, [tenantId,supplier,matches[0].id,actorId]);
        if(inserted[0])await this.seedAudit(m,tenantId,actorId,"vendors",inserted[0]);
        }
      }
      const vendors=await m.query("SELECT * FROM mps_allocation_vendor_mappings WHERE tenant_id=$1",[tenantId]);
      for(const vendor of vendors)if(vendor.enabled&&units.some((u:{id:string;enabled:boolean})=>u.id===vendor.division_id&&u.enabled))await this.ensureRecipient(m,tenantId,actorId,vendor.division_id);
      await m.query(`INSERT INTO notification_rules(tenant_id,rule_key,name,event_type,channel,module_code,resource,recipient_rule,enabled,config,created_by,updated_by) VALUES($1,$2,'PMC订单分配新增/变更通知',$3,'WECHAT_WORK','planning','mps-order-allocations','ORDER_ALLOCATION_DYNAMIC',false,'{"messageType":"text_file"}'::jsonb,$4::uuid,$4::uuid) ON CONFLICT(tenant_id,rule_key) DO NOTHING`,[tenantId,ALLOCATION_RULE_KEY,ALLOCATION_EVENT,actorId]);
      return allocationMappingIssues(units,vendors);
    };
    return manager ? work(manager) : this.db.transaction(work);
  }
  assertAdmin(actor: MasterPlanActor) { if (!actor.userId || !(actor.isSystemAdmin || actor.moduleAdminCodes?.includes("planning") || actor.permissions.includes("*"))) throw new ForbiddenException("仅PMC管理员可管理订单分配通知配置"); }
  async read(actor: MasterPlanActor) {
    this.assertAdmin(actor);
    return this.db.transaction(async m=>{
      const issues=await this.seed(actor.tenantId,actor.userId!,m);
      const vendors=await m.query(`SELECT v.*,o.name AS "divisionName",o.enabled AS "unitEnabled" FROM mps_allocation_vendor_mappings v LEFT JOIN organization_units o ON o.id=v.division_id WHERE v.tenant_id=$1 ORDER BY v.supplier_name`,[actor.tenantId]);
      const recipients=await m.query(`SELECT r.*,o.name AS "divisionName",o.enabled AS "unitEnabled" FROM mps_allocation_recipients r LEFT JOIN organization_units o ON o.id=r.division_id WHERE r.tenant_id=$1 ORDER BY o.name`,[actor.tenantId]);
      const [rule]=await m.query("SELECT * FROM notification_rules WHERE tenant_id=$1 AND rule_key=$2",[actor.tenantId,ALLOCATION_RULE_KEY]);
      const [last]=await m.query("SELECT max(d.delivered_at) AS time FROM notification_delivery_logs d JOIN notification_outbox b ON b.id=d.notification_outbox_id AND b.tenant_id=d.tenant_id WHERE d.tenant_id=$1 AND b.event_type=$2 AND d.status='SENT'",[actor.tenantId,ALLOCATION_EVENT]);
      const users=await m.query(`SELECT id,display_name AS "displayName",username,employee_no AS "employeeNo",enabled,(NULLIF(btrim(wechat_user_id),'') IS NOT NULL) AS "hasWechatId" FROM users WHERE tenant_id=$1 ORDER BY display_name,username`,[actor.tenantId]);
      const unitOptions=await this.directory.listEnabled();
      const requiredUnits=new Set(vendors.filter((v:{enabled:boolean})=>v.enabled).map((v:{division_id:string})=>v.division_id));
      return {vendors,recipients,rule,lastSentAt:last?.time,users,unitOptions,issues,units:unitOptions.map(u=>u.pathLabel),
        complete:issues.length===0&&requiredUnits.size>0&&[...requiredUnits].every(id=>recipients.some((r:{division_id:string;enabled:boolean;unitEnabled:boolean;user_ids:string[]})=>r.division_id===id&&r.enabled&&r.unitEnabled&&r.user_ids.length>0&&r.user_ids.every(id=>users.some((u:{id:string;enabled:boolean;hasWechatId:boolean})=>u.id===id&&u.enabled&&u.hasWechatId))))};
    });
  }
  async testDelivery(input:Record<string,unknown>,actor:MasterPlanActor) {
    this.assertAdmin(actor);const userId=String(input.userId??"");if(!uuid.test(userId))throw new BadRequestException("测试接收人员无效");
    return this.db.transaction(async m=>{
      await this.seed(actor.tenantId,actor.userId!,m);
      const [user]=await m.query("SELECT id,display_name,wechat_user_id FROM users WHERE tenant_id=$1 AND id=$2::uuid AND enabled=true",[actor.tenantId,userId]);
      if(!user||!String(user.wechat_user_id??'').trim())throw new BadRequestException("测试人员无有效企业微信UserId");
      const [{id:batchId}]=await m.query("SELECT uuidv7() AS id");
      const [rule]=await m.query("SELECT id FROM notification_rules WHERE tenant_id=$1 AND rule_key=$2",[actor.tenantId,ALLOCATION_RULE_KEY]);
      const sample={id:batchId,order_number:"PMC-DELIVERY-TEST",order_sequence:"001",item_code:"00001",item_name:"订单分配通知受控测试",order_quantity:"1",allocated_quantity:"1",salesperson_name:user.display_name,remark:"仅验证文本和三个工作表的XLSX投递，不写入订单"};
      const change=allocationChange(null,sample);change.after.divisionName="测试范围";
      const result=await this.notifications.enqueueEvent(actor.tenantId,{eventType:ALLOCATION_EVENT,ruleId:rule.id,channel:"WECHAT_WORK",dedupKey:`allocation-test:${batchId}`,createdBy:actor.userId,payload:{batchId,actorUserId:actor.userId,actorName:actor.username,occurredAt:new Date().toISOString(),changes:[change],deliveryMode:"TEST",testRecipientUserId:userId}},m);
      await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,action,resource,record_id,after_json,request_id,source) VALUES($1,$2::uuid,$3,'order-allocation.notification.test','mps-order-allocations',$4,$5::jsonb,$6,'web')`,[actor.tenantId,actor.userId,actor.username,result.row.id,JSON.stringify({batchId,testRecipientUserId:userId}),actor.requestId]);
      return {batchId,outboxId:result.row.id,recipient:user.display_name};
    });
  }

  async save(kind: string, input: Record<string,unknown>, actor: MasterPlanActor) {
    this.assertAdmin(actor);
    if(!["vendors","recipients","rule"].includes(kind)) throw new BadRequestException("配置类型无效");
    return this.db.transaction(async m=>{
      await this.seed(actor.tenantId,actor.userId!,m);
      const table=kind==="vendors"?"mps_allocation_vendor_mappings":kind==="recipients"?"mps_allocation_recipients":"notification_rules";
      const id=String(input.id??""); if(id&&!uuid.test(id)) throw new BadRequestException("记录ID无效");
      const [before]=await m.query(`SELECT * FROM ${table} WHERE tenant_id=$1 AND ${kind==="rule"?"rule_key=$2":"id=$2::uuid"} FOR UPDATE`,[actor.tenantId,kind==="rule"?ALLOCATION_RULE_KEY:id||null]);
      if(before&&Number(input.expectedVersion)!==Number(before.version)) throw new ConflictException("配置已被修改，请刷新后重试");
      if(!before&&(id||kind==="rule")) throw new BadRequestException("配置不存在或不属于当前租户");
      if(typeof input.enabled!=="boolean") throw new BadRequestException("enabled必须为布尔值");
      const values: Record<string,unknown>={enabled:input.enabled};
      if(kind!=="rule") {
        const divisionId=String(input.divisionId??before?.division_id??""); if(!uuid.test(divisionId))throw new BadRequestException("承接单位无效");
        const [unit]=await m.query("SELECT id,name,enabled FROM organization_units WHERE id=$1::uuid",[divisionId]);if(!unit||(input.enabled&&!unit.enabled))throw new BadRequestException("承接组织不存在或已停用");
        const targetError=kind==="vendors"&&input.enabled?allocationVendorTargetError(String(input.supplierName??"").trim(),unit):null;if(targetError)throw new BadRequestException(targetError);values.division_id=divisionId;
      }
      if(kind==="vendors") {const name=String(input.supplierName??"").trim();if(!name||name.length>255)throw new BadRequestException("供应商名称无效");values.supplier_name=name;}
      if(kind==="recipients") {
        if(!Array.isArray(input.userIds)||input.userIds.some(id=>!uuid.test(String(id))))throw new BadRequestException("员工ID无效");
        const ids=[...new Set(input.userIds.map(String))];const users=ids.length?await m.query("SELECT id FROM users WHERE tenant_id=$1 AND enabled=true AND id=ANY($2::uuid[])",[actor.tenantId,ids]):[];
        if(users.length!==ids.length)throw new BadRequestException("接收人包含禁用、不存在或其他租户员工");values.user_ids=JSON.stringify(ids);
      }
      const entries=Object.entries(values);let after;
      if(before) { const result=await m.query(`UPDATE ${table} SET ${entries.map(([k],i)=>`${k}=$${i+4}`).join(',')},updated_by=$3::uuid,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2::uuid RETURNING *`,[actor.tenantId,before.id,actor.userId,...entries.map(([,v])=>v)]);after=Array.isArray(result[0])?result[0][0]:result[0]; }
      else { [after]=await m.query(`INSERT INTO ${table}(tenant_id,created_by,updated_by,${entries.map(([k])=>k).join(',')}) VALUES($1,$2::uuid,$2::uuid,${entries.map((_,i)=>`$${i+3}`).join(',')}) RETURNING *`,[actor.tenantId,actor.userId,...entries.map(([,v])=>v)]); }
      await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,action,resource,record_id,before_json,after_json,request_id,source,created_by,updated_by) VALUES($7,$1::uuid,$8,$2,'mps-order-allocations',$3,$4::jsonb,$5::jsonb,$6,'web',$1::uuid,$1::uuid)`,[actor.userId,`order-allocation.config.${kind}`,after.id,JSON.stringify(before??null),JSON.stringify(after),actor.requestId,actor.tenantId,actor.username]);
      if(kind==="vendors"&&after.enabled)await this.ensureRecipient(m,actor.tenantId,actor.userId!,after.division_id);
      return after;
    }).catch(error=>{if((error?.driverError?.code??error?.code)==="23505")throw new ConflictException("该映射或接收单位已存在，请刷新后编辑现有配置");throw error;});
  }
  private async ensureRecipient(m:EntityManager,tenantId:string,actorId:string,divisionId:string) {
    const rows=await m.query(`INSERT INTO mps_allocation_recipients(tenant_id,division_id,created_by,updated_by) VALUES($1,$2::uuid,$3::uuid,$3::uuid) ON CONFLICT(tenant_id,division_id) DO NOTHING RETURNING *`,[tenantId,divisionId,actorId]);
    if(rows[0])await this.seedAudit(m,tenantId,actorId,"recipients",rows[0]);
  }
  private seedAudit(m:EntityManager,tenantId:string,actorId:string,kind:string,row:Record<string,unknown>) {
    return m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,after_json,request_id,source,created_by,updated_by) VALUES($1,$2::uuid,'配置初始化','mps-order-allocations',$3,$4,$5::jsonb,$6,'api',$2::uuid,$2::uuid)`,[tenantId,actorId,row.id,`order-allocation.config.seed.${kind}`,JSON.stringify(row),`allocation-config-seed:${tenantId}`]);
  }
}

export type AllocationMappingIssue={code:string;supplierName:string;mappingId?:string;message:string};
export function allocationMappingIssues(units:Array<{id:string;name:string;enabled:boolean}>,vendors:Array<{id:string;supplier_name:string;division_id:string;enabled:boolean}>):AllocationMappingIssue[] {
  const issues:AllocationMappingIssue[]=[];
  for(const [supplier,name] of ALLOCATION_VENDOR_SEEDS)if(!vendors.some(v=>v.supplier_name===supplier)){
    const candidates=units.filter(u=>u.enabled&&u.name===name);
    const exact=units.filter(u=>u.name===name);
    const reason=candidates.length>1?`承接组织“${name}”存在重名，请按完整路径选择正确组织`:candidates.length===1?`请建立到“${name}”的映射`:exact.length?`承接组织“${name}”已停用`:units.some(u=>u.name.trim()===name)?`组织名称“${name}”有前后空格，请按完整路径选择现有组织`:`组织架构中不存在“${name}”，请确认现有组织`;
    issues.push({code:"MISSING_MAPPING",supplierName:supplier,message:`缺少映射：${reason}`});
  }
  for(const vendor of vendors){
    if(!vendor.enabled)issues.push({code:"DISABLED_MAPPING",supplierName:vendor.supplier_name,mappingId:vendor.id,message:"映射已停用，请核实后启用"});
    const unit=units.find(u=>u.id===vendor.division_id);
    if(!unit?.enabled)issues.push({code:"INVALID_ORGANIZATION",supplierName:vendor.supplier_name,mappingId:vendor.id,message:"承接组织不存在或已停用，请选择有效组织"});
    else {const error=allocationVendorTargetError(vendor.supplier_name,unit);if(error)issues.push({code:"INVALID_ORGANIZATION",supplierName:vendor.supplier_name,mappingId:vendor.id,message:error});}
  }
  return issues;
}
