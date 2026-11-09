import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { reviewDueDateSnapshot, assertReviewDueDivision, reviewDueDateBusinessKey, type ReviewDueDateSnapshot } from './review-due-date.domain';
import { reviewDueDateEditableKeys, reviewDueDateRequiredCreateKeys, reviewDueDateResource as RESOURCE } from '@kdos/contracts';
import { reviewDueColumns, reviewDueScope } from './review-due-date.query.service';
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, hasReviewDueCreateFieldPermission } from './master-plan.types';
import type { MasterPlanActor } from './master-plan.types';
import { OrganizationDirectoryService } from '../organization-directory/organization-directory.service';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const code=(error:unknown)=>(error as {driverError?:{code?:string};code?:string})?.driverError?.code??(error as {code?:string})?.code;
export type ReviewDueDateBulkImportRequest={commandId:string;rows:Array<{row:number;values:Record<string,unknown>}>};
export type ReviewDueDateBulkImportResponse={batchId:string;total:number;succeeded:number;failed:number;atomic:true;repeated:boolean;errors:Array<{row:number;reason:string}>;records:Array<{row:number;id:string;version:number}>};

/** Manual writes use record ID; this table has no external source observation path. */
@Injectable()
export class ReviewDueDateApplicationService {
  constructor(private readonly db:DataSource,private readonly directory:OrganizationDirectoryService) {}

  private rowSnapshot(row:Record<string,any>):ReviewDueDateSnapshot {
    return reviewDueDateSnapshot(Object.fromEntries(reviewDueDateEditableKeys.map(key=>[key,key==='inboundDate'?row.date_text:row[reviewDueColumns[key]]])) as ReviewDueDateSnapshot);
  }

  private async snapshot(input:Record<string,unknown>):Promise<ReviewDueDateSnapshot> {
    const options=await this.directory.listEnabled();
    const division=assertReviewDueDivision(this.directory.resolve(input.divisionId,options,'事业部'),options);
    return reviewDueDateSnapshot({...input,divisionId:division.id,inspectionTimeName:input.inspectionTimeName??null} as ReviewDueDateSnapshot);
  }

  async manualCreate(body:Record<string,unknown>,actor:MasterPlanActor) {
    if(!actor.userId||!actor.tenantId||!hasMasterPlanPermission(actor,RESOURCE,'create'))throw new ForbiddenException('当前权限组没有评审交期表新增权限');
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='commandId'&&!reviewDueDateEditableKeys.includes(key)))throw new BadRequestException('新增只允许填写业务字段，系统审计及来源字段由服务端生成');
    const submitted=Object.keys(body).filter(key=>key!=='commandId');
    for(const key of new Set([...reviewDueDateRequiredCreateKeys,...submitted]))if(!hasReviewDueCreateFieldPermission(actor,key))throw new ForbiddenException('没有字段填写权限：'+key);
    if(typeof body.commandId!=='string'||!uuid.test(body.commandId))throw new BadRequestException('commandId 必须为唯一请求UUID');
    let snapshot:ReviewDueDateSnapshot;
    try{snapshot=await this.snapshot(body);}catch(error){throw new BadRequestException((error as Error).message);}
    const hash=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    const receiptKey=JSON.stringify(['review-due-manual-create',actor.tenantId,actor.userId,body.commandId]);
    try{return await this.db.transaction(async m=>{
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['review-due-write',actor.tenantId])]);
      const [member]=await m.query('SELECT id FROM users WHERE tenant_id=$1 AND id=$2::uuid AND enabled',[actor.tenantId,actor.userId]);
      if(!member)throw new ForbiddenException('操作人不是当前租户有效登录用户');
      const p:unknown[]=[actor.tenantId,snapshot.divisionId,snapshot.orderNumber,snapshot.batchNumber,snapshot.drawingNumber,snapshot.orderDate,snapshot.inspectionTimeName,snapshot.productReviewDueDate,snapshot.inboundDate,snapshot.quantity,actor.userId];
      const scope=reviewDueScope(actor,p,'create');
      const [candidate]=await m.query(`SELECT record.id FROM (SELECT uuidv7() id,$1::varchar tenant_id,$2::uuid division_id,$3::text order_number,$4::text batch_number,$5::text drawing_number,
        $6::date order_date,$7::text inspection_time_name,$8::date customer_due_date,$9::date inbound_date,$10::numeric quantity,
        $11::uuid created_by,$11::uuid updated_by,now() created_at,now() updated_at,1 version) record WHERE ${scope}`,p);
      if(!candidate)throw new ForbiddenException('当前数据范围不允许新增该事业部的评审交期记录');
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[receiptKey]);
      const [receipt]=await m.query('SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1',[receiptKey]);
      if(receipt){if(receipt.request_hash!==hash)throw new ConflictException('同一新增请求不能提交不同内容');return {...receipt.response_json,repeated:true};}
      const [row]=await m.query(`INSERT INTO mps_review_due_dates(id,tenant_id,division_id,order_number,batch_number,drawing_number,order_date,inspection_time_name,customer_due_date,inbound_date,quantity,created_by,updated_by)
        VALUES($1::uuid,$2,$3::uuid,$4,$5,$6,$7::date,$8,$9::date,$10::date,$11::numeric,$12::uuid,$12::uuid) RETURNING *`,[candidate.id,actor.tenantId,snapshot.divisionId,snapshot.orderNumber,snapshot.batchNumber,snapshot.drawingNumber,snapshot.orderDate,snapshot.inspectionTimeName,snapshot.productReviewDueDate,snapshot.inboundDate,snapshot.quantity,actor.userId]);
      await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5,'review_due_date.manually_created',NULL,$6::jsonb,$7,'web',$2::uuid,$2::uuid)`,[actor.tenantId,actor.userId,actor.username,RESOURCE,row.id,JSON.stringify({...row,sourceKind:'MANUAL',commandId:body.commandId}),actor.requestId]);
      const result={id:row.id,version:row.version,repeated:false};
      await m.query('INSERT INTO idempotency_keys(id,key,request_hash,response_json,created_by,updated_by) VALUES(uuidv7(),$1,$2,$3::jsonb,$4::uuid,$4::uuid)',[receiptKey,hash,JSON.stringify(result),actor.userId]);
      return result;
    });}catch(error){if(code(error)==='23505')throw new ConflictException('同一事业部的订单号、批次号、品项编码或保留来源身份已存在，请返回列表修改');throw error;}
  }

  /** Atomic JSON import. Validation failures return every failing row and write no business rows. */
  async bulkImport(body:ReviewDueDateBulkImportRequest,actor:MasterPlanActor):Promise<ReviewDueDateBulkImportResponse> {
    if(!actor.userId||!actor.tenantId||!hasMasterPlanPermission(actor,RESOURCE,'import')||!hasMasterPlanPermission(actor,RESOURCE,'create'))throw new ForbiddenException('当前权限组没有评审交期表新增导入权限');
    if(!body||typeof body!=='object'||!uuid.test(body.commandId)||!Array.isArray(body.rows)||body.rows.length<1||body.rows.length>500)throw new BadRequestException('批量导入要求commandId和1至500条记录');
    const rowNumbers=new Set<number>();
    for(const row of body.rows){if(!row||!Number.isSafeInteger(row.row)||row.row<1||rowNumbers.has(row.row)||!row.values||typeof row.values!=='object'||Array.isArray(row.values))throw new BadRequestException('每条记录必须有唯一正整数row和JSON values对象');rowNumbers.add(row.row);}
    const hash=createHash('sha256').update(JSON.stringify(body.rows)).digest('hex');
    const key=JSON.stringify(['review-due-json-import',actor.tenantId,actor.userId,body.commandId]);
    const options=await this.directory.listEnabled();
    return this.db.transaction(async m=>{
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['review-due-write',actor.tenantId])]);
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);
      const [member]=await m.query('SELECT id FROM users WHERE tenant_id=$1 AND id=$2::uuid AND enabled',[actor.tenantId,actor.userId]);
      if(!member)throw new ForbiddenException('操作人不是当前租户有效登录用户');
      const [receipt]=await m.query('SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1',[key]);
      if(receipt){if(receipt.request_hash!==hash)throw new ConflictException('同一commandId不能提交不同批量内容');return {...receipt.response_json,repeated:true};}
      const errors:Array<{row:number;reason:string}>=[],prepared:Array<{row:number;snapshot:ReviewDueDateSnapshot}>=[],seen=new Set<string>();
      for(const input of body.rows){try{
        const values=input.values;
        if(Object.keys(values).some(k=>!reviewDueDateEditableKeys.includes(k)))throw new BadRequestException('包含不可导入字段或系统字段');
        for(const k of new Set([...reviewDueDateRequiredCreateKeys,...Object.keys(values)]))if(!hasReviewDueCreateFieldPermission(actor,k))throw new ForbiddenException('没有新增字段填写权限：'+k);
        for(const k of reviewDueDateRequiredCreateKeys)if(!Object.hasOwn(values,k))throw new BadRequestException(`缺少必填字段：${k}`);
        const division=assertReviewDueDivision(this.directory.resolve(values.divisionId,options,'事业部'),options);
        const snapshot=reviewDueDateSnapshot({...values,divisionId:division.id} as ReviewDueDateSnapshot);
        const businessKey=reviewDueDateBusinessKey(snapshot);if(seen.has(businessKey))throw new ConflictException('批次中存在重复的事业部、订单号、批次号和品项编码');seen.add(businessKey);
        const candidate={tenant_id:actor.tenantId,division_id:snapshot.divisionId,order_number:snapshot.orderNumber,batch_number:snapshot.batchNumber,drawing_number:snapshot.drawingNumber,order_date:snapshot.orderDate??null,inspection_time_name:snapshot.inspectionTimeName??null,customer_due_date:snapshot.productReviewDueDate??null,inbound_date:snapshot.inboundDate??null,quantity:snapshot.quantity};
        const params:unknown[]=[JSON.stringify(candidate)],scope=reviewDueScope(actor,params,'create');
        if(!(await m.query(`SELECT 1 FROM jsonb_populate_record(NULL::mps_review_due_dates,$1::jsonb) record WHERE ${scope}`,params)).length)throw new ForbiddenException('当前数据范围不允许导入该事业部记录');
        prepared.push({row:input.row,snapshot});
      }catch(e){if(e instanceof ForbiddenException)throw e;errors.push({row:input.row,reason:(e as Error).message});}}
      if(!errors.length)for(const item of prepared){const s=item.snapshot;const duplicate=await m.query(`SELECT 1 FROM mps_review_due_dates WHERE tenant_id=$1 AND division_id=$2::uuid AND order_number=$3 AND batch_number=$4 AND drawing_number=$5 LIMIT 1`,[actor.tenantId,s.divisionId,s.orderNumber,s.batchNumber,s.drawingNumber]);if(duplicate.length)errors.push({row:item.row,reason:'同一事业部、订单号、批次号和品项编码已存在'});}
      if(errors.length){const rejected=new Set(errors.map(error=>error.row));for(const item of prepared)if(!rejected.has(item.row))errors.push({row:item.row,reason:'原子批次中其他行校验失败；本批没有写入'});errors.sort((a,b)=>a.row-b.row);}
      const records:Array<{row:number;id:string;version:number}>=[];
      if(!errors.length)for(const item of prepared){const s=item.snapshot;const [saved]=await m.query(`INSERT INTO mps_review_due_dates(tenant_id,division_id,order_number,batch_number,drawing_number,order_date,inspection_time_name,customer_due_date,inbound_date,quantity,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5,$6::date,$7,$8::date,$9::date,$10::numeric,$11::uuid,$11::uuid) RETURNING id,version`,[actor.tenantId,s.divisionId,s.orderNumber,s.batchNumber,s.drawingNumber,s.orderDate??null,s.inspectionTimeName,s.productReviewDueDate,s.inboundDate,s.quantity,actor.userId]);
        records.push({row:item.row,id:saved.id,version:Number(saved.version)});
        await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
          VALUES($1,$2::uuid,$3,$4,$5,'review_due_date.json_import_created',NULL,$6::jsonb,$7,'api',$2::uuid,$2::uuid)`,[actor.tenantId,actor.userId,actor.username,RESOURCE,saved.id,JSON.stringify({batchId:body.commandId,row:item.row,values:s}),actor.requestId]);}
      const response:ReviewDueDateBulkImportResponse={batchId:body.commandId,total:body.rows.length,succeeded:records.length,failed:body.rows.length-records.length,atomic:true,repeated:false,errors,records};
      await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,after_json,request_id,source,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5,$6,$7::jsonb,$8,'api',$2::uuid,$2::uuid)`,[actor.tenantId,actor.userId,actor.username,RESOURCE,body.commandId,errors.length?'review_due_date.json_import_rejected':'review_due_date.json_import_confirmed',JSON.stringify({total:response.total,succeeded:response.succeeded,failed:response.failed,errors}),actor.requestId]);
      await m.query('INSERT INTO idempotency_keys(id,key,request_hash,response_json,created_by,updated_by) VALUES(uuidv7(),$1,$2,$3::jsonb,$4::uuid,$4::uuid)',[key,hash,JSON.stringify(response),actor.userId]);
      return response;
    });
  }

  async manualEdit(id:string,body:Record<string,unknown>,actor:MasterPlanActor) {
    if(!actor.userId||!hasMasterPlanPermission(actor,RESOURCE,'read')||!hasMasterPlanPermission(actor,RESOURCE,'update'))throw new ForbiddenException('当前权限组没有评审交期表修改权限');
    if(!uuid.test(id))throw new BadRequestException('评审交期记录ID无效');
    if(!body||typeof body!=='object'||Array.isArray(body))throw new BadRequestException('人工编辑请求无效');
    const keys=Object.keys(body).filter(key=>!['expectedVersion','commandId'].includes(key));
    if(!keys.length||keys.some(key=>!reviewDueDateEditableKeys.includes(key)))throw new BadRequestException('只允许修改业务字段，系统审计、来源身份和版本不可写入');
    for(const key of keys)if(!hasMasterPlanFieldPermission(actor,RESOURCE,key,'read')||!hasMasterPlanFieldPermission(actor,RESOURCE,key,'update'))throw new ForbiddenException('没有字段修改权限：'+key);
    if(typeof body.expectedVersion!=='number'||!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1)throw new BadRequestException('expectedVersion 必须是正整数');
    if(typeof body.commandId!=='string'||!uuid.test(body.commandId))throw new BadRequestException('commandId 必须为唯一请求UUID');
    const hash=createHash('sha256').update(JSON.stringify([body.expectedVersion,...keys.sort().map(key=>[key,body[key]])])).digest('hex');
    const receiptKey=JSON.stringify(['review-due-manual',actor.tenantId,actor.userId,id,body.commandId]);
    try{return await this.db.transaction(async m=>{
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['review-due-write',actor.tenantId])]);
      const [member]=await m.query('SELECT id FROM users WHERE tenant_id=$1 AND id=$2::uuid AND enabled',[actor.tenantId,actor.userId]);
      if(!member)throw new ForbiddenException('操作人不是当前租户有效登录用户');
      const [current]=await m.query('SELECT *,inbound_date::text date_text FROM mps_review_due_dates WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE',[actor.tenantId,id]);
      if(!current)throw new NotFoundException('评审交期记录不存在或不在当前租户');
      const assertScope=async()=>{const p:unknown[]=[actor.tenantId,id],scope=`(${reviewDueScope(actor,p,'read')}) AND (${reviewDueScope(actor,p,'update')})`;if(!(await m.query(`SELECT record.id FROM mps_review_due_dates record WHERE record.tenant_id=$1 AND record.id=$2::uuid AND ${scope}`,p)).length)throw new ForbiddenException('当前数据范围不允许修改该记录或修改后的内容');};
      await assertScope();
      const [receipt]=await m.query('SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1',[receiptKey]);
      if(receipt){if(receipt.request_hash!==hash)throw new ConflictException('同一人工编辑请求不能提交不同内容');return {...receipt.response_json,repeated:true};}
      if(current.version!==body.expectedVersion)throw new ConflictException('评审交期版本已变化，请刷新后重试');
      const before=this.rowSnapshot(current);let next:ReviewDueDateSnapshot;
      try{next=await this.snapshot({...before,...Object.fromEntries(keys.map(key=>[key,body[key]]))});}catch(error){throw new BadRequestException((error as Error).message);}
      const changed=reviewDueDateEditableKeys.filter(key=>String(before[key as keyof ReviewDueDateSnapshot]??'')!==String(next[key as keyof ReviewDueDateSnapshot]??''));
      const duplicates=await m.query(`SELECT id FROM mps_review_due_dates WHERE tenant_id=$1 AND id<>$2::uuid AND
        division_id=$3::uuid AND order_number=$4 AND batch_number=$5 AND drawing_number=$6 LIMIT 1`,[actor.tenantId,id,next.divisionId,next.orderNumber,next.batchNumber,next.drawingNumber]);
      if(duplicates.length)throw new ConflictException('同一事业部的订单号、批次号和品项编码已存在，不能合并记录');
      if(!changed.length){const result={id,version:current.version,dateChanged:false,changedFields:[],repeated:false};await m.query('INSERT INTO idempotency_keys(id,key,request_hash,response_json,created_by,updated_by) VALUES(uuidv7(),$1,$2,$3::jsonb,$4::uuid,$4::uuid)',[receiptKey,hash,JSON.stringify(result),actor.userId]);return result;}
      const [{at}]=await m.query('SELECT clock_timestamp()::text at');
      const updated=await m.query(`UPDATE mps_review_due_dates SET division_id=$3::uuid,order_number=$4,batch_number=$5,drawing_number=$6,order_date=$7::date,inspection_time_name=$8,
        customer_due_date=$9::date,inbound_date=$10::date,quantity=$11::numeric,updated_at=$12::timestamptz,updated_by=$13::uuid,version=version+1
        WHERE tenant_id=$1 AND id=$2::uuid AND version=$14 RETURNING *`,[actor.tenantId,id,next.divisionId,next.orderNumber,next.batchNumber,next.drawingNumber,next.orderDate,next.inspectionTimeName,next.productReviewDueDate,next.inboundDate,next.quantity,at,actor.userId,body.expectedVersion]);
      const row=Array.isArray(updated[0])?updated[0][0]:updated[0];if(!row)throw new ConflictException('评审交期版本已变化，请刷新后重试');
      await assertScope();
      await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5,'review_due_date.manually_updated',$6::jsonb,$7::jsonb,$8,'web',$2::uuid,$2::uuid)`,[actor.tenantId,actor.userId,actor.username,RESOURCE,id,JSON.stringify(current),JSON.stringify({...row,commandId:body.commandId,sourceKind:'MANUAL',changedFields:changed}),actor.requestId]);
      const result={id,version:row.version,dateChanged:changed.includes('inboundDate'),changedFields:changed,repeated:false};
      await m.query('INSERT INTO idempotency_keys(id,key,request_hash,response_json,created_by,updated_by) VALUES(uuidv7(),$1,$2,$3::jsonb,$4::uuid,$4::uuid)',[receiptKey,hash,JSON.stringify(result),actor.userId]);return result;
    });}catch(error){if(code(error)==='23514')throw new ConflictException('评审身份或批次已有受保护关联，不能普通修改');if(code(error)==='23505')throw new ConflictException('同一事业部的订单号、批次号和品项编码已存在，不能合并记录');throw error;}
  }

}
