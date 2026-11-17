import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { abnormalSeverityOptions, type AbnormalCostResource } from '@kdos/contracts';
import { OBJECT_STORAGE, type ObjectStorage } from '../../storage/object-storage';
import { NotificationService } from '../notifications/notification.service';
import { costAssert, costCan, costCrop, costField, costResource, costScope, costWriteFields, type AbnormalActor, type CostRow } from './abnormal-cost.policy';
import { costDecimal, costText, costUuid, normalizeAllocations, parseCostDetail } from './abnormal-cost.domain';

const REQUEST='abnormal-responsibility-requests',JUDGMENT='abnormal-responsibility-judgments';
@Injectable()
export class AbnormalCostApplicationService {
  constructor(private readonly db:DataSource,private readonly notifications:NotificationService,@Inject(OBJECT_STORAGE) private readonly storage:ObjectStorage){}
  transaction<T>(actor:AbnormalActor,work:(manager:EntityManager)=>Promise<T>) {
    if(!actor.userId||!actor.tenantId)throw new ForbiddenException('缺少有效用户或租户');
    return this.db.transaction(async manager=>{await manager.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);return work(manager);});
  }
  async audit(manager:EntityManager,actor:AbnormalActor,code:string,id:string|null,action:string,before:unknown,after:unknown) {
    await manager.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by) VALUES($1,$2::uuid,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,'web',$2::uuid,$2::text)`,[actor.tenantId,actor.userId,actor.displayName??actor.username??'成员',code,id,action,JSON.stringify(before??null),JSON.stringify(after??null),actor.requestId??uuidv7()]);
  }
  async locked(manager:EntityManager,code:AbnormalCostResource,id:string,action:string,actor:AbnormalActor,expectedVersion?:unknown) {
    costAssert(actor,code,action);const params:unknown[]=[actor.tenantId,costUuid(id)],scope=costScope(actor,code,action,params);
    const [row]=await manager.query(`SELECT record.* FROM ${costResource(code).table} record WHERE record.tenant_id=$1 AND record.id=$2::uuid AND (${scope}) FOR UPDATE`,params);
    if(!row)throw new NotFoundException('记录不存在或无权操作');
    if(expectedVersion!==undefined&&(!Number.isInteger(Number(expectedVersion))||Number(expectedVersion)!==Number(row.version)))throw new ConflictException('记录已修改，请刷新后重试');
    return row as CostRow;
  }
  private async idempotent(manager:EntityManager,actor:AbnormalActor,key:unknown,body:unknown,work:()=>Promise<CostRow>) {
    if(typeof key!=='string'||!key.trim()||key.length>200)throw new BadRequestException('需要有效Idempotency-Key');
    const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`abnormal:${actor.tenantId}:${actor.userId}:${key}`]);
    const [old]=await manager.query('SELECT body_hash,result FROM abnormal_cost_commands WHERE tenant_id=$1 AND actor_id=$2::uuid AND command_key=$3',[actor.tenantId,actor.userId,key]);
    if(old){if(old.body_hash!==hash)throw new ConflictException('重复提交标识对应内容已变化');return {...old.result,repeated:true};}
    const result=await work();
    await manager.query('INSERT INTO abnormal_cost_commands(tenant_id,actor_id,command_key,body_hash,result) VALUES($1,$2::uuid,$3,$4,$5::jsonb)',[actor.tenantId,actor.userId,key,hash,JSON.stringify(result)]);return result;
  }
  async saveBasic(code:AbnormalCostResource,id:string|null,body:CostRow,actor:AbnormalActor,manager?:EntityManager) {
    if(!['abnormal-categories','incident-severity-levels'].includes(code))throw new BadRequestException('基础资料资源无效');
    const action=id?'update':'create';costAssert(actor,code,action);
    const {expectedVersion,...input}=body;costWriteFields(actor,code,input,!id);
    if(id&&expectedVersion==null)throw new BadRequestException('请提供记录版本');
    const work=async(m:EntityManager)=>{
      // The same lock serializes category names and closed severity intervals within a tenant.
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`abnormal-basic:${actor.tenantId}:${code}`]);
      const old=id?await this.locked(m,code,id,'update',actor,expectedVersion):null;
      const values={...old,...input};let write:CostRow;
      if(code==='abnormal-categories'){
        write={category_name:costText(values.category_name,'异常类别',100,true),remark:costText(values.remark,'备注')};
        const [dupe]=await m.query('SELECT id FROM abnormal_categories WHERE tenant_id=$1 AND category_name=$2 AND deleted_at IS NULL AND ($3::uuid IS NULL OR id<>$3::uuid)',[actor.tenantId,write.category_name,id]);
        if(dupe)throw new ConflictException('异常类别已存在');
      }else{
        write={amount_min:costDecimal(values.amount_min,'金额下限'),amount_max:costDecimal(values.amount_max,'金额上限'),severity_name:costText(values.severity_name,'事故级别',10,true)};
        if(!abnormalSeverityOptions.some(o=>o.value===write.severity_name))throw new BadRequestException('事故级别无效');
        // Decimal strings are compared by PostgreSQL numeric, never JS floating point.
        const [invalid]=await m.query('SELECT $1::numeric > $2::numeric invalid',[write.amount_min,write.amount_max]);
        if(invalid.invalid)throw new BadRequestException('金额上限不能小于金额下限');
        const [overlap]=await m.query('SELECT severity_name FROM incident_severity_levels WHERE tenant_id=$1 AND deleted_at IS NULL AND amount_min<=$3::numeric AND amount_max>=$2::numeric AND ($4::uuid IS NULL OR id<>$4::uuid)',[actor.tenantId,write.amount_min,write.amount_max,id]);
        if(overlap)throw new ConflictException(`金额区间与“${overlap.severity_name}”重叠`);
        if(old&&Object.keys(write).some(k=>String(old[k])!==String(write[k]))){const [used]=await m.query('SELECT id FROM abnormal_responsibility_requests WHERE tenant_id=$1 AND severity_level_id=$2::uuid LIMIT 1',[actor.tenantId,id]);if(used)throw new ConflictException('已被异常单引用的事故级别不能直接修改，请保留历史配置');}
      }
      const result=await this.persist(m,code,id,write,actor);
      if(!id)await this.assertTargetScope(m,code,result.id,'create',actor);
      await this.audit(m,actor,code,result.id,`${code}.${action}`,old,result);return {id:result.id,version:result.version};
    };
    return manager?work(manager):this.transaction(actor,work);
  }
  private async persist(m:EntityManager,code:AbnormalCostResource,id:string|null,values:CostRow,actor:AbnormalActor){
    const entries=Object.entries(values),params:unknown[]=[actor.tenantId,actor.userId,...entries.map(([,v])=>Array.isArray(v)?JSON.stringify(v):v)];
    if(id){params.push(id);const rows=await m.query(`UPDATE ${costResource(code).table} SET ${entries.map(([k],i)=>`${k}=$${i+3}`).join(',')},updated_by=$2::text,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$${params.length}::uuid RETURNING *`,params);return (Array.isArray(rows[0])?rows[0]:rows)[0] as CostRow;}
    const [row]=await m.query(`INSERT INTO ${costResource(code).table}(tenant_id,created_by,updated_by,${entries.map(([k])=>k).join(',')}) VALUES($1,$2::uuid,$2::text,${entries.map((_,i)=>`$${i+3}`).join(',')}) RETURNING *`,params);return row as CostRow;
  }
  private async assertTargetScope(m:EntityManager,code:AbnormalCostResource,id:string,action:string,actor:AbnormalActor){await this.locked(m,code,id,action,actor);}
  async activeUser(m:EntityManager,id:unknown,actor:AbnormalActor,label:string,requireLeader=false){
    const userId=costUuid(id,label);const [row]=await m.query('SELECT id,position FROM users WHERE tenant_id=$1 AND id=$2::uuid AND enabled=true',[actor.tenantId,userId]);if(!row)throw new BadRequestException(`${label}必须是当前有效在职成员`);if(requireLeader&&!/(组长|课长)/.test(String(row.position??'')))throw new BadRequestException('一线员工的责任人员请选择岗位为组长或课长的有效成员');return userId;
  }
  private async department(m:EntityManager,id:unknown){const value=costUuid(id,'部门');const [row]=await m.query('SELECT id FROM organization_units WHERE id=$1::uuid AND enabled=true',[value]);if(!row)throw new BadRequestException('部门不存在或已停用');return value;}
  private async severity(m:EntityManager,amount:string,actor:AbnormalActor){
    await m.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`abnormal-basic:${actor.tenantId}:incident-severity-levels`]);
    const rows=await m.query('SELECT id FROM incident_severity_levels WHERE tenant_id=$1 AND deleted_at IS NULL AND amount_min<=$2::numeric AND amount_max>=$2::numeric FOR SHARE',[actor.tenantId,amount]);
    if(rows.length!==1)throw new BadRequestException('请管理员完善事故级别配置');return rows[0].id as string;
  }
  private async attachmentIds(m:EntityManager,raw:unknown,purpose:string,actor:AbnormalActor,existing:string[]=[]) {
    if(!Array.isArray(raw)||raw.length>10)throw new BadRequestException('附件列表无效或超过10份');
    const ids=raw.map(value=>costUuid(typeof value==='object'?value?.id:value,'附件ID'));
    if(new Set(ids).size!==ids.length)throw new BadRequestException('附件重复');
    for(const id of ids){const [row]=await m.query('SELECT id,created_by,parsed_rows FROM abnormal_cost_attachments WHERE tenant_id=$1 AND id=$2::uuid AND purpose=$3',[actor.tenantId,id,purpose]);if(!row||(!existing.includes(id)&&row.created_by!==actor.userId))throw new ForbiddenException('附件不存在或不属于当前用户');if(purpose==='DETAIL'&&!row.parsed_rows.length)throw new BadRequestException('明细附件未通过模板校验');}return ids;
  }
  private async requestValues(m:EntityManager,input:CostRow,actor:AbnormalActor,old?:CostRow) {
    const value={...old,...input};
    const confirmed=costDecimal(value.confirmed_amount===undefined?value.estimated_amount:value.confirmed_amount,'核定金额',2,undefined,true);
    return {customer_code:costText(value.customer_code,'客户',100,true,true),order_no:costText(value.order_no,'订单号',100,true,true),division_id:old&&value.division_id===old.division_id?old.division_id:await this.department(m,value.division_id),initiator_id:old&&value.initiator_id===old.initiator_id?old.initiator_id:await this.activeUser(m,value.initiator_id??actor.userId,actor,'发起人'),abnormal_description:costText(value.abnormal_description,'异常描述',4000,true),estimated_amount:costDecimal(value.estimated_amount,'预估金额',2,undefined,true),confirmed_amount:confirmed,severity_level_id:await this.severity(m,confirmed,actor),detail_attachment:(await this.attachmentIds(m,[value.detail_attachment],'DETAIL',actor,old?[old.detail_attachment]:[]))[0],other_attachments:await this.attachmentIds(m,value.other_attachments??[],'OTHER',actor,old?.other_attachments??[])};
  }
  async createRequest(body:CostRow,key:unknown,actor:AbnormalActor){
    costAssert(actor,REQUEST,'create');const {responsibility_judgments,...input}=body;costWriteFields(actor,REQUEST,body,true);
    if(!Array.isArray(responsibility_judgments)||!responsibility_judgments.length||responsibility_judgments.length>99)throw new BadRequestException('至少配置一条责任判定记录，最多99条');
    return this.transaction(actor,m=>this.idempotent(m,actor,key,body,async()=>{
      const values=await this.requestValues(m,input,actor);
      const [date]=await m.query("SELECT (now() AT TIME ZONE 'Asia/Shanghai')::date::text AS business_day,to_char(now() AT TIME ZONE 'Asia/Shanghai','YYMMDD') label");
      const [counter]=await m.query(`INSERT INTO abnormal_cost_counters(tenant_id,business_date,customer_code,last_number) VALUES($1,$2::date,$3,1) ON CONFLICT(tenant_id,business_date,customer_code) DO UPDATE SET last_number=abnormal_cost_counters.last_number+1 WHERE abnormal_cost_counters.last_number<999 RETURNING last_number`,[actor.tenantId,date.business_day,values.customer_code]);
      if(!counter)throw new ConflictException('该日期客户的三位异常编号已耗尽');
      const request=await this.persist(m,REQUEST,null,{...values,abnormal_no:`YC${date.label}${values.customer_code}${String(counter.last_number).padStart(3,'0')}`},actor);
      await this.assertTargetScope(m,REQUEST,request.id,'create',actor);
      const children=[];for(const child of responsibility_judgments)children.push(await this.createJudgmentIn(m,request,child,actor));
      await this.audit(m,actor,REQUEST,request.id,'abnormal.request.created',null,{...request,judgmentIds:children.map(c=>c.id)});return {id:request.id,abnormal_no:request.abnormal_no,version:request.version,judgments:children};
    }));
  }
  async updateRequest(id:string,body:CostRow,actor:AbnormalActor){
    const {expectedVersion,...input}=body;if(expectedVersion==null)throw new BadRequestException('请提供记录版本');costWriteFields(actor,REQUEST,input,false);
    if('responsibility_judgments' in input)throw new BadRequestException('责任判定记录请通过关联子表独立维护');
    return this.transaction(actor,async m=>{
      const old=await this.locked(m,REQUEST,id,'update',actor,expectedVersion);
      const [completed]=await m.query("SELECT id FROM abnormal_responsibility_judgments WHERE tenant_id=$1 AND request_id=$2::uuid AND deleted_at IS NULL AND judgment_status='COMPLETED' LIMIT 1",[actor.tenantId,id]);
      if(completed&&Object.keys(input).some(k=>!['other_attachments'].includes(k)))throw new ConflictException('已有已完成责任判定，不能修改判责基础信息');
      const values=await this.requestValues(m,input,actor,old),result=await this.persist(m,REQUEST,id,values,actor);
      await this.assertTargetScope(m,REQUEST,id,'update',actor);await this.audit(m,actor,REQUEST,id,'abnormal.request.updated',old,result);return {id,version:result.version};
    });
  }
  private async judgmentConfig(m:EntityManager,input:CostRow,actor:AbnormalActor,old?:CostRow){
    const category=costUuid(input.category_id,'异常类别');const [row]=await m.query('SELECT id FROM abnormal_categories WHERE tenant_id=$1 AND id=$2::uuid AND deleted_at IS NULL FOR SHARE',[actor.tenantId,category]);if(!row)throw new BadRequestException('异常类别无效');
    return {category_id:category,judgment_department_id:old&&input.judgment_department_id===old.judgment_department_id?old.judgment_department_id:await this.department(m,input.judgment_department_id),judge_user_id:old&&input.judge_user_id===old.judge_user_id?old.judge_user_id:await this.activeUser(m,input.judge_user_id,actor,'判定人'),expense_bearing_ratio:input.expense_bearing_ratio==null||input.expense_bearing_ratio===''?null:Number(costDecimal(input.expense_bearing_ratio,'承担费用比例',0,'100'))};
  }
  private async createJudgmentIn(m:EntityManager,parent:CostRow,input:CostRow,actor:AbnormalActor){
    costAssert(actor,JUDGMENT,'create');costWriteFields(actor,JUDGMENT,input,true);
    if(Object.keys(input).some(k=>!['category_id','judgment_department_id','judge_user_id','expense_bearing_ratio','responsibility_reason'].includes(k)))throw new BadRequestException('发起阶段仅配置类别、判定部门、判定人及说明');
    const values=await this.judgmentConfig(m,input,actor);
    const [seq]=await m.query('UPDATE abnormal_responsibility_requests SET next_judgment=next_judgment+1 WHERE tenant_id=$1 AND id=$2::uuid AND next_judgment<99 RETURNING next_judgment',[actor.tenantId,parent.id]);
    const sequence=(Array.isArray(seq)?seq[0]:seq)?.next_judgment; // pg/TypeORM UPDATE RETURNING shape differs from SELECT.
    if(!sequence)throw new ConflictException('该异常单的两位子单编号已耗尽');
    const row=await this.persist(m,JUDGMENT,null,{...values,request_id:parent.id,judgment_no:`${parent.abnormal_no}${String(sequence).padStart(2,'0')}`,responsibility_reason:costText(input.responsibility_reason,'责任划分理由')},actor);
    await this.assertTargetScope(m,JUDGMENT,row.id,'create',actor);
    await this.audit(m,actor,JUDGMENT,row.id,'abnormal.judgment.created',null,row);await this.enqueue(m,row,actor);return {id:row.id,judgment_no:row.judgment_no,version:row.version};
  }
  async addJudgment(requestId:string,input:CostRow,key:unknown,actor:AbnormalActor){return this.transaction(actor,m=>this.idempotent(m,actor,key,{requestId,input},async()=>{
    const parent=await this.locked(m,REQUEST,requestId,'update',actor);if(!costField(actor,REQUEST,'responsibility_judgments','update'))throw new ForbiddenException('无责任划分关联编辑权限');
    const result=await this.createJudgmentIn(m,parent,input,actor);await m.query('UPDATE abnormal_responsibility_requests SET version=version+1,updated_at=now(),updated_by=$3::text WHERE tenant_id=$1 AND id=$2::uuid',[actor.tenantId,requestId,actor.userId]);return result;
  }));}
  private async enqueue(m:EntityManager,judgment:CostRow,actor:AbnormalActor){
    const [row]=await m.query(`SELECT r.abnormal_no,r.customer_code,r.order_no,c.category_name,o.name department FROM abnormal_responsibility_requests r JOIN abnormal_categories c ON c.tenant_id=r.tenant_id AND c.id=$3::uuid JOIN organization_units o ON o.id=$4::uuid WHERE r.tenant_id=$1 AND r.id=$2::uuid`,[actor.tenantId,judgment.request_id,judgment.category_id,judgment.judgment_department_id]);
    const base=(process.env.PUBLIC_WEB_URL??process.env.WEB_BASE_URL??'https://knplan.cuixiaoyuan.cn').replace(/\/$/,'');
    await this.notifications.enqueueEvent(actor.tenantId,{eventType:'workflow.abnormal.judgment_assigned',channel:'WECHAT_WORK',dedupKey:`abnormal-judge:${judgment.id}:v${judgment.version}`,payload:{...row,judgmentId:judgment.id,judgeUserId:judgment.judge_user_id,link:`${base}/workflow/abnormal-cost/judgments/${judgment.id}`},createdBy:actor.userId},m);
  }
  async updateJudgment(id:string,body:CostRow,actor:AbnormalActor){
    const {expectedVersion,complete=false,...input}=body;if(expectedVersion==null)throw new BadRequestException('请提供记录版本');if(typeof complete!=='boolean')throw new BadRequestException('完成标记无效');if(complete&&(!costField(actor,JUDGMENT,'responsibility_allocations','update')||!costField(actor,JUDGMENT,'responsibility_allocations','read')))throw new ForbiddenException('没有责任划分提交权限');costWriteFields(actor,JUDGMENT,input,false);
    return this.transaction(actor,async m=>{
      // Lock parent first across all child commands to avoid delete/update deadlocks.
      const [link]=await m.query('SELECT request_id FROM abnormal_responsibility_judgments WHERE tenant_id=$1 AND id=$2::uuid',[actor.tenantId,costUuid(id)]);if(!link)throw new NotFoundException('记录不存在');
      await m.query('SELECT id FROM abnormal_responsibility_requests WHERE tenant_id=$1 AND id=$2::uuid AND deleted_at IS NULL FOR UPDATE',[actor.tenantId,link.request_id]);
      const old=await this.locked(m,JUDGMENT,id,'update',actor,expectedVersion);
      // Current update scope and field permissions authorize the assigned judge or delegated managers.
      // Do not add a second role-name/administrator whitelist over explicit KDOS grants.
      const configFields=['category_id','judgment_department_id','judge_user_id','expense_bearing_ratio'];
      if(old.judgment_status==='COMPLETED'&&configFields.some(k=>k in input&&String(input[k]??'')!==String(old[k]??'')))throw new ConflictException('已完成判定的配置不能改写');
      const config=await this.judgmentConfig(m,{...old,...input},actor,old);
      let adminId='';
      if((input.responsibility_allocations??old.responsibility_allocations).some((r:CostRow)=>r.personnel_type==='公司')){
        const [admin]=await m.query("SELECT u.id FROM users u WHERE u.tenant_id=$1 AND u.username='admin' AND u.enabled=true AND EXISTS(SELECT 1 FROM administrator_grants g WHERE g.tenant_id=u.tenant_id AND g.user_id=u.id AND g.system_admin=true)",[actor.tenantId]);
        if(!admin)throw new ConflictException('公司责任人员默认系统管理员不可用，请检查admin账号授权');adminId=admin.id;
      }
      const allocations=normalizeAllocations(input.responsibility_allocations??old.responsibility_allocations,adminId,complete||old.judgment_status==='COMPLETED');
      const previous:CostRow[]=old.responsibility_allocations;
      if(Array.isArray(input.responsibility_allocations)&&input.responsibility_allocations.some((row:CostRow)=>row.id&&!previous.some(p=>p.id===row.id)))throw new BadRequestException('责任划分新增行不能指定内部ID');
      if(previous.some(p=>!allocations.some(a=>a.id===p.id)))costAssert(actor,JUDGMENT,'delete');
      for(const allocation of allocations){const retained=previous.some(row=>row.id===allocation.id&&row.responsible_user_id===allocation.responsible_user_id&&row.personnel_type===allocation.personnel_type);if(!retained)await this.activeUser(m,allocation.responsible_user_id,actor,'责任人员',allocation.personnel_type==='一线员工');}
      const evidence=await this.attachmentIds(m,input.judgment_evidence??old.judgment_evidence,'EVIDENCE',actor,old.judgment_evidence);
      const result=await this.persist(m,JUDGMENT,id,{...config,responsibility_allocations:allocations,responsibility_reason:costText(Object.hasOwn(input,'responsibility_reason')?input.responsibility_reason:old.responsibility_reason,'责任划分理由'),judgment_evidence:evidence,judgment_status:complete?'COMPLETED':old.judgment_status},actor);
      await this.assertTargetScope(m,JUDGMENT,id,'update',actor);await this.audit(m,actor,JUDGMENT,id,'abnormal.judgment.updated',old,result);
      if(config.judge_user_id!==old.judge_user_id)await this.enqueue(m,result,actor);return {id,version:result.version,judgment_status:result.judgment_status};
    });
  }
  async remove(code:AbnormalCostResource,id:string,version:unknown,actor:AbnormalActor){
    costAssert(actor,code,'delete');if(version==null)throw new BadRequestException('请提供记录版本');
    return this.transaction(actor,async m=>{
      if(code===JUDGMENT){const [r]=await m.query('SELECT request_id FROM abnormal_responsibility_judgments WHERE tenant_id=$1 AND id=$2::uuid',[actor.tenantId,costUuid(id)]);if(r)await m.query('SELECT id FROM abnormal_responsibility_requests WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE',[actor.tenantId,r.request_id]);}
      const old=await this.locked(m,code,id,'delete',actor,version);
      if(code==='abnormal-categories'||code==='incident-severity-levels'){
        const [used]=await m.query(`SELECT id FROM ${code==='abnormal-categories'?'abnormal_responsibility_judgments':'abnormal_responsibility_requests'} WHERE tenant_id=$1 AND ${code==='abnormal-categories'?'category_id':'severity_level_id'}=$2::uuid LIMIT 1`,[actor.tenantId,id]);if(used)throw new ConflictException('基础资料已被引用，不能删除');
      }
      if(code===JUDGMENT){
        if(old.judgment_status==='COMPLETED')throw new ConflictException('已完成责任判定不能删除');
        const [{count}]=await m.query('SELECT count(*)::int count FROM abnormal_responsibility_judgments WHERE tenant_id=$1 AND request_id=$2::uuid AND deleted_at IS NULL',[actor.tenantId,old.request_id]);if(count<=1)throw new ConflictException('异常单至少保留一条责任判定记录');
      }
      if(code===REQUEST){
        const children=await m.query('SELECT id,version,judgment_status FROM abnormal_responsibility_judgments WHERE tenant_id=$1 AND request_id=$2::uuid AND deleted_at IS NULL ORDER BY id FOR UPDATE',[actor.tenantId,id]);
        for(const child of children){if(child.judgment_status==='COMPLETED')throw new ConflictException('已有完成判定，不能删除异常单');await this.locked(m,JUDGMENT,child.id,'delete',actor);await this.softDelete(m,JUDGMENT,child.id,actor);await this.audit(m,actor,JUDGMENT,child.id,'abnormal.judgment.deleted',child,null);}
      }
      await this.softDelete(m,code,id,actor);await this.audit(m,actor,code,id,`${code}.deleted`,old,null);return {id,deleted:true};
    });
  }
  private async softDelete(m:EntityManager,code:AbnormalCostResource,id:string,actor:AbnormalActor){await m.query(`UPDATE ${costResource(code).table} SET deleted_at=now(),updated_at=now(),updated_by=$3::text,version=version+1 WHERE tenant_id=$1 AND id=$2::uuid`,[actor.tenantId,id,actor.userId]);}
  async upload(file:Express.Multer.File,purpose:string,actor:AbnormalActor){
    if(!file?.buffer?.length)throw new BadRequestException('请选择附件');if(file.buffer.length>20*1024*1024)throw new BadRequestException('附件不能超过20MB');
    const resource=purpose==='EVIDENCE'?JUDGMENT:REQUEST,field=purpose==='DETAIL'?'detail_attachment':purpose==='OTHER'?'other_attachments':'judgment_evidence';
    if(!['DETAIL','OTHER','EVIDENCE'].includes(purpose))throw new BadRequestException('附件用途无效');
    const creating=costCan(actor,resource,'create'),updating=costCan(actor,resource,'update');
    if(!creating&&!updating)throw new ForbiddenException('无附件上传权限');costWriteFields(actor,resource,{[field]:[]},creating);
    const name=String(file.originalname??'attachment').split(/[\\/]/).pop()!.slice(0,255),ext=name.split('.').pop()!.toLowerCase();
    if(!['xlsx','pdf','png','jpg','jpeg','gif','webp','docx','txt','csv'].includes(ext)||purpose==='DETAIL'&&ext!=='xlsx')throw new BadRequestException('不支持的附件格式，明细附件请使用.xlsx模板');
    const parsed=purpose==='DETAIL'?await parseCostDetail(file.buffer):[];
    const object=await this.storage.put({key:`abnormal-cost/${actor.tenantId.replace(/[^a-zA-Z0-9_-]/g,'_')}/${uuidv7()}.${ext}`,body:file.buffer,contentType:file.mimetype||'application/octet-stream',visibility:'private'});
    try{return await this.transaction(actor,async m=>{
      const [row]=await m.query('INSERT INTO abnormal_cost_attachments(tenant_id,object_key,name,mime_type,size,purpose,parsed_rows,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::uuid,$8::text) RETURNING id,name,size,purpose,parsed_rows',[actor.tenantId,object.key,name,file.mimetype||'application/octet-stream',file.buffer.length,purpose,JSON.stringify(parsed),actor.userId]);
      await this.audit(m,actor,resource,null,'abnormal.attachment.uploaded',null,{id:row.id,name,size:file.buffer.length,purpose});return row;
    });}catch(error){await this.storage.delete(object.key);throw error;}
  }
  async detail(code:AbnormalCostResource,id:string,actor:AbnormalActor){return this.transaction(actor,async m=>{
    const row=await this.locked(m,code,id,'read',actor);const out=costCrop(actor,code,row);
    if(code===JUDGMENT&&costField(actor,code,'abnormal_request_link','read'))out.abnormal_request_link=`/workflow/abnormal-cost/requests/${row.request_id}`;
    if(code===REQUEST&&costField(actor,code,'responsibility_judgments','read')&&costCan(actor,JUDGMENT,'read')){
      const params:unknown[]=[actor.tenantId,id],scope=costScope(actor,JUDGMENT,'read',params);const children=await m.query(`SELECT record.* FROM abnormal_responsibility_judgments record WHERE record.tenant_id=$1 AND record.request_id=$2::uuid AND (${scope}) ORDER BY record.judgment_no`,params);out.responsibility_judgments=children.map((child:CostRow)=>({...costCrop(actor,JUDGMENT,child),...(costField(actor,JUDGMENT,'abnormal_request_link','read')?{abnormal_request_link:`/workflow/abnormal-cost/requests/${id}`}:{})}));
    }
    for(const key of code===REQUEST?['detail_attachment','other_attachments']:code===JUDGMENT?['judgment_evidence']:[]){if(out[key]==null)continue;const ids=Array.isArray(out[key])?out[key]:[out[key]];out[key]=await m.query('SELECT id,name,size,purpose FROM abnormal_cost_attachments WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[actor.tenantId,ids]);}
    return out;
  });}
  async attachment(code:AbnormalCostResource,id:string,attachmentId:string,actor:AbnormalActor){
    const detail=await this.detail(code,id,actor),fields=code===REQUEST?['detail_attachment','other_attachments']:['judgment_evidence'];
    if(!fields.some(f=>Array.isArray(detail[f])&&detail[f].some((a:CostRow)=>a.id===attachmentId)))throw new ForbiddenException('无附件读取权限');
    return this.transaction(actor,async m=>{
      const [row]=await m.query('SELECT object_key,name,mime_type,parsed_rows FROM abnormal_cost_attachments WHERE tenant_id=$1 AND id=$2::uuid',[actor.tenantId,costUuid(attachmentId)]);
      if(!row)throw new NotFoundException('附件不存在');const object=await this.storage.get(row.object_key);if(!object)throw new NotFoundException('附件文件不存在');return {name:row.name,mimeType:row.mime_type,content:object.body,parsedRows:row.parsed_rows};
    });
  }
}
