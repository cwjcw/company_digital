import { ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { DataSource, EntityManager } from "typeorm";
import { ALLOCATION_FIELDS, type AllocationChange } from "../master-plan-system/order-allocation.domain";
import { resolveAllocationRoutes, type AllocationRoute } from "./order-allocation.routing";
import type { NotificationClaim } from "./notification.types";

export function allocationSummary(route: AllocationRoute, payload: Record<string,unknown>) {
  const created=route.changes.filter(c=>!c.before).length, updated=route.changes.length-created;
  const time=new Date(String(payload.occurredAt)).toLocaleString("sv-SE",{timeZone:"Asia/Shanghai"});
  return `【PMC订单分配通知】\n\n接收范围：${route.identities.join("、")}\n操作人：${payload.actorName}\n操作时间：${time}\n本次新增：${created}条\n本次变更：${updated}条\n详细内容请查看Excel附件。`;
}
export async function allocationWorkbook(changes:AllocationChange[],actorName:string,occurredAt:string) {
  const book=new ExcelJS.Workbook();book.creator="KDOS";
  const safe=(v:unknown)=>{if(v==null)return "";const s=String(v);return /^[=+\-@\t\r]/.test(s)?`'${s}`:s;};
  const display=(key:string,value:unknown)=>{
    if(value==null)return null;
    if(ALLOCATION_FIELDS.find(f=>f[0]===key)?.[2]==="date")return new Date(`${String(value).slice(0,10)}T00:00:00Z`);
    return safe(value); // explicit text keeps codes and exact decimals; no formula objects
  };
  for(const [name,rows] of [["新增订单",changes.filter(c=>!c.before)],["变更后数据",changes.filter(c=>c.before)]] as const) {
    const sheet=book.addWorksheet(name);sheet.columns=ALLOCATION_FIELDS.map(([key,label,type])=>({header:label,key,width:type==="date"?16:22,...(type==="date"?{style:{numFmt:"yyyy-mm-dd"}}:{})}));
    for(const change of rows) sheet.addRow(Object.fromEntries(ALLOCATION_FIELDS.map(([key])=>[key,display(key,key==="divisionId"?change.after.divisionName??change.after[key]:change.after[key])])));
  }
  const detail=book.addWorksheet("字段变更明细");
  detail.columns=["订单单号","订单序号","品号","业务员（前）","业务员（后）","承接事业部（前）","承接事业部（后）","变更字段","变更前","变更后","变更类型","操作人","操作时间"].map(header=>({header,width:24}));
  for(const c of changes)for(const f of c.fields)detail.addRow([c.after.orderNumber,c.after.orderSequence,c.after.itemCode,c.before?.salespersonName,c.after.salespersonName,c.before?.divisionName??c.before?.divisionId,c.after.divisionName??c.after.divisionId,f.label,f.key==="divisionId"?c.before?.divisionName??f.before:f.before,f.key==="divisionId"?c.after.divisionName??f.after:f.after,c.before?"变更":"新增",actorName,new Date(occurredAt).toLocaleString("sv-SE",{timeZone:"Asia/Shanghai"})].map(safe));
  for(const sheet of book.worksheets){sheet.views=[{state:"frozen",ySplit:1}];sheet.getRow(1).font={bold:true};sheet.autoFilter={from:"A1",to:sheet.getRow(1).getCell(sheet.columnCount).address};}
  return Buffer.from(await book.xlsx.writeBuffer());
}
export async function allocationWorkbookParts(changes:AllocationChange[],actorName:string,occurredAt:string):Promise<Buffer[]> {
  const content=await allocationWorkbook(changes,actorName,occurredAt);
  if(content.length<=20*1024*1024)return [content];
  if(changes.length<2)throw new ConflictException("单条订单附件超出企业微信限制，请复核字段长度");
  const middle=Math.ceil(changes.length/2);
  return [...await allocationWorkbookParts(changes.slice(0,middle),actorName,occurredAt),...await allocationWorkbookParts(changes.slice(middle),actorName,occurredAt)];
}
@Injectable()
export class OrderAllocationDeliveryService {
  constructor(private readonly db:DataSource) {}
  async prepare(m:EntityManager,tenantId:string,outbox:Record<string,unknown>,workerId:string):Promise<NotificationClaim[]> {
    const payload=outbox.payload as Record<string,unknown>;
    const changes=payload.changes as AllocationChange[];
    if(!Array.isArray(changes)||!changes.length)throw new ConflictException("订单分配通知缺少变更快照");
    let routing=await resolveAllocationRoutes(m,tenantId,changes);
    if(payload.deliveryMode === "TEST") {
      const [user]=await m.query("SELECT id,display_name,wechat_user_id FROM users WHERE tenant_id=$1 AND id=$2::uuid AND enabled=true",[tenantId,payload.testRecipientUserId]);
      if(!user||!String(user.wechat_user_id??'').trim())throw new ConflictException("测试接收人员已失效");
      routing={recipients:[{userId:user.id,displayName:user.display_name,wechatUserId:user.wechat_user_id,enabled:true,changes,identities:["受控测试（不写订单）"]}],errors:[]};
    }
    if(payload.deliveryMode !== "TEST") {
      if(Array.isArray(payload.routes)) {
        const users=await m.query("SELECT id,display_name,wechat_user_id,enabled FROM users WHERE tenant_id=$1",[tenantId]);
        const errors=[...(payload.routingErrors as string[]??[])];
        const recipients:AllocationRoute[]=[];
        for(const saved of payload.routes as AllocationRoute[]) {
          const user=users.find((u:{id:string})=>u.id===saved.userId);
          if(!user||user.enabled!==true){errors.push(`接收员工 ${saved.displayName} 已禁用或不属于当前租户`);continue;}
          const wechatUserId=String(user.wechat_user_id??'').trim();if(!wechatUserId)errors.push(`员工 ${saved.displayName} 缺少企业微信UserId`);
          recipients.push({...saved,wechatUserId});
        }
        routing={recipients,errors};
      } else {
        const routes=routing.recipients.map(r=>({userId:r.userId,displayName:r.displayName,enabled:r.enabled,changes:r.changes,identities:r.identities}));
        await m.query("UPDATE notification_outbox SET payload=payload || $3::jsonb WHERE tenant_id=$1 AND id=$2::uuid",[tenantId,outbox.id,JSON.stringify({routes,routingErrors:routing.errors})]);
      }
    }
    if(routing.errors.length) {
      const [existing]=await m.query("SELECT id FROM notification_delivery_logs WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid AND component='routing' AND status='FAILED'",[tenantId,outbox.id]);
      if(!existing)await m.query(`INSERT INTO notification_delivery_logs(tenant_id,notification_outbox_id,attempt,status,component,errcode,errmsg,error_message) VALUES($1,$2::uuid,$3,'FAILED','routing','ALLOCATION_ROUTING_FAILED',$4,$4)`,[tenantId,outbox.id,outbox.attempts,routing.errors.join("；").slice(0,4000)]);
    } else await m.query("UPDATE notification_delivery_logs SET status='SKIPPED',errcode='ROUTING_RESOLVED',errmsg='配置异常已解决' WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid AND component='routing' AND status='FAILED'",[tenantId,outbox.id]);
    const claims:NotificationClaim[]=[];
    for(const route of routing.recipients) {
      if(!route.wechatUserId)continue;
      const attachments=await m.query("SELECT id,filename,part FROM notification_attachments WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid AND recipient_user_id=$3::uuid ORDER BY part",[tenantId,outbox.id,route.userId]);
      if(!attachments.length) {
        const parts=await allocationWorkbookParts(route.changes,String(payload.actorName),String(payload.occurredAt));
        for(const [index,content] of parts.entries()) {
          const filename=`PMC_Order_Changes_${String(payload.batchId).replace(/-/g,"")}_${route.userId.replace(/-/g,"")}_P${index+1}.xlsx`;
          const [attachment]=await m.query(`INSERT INTO notification_attachments(tenant_id,notification_outbox_id,recipient_user_id,filename,part,content,sha256) VALUES($1,$2::uuid,$3::uuid,$4,$5,$6,$7) RETURNING id,filename,part`,[tenantId,outbox.id,route.userId,filename,index+1,content,createHash("sha256").update(content).digest("hex")]);attachments.push(attachment);
        }
      }
      const components=[{component:"text",attachment:null},...attachments.map((attachment:{id:string;filename:string;part:number})=>({component:`file:${attachment.part}`,attachment}))];
      for(const {component,attachment} of components) {
        const [previous]=await m.query(`SELECT * FROM notification_delivery_logs WHERE tenant_id=$1 AND notification_outbox_id=$2::uuid AND recipient_user_id=$3::uuid AND component=$4 ORDER BY attempt DESC,id DESC LIMIT 1`,[tenantId,outbox.id,route.userId,component]);
        if(previous?.status==="SENT")continue;
        let delivery=previous;
        if(!previous||!["PENDING","PROCESSING"].includes(previous.status)) [delivery]=await m.query(`INSERT INTO notification_delivery_logs(tenant_id,notification_outbox_id,recipient_user_id,wechat_user_id,attempt,status,component,attachment_id) VALUES($1,$2::uuid,$3::uuid,$4,$5,'PENDING',$6,$7::uuid) RETURNING *`,[tenantId,outbox.id,route.userId,route.wechatUserId,Number(previous?.attempt??0)+1,component,attachment?.id??null]);
        claims.push({notificationId:String(outbox.id),messageType:attachment?"file":"text",content:allocationSummary(route,payload),...(attachment?{attachment:{id:attachment.id,filename:attachment.filename,downloadPath:`/internal/notifications/${outbox.id}/attachments/${attachment.id}`}}:{}),recipients:[{deliveryId:delivery.id,userId:route.userId,displayName:route.displayName,wechatUserId:route.wechatUserId}]});
      }
    }
    if(!claims.length)await m.query(`UPDATE notification_outbox SET status=$4,locked_by=NULL,locked_at=NULL,next_retry_at=NULL,last_error=$5,sent_at=CASE WHEN $4='SENT' THEN now() ELSE sent_at END,version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND locked_by=$3`,[tenantId,outbox.id,workerId,routing.errors.length?"FAILED":"SENT",routing.errors.length?routing.errors.join("；").slice(0,4000):null]);
    return claims;
  }
  async attachment(tenantId:string,outboxId:string,attachmentId:string,workerId:string) {
    return this.db.transaction(async m=>{
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[tenantId]);
      const [row]=await m.query(`SELECT a.filename,a.content,a.sha256 FROM notification_attachments a JOIN notification_outbox b ON b.id=a.notification_outbox_id AND b.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND b.id=$2::uuid AND a.id=$3::uuid AND b.status='PROCESSING' AND b.locked_by=$4`,[tenantId,outboxId,attachmentId,workerId]);
      if(!row)throw new ConflictException("无权读取该通知附件或领取租约已失效");return row;
    });
  }
}
