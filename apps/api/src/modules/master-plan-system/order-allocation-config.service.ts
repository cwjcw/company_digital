import { BadRequestException, ConflictException, ForbiddenException, Injectable, OnModuleInit } from "@nestjs/common";
import { NotificationService } from "../notifications/notification.service";
import { allocationChange } from "./order-allocation.domain";
import { DataSource, EntityManager } from "typeorm";
import type { MasterPlanActor } from "./master-plan.types";
import { MASTER_PLAN_SYSTEM_USER_ID } from "./master-plan.sync.service";
export const ALLOCATION_EVENT = "mps.order_allocation.batch_changed";
export const ALLOCATION_RULE_KEY = "pmc-order-allocation-changes";
export const ALLOCATION_UNITS = ["事业一部", "事业二部", "事业三部", "事业四部", "采购部"];
export const ALLOCATION_VENDOR_SEEDS = [["事业一部","事业一部"],["事业二部","事业二部"],["厦门凯南智能制造有限公司","事业三部"],["厦门科加智能制造有限公司","事业四部"],["供应链","采购部"]];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
@Injectable()
export class OrderAllocationConfigService implements OnModuleInit {
  constructor(private readonly db: DataSource, private readonly notifications: NotificationService) {}
  async onModuleInit() { await this.seed(process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN", MASTER_PLAN_SYSTEM_USER_ID); }
  async seed(tenantId: string, actorId: string, manager?: EntityManager) {
    const work = async (m: EntityManager) => {
      await m.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      const units = await m.query("SELECT id,name FROM organization_units WHERE enabled=true AND name=ANY($1::text[])", [ALLOCATION_UNITS]);
      for (const [supplier, name] of ALLOCATION_VENDOR_SEEDS) {
        const matches = units.filter((u: { name:string })=>u.name===name); if(matches.length!==1) continue;
        await m.query(`INSERT INTO mps_allocation_vendor_mappings(tenant_id,supplier_name,division_id,created_by,updated_by) VALUES($1,$2,$3::uuid,$4::uuid,$4::uuid) ON CONFLICT(tenant_id,supplier_name) DO NOTHING`, [tenantId,supplier,matches[0].id,actorId]);
      }
      for (const name of ALLOCATION_UNITS) {
        const matches=units.filter((u:{name:string})=>u.name===name); if(matches.length!==1) continue;
        await m.query(`INSERT INTO mps_allocation_recipients(tenant_id,division_id,created_by,updated_by) VALUES($1,$2::uuid,$3::uuid,$3::uuid) ON CONFLICT(tenant_id,division_id) DO NOTHING`,[tenantId,matches[0].id,actorId]);
      }
      await m.query(`INSERT INTO notification_rules(tenant_id,rule_key,name,event_type,channel,module_code,resource,recipient_rule,enabled,config,created_by,updated_by) VALUES($1,$2,'PMC订单分配新增/变更通知',$3,'WECHAT_WORK','planning','mps-order-allocations','ORDER_ALLOCATION_DYNAMIC',false,'{"messageType":"text_file"}'::jsonb,$4::uuid,$4::uuid) ON CONFLICT(tenant_id,rule_key) DO NOTHING`,[tenantId,ALLOCATION_RULE_KEY,ALLOCATION_EVENT,actorId]);
    };
    return manager ? work(manager) : this.db.transaction(work);
  }
  assertAdmin(actor: MasterPlanActor) { if (!actor.userId || !(actor.isSystemAdmin || actor.moduleAdminCodes?.includes("planning") || actor.permissions.includes("*"))) throw new ForbiddenException("仅PMC管理员可管理订单分配通知配置"); }
  async read(actor: MasterPlanActor) {
    this.assertAdmin(actor);
    return this.db.transaction(async m=>{
      await this.seed(actor.tenantId,actor.userId!,m);
      const vendors=await m.query(`SELECT v.*,o.name AS "divisionName" FROM mps_allocation_vendor_mappings v JOIN organization_units o ON o.id=v.division_id WHERE v.tenant_id=$1 ORDER BY v.supplier_name`,[actor.tenantId]);
      const recipients=await m.query(`SELECT r.*,o.name AS "divisionName",o.enabled AS "unitEnabled" FROM mps_allocation_recipients r JOIN organization_units o ON o.id=r.division_id WHERE r.tenant_id=$1 ORDER BY o.name`,[actor.tenantId]);
      const [rule]=await m.query("SELECT * FROM notification_rules WHERE tenant_id=$1 AND rule_key=$2",[actor.tenantId,ALLOCATION_RULE_KEY]);
      const [last]=await m.query("SELECT max(d.delivered_at) AS time FROM notification_delivery_logs d JOIN notification_outbox b ON b.id=d.notification_outbox_id AND b.tenant_id=d.tenant_id WHERE d.tenant_id=$1 AND b.event_type=$2 AND d.status='SENT'",[actor.tenantId,ALLOCATION_EVENT]);
      const users=await m.query(`SELECT id,display_name AS "displayName",username,employee_no AS "employeeNo",enabled,(NULLIF(btrim(wechat_user_id),'') IS NOT NULL) AS "hasWechatId" FROM users WHERE tenant_id=$1 ORDER BY display_name,username`,[actor.tenantId]);
      return {vendors,recipients,rule,lastSentAt:last?.time,users,units:ALLOCATION_UNITS,complete:recipients.length===5&&recipients.every((r:{enabled:boolean;unitEnabled:boolean;user_ids:string[]})=>r.enabled&&r.unitEnabled&&r.user_ids.length>0&&r.user_ids.every(id=>users.some((u:{id:string;enabled:boolean;hasWechatId:boolean})=>u.id===id&&u.enabled&&u.hasWechatId)))};
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
      if(!before&&kind!=="vendors") throw new BadRequestException("配置不存在");
      if(typeof input.enabled!=="boolean") throw new BadRequestException("enabled必须为布尔值");
      const values: Record<string,unknown>={enabled:input.enabled};
      if(kind!=="rule") {
        const divisionId=String(input.divisionId??before?.division_id??""); if(!uuid.test(divisionId))throw new BadRequestException("承接单位无效");
        const [unit]=await m.query("SELECT id FROM organization_units WHERE id=$1::uuid AND enabled=true AND name=ANY($2::text[])",[divisionId,ALLOCATION_UNITS]);if(!unit)throw new BadRequestException("请选择五个有效承接单位之一"); values.division_id=divisionId;
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
      return after;
    });
  }
}
