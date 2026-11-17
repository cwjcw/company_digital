import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { tablePermissionFieldsFor, type AbnormalCostResource } from '@kdos/contracts';
import { OrganizationDirectoryService } from '../organization-directory/organization-directory.service';
import { SqlFilterCompiler } from '../../common/filtering/sql-filter.compiler';
import { assertSpreadsheetNotEncrypted } from '../../spreadsheet-upload';
import { AbnormalCostApplicationService } from './abnormal-cost.application.service';
import { costAssert, costCan, costColumns, costField, costResource, costScope, costWriteFields, type AbnormalActor, type CostRow } from './abnormal-cost.policy';
import { costUuid } from './abnormal-cost.domain';
const REQUEST='abnormal-responsibility-requests',JUDGMENT='abnormal-responsibility-judgments';
const configKeys:Record<string,string>={'异常类别':'category_id','判定部门':'judgment_department_id','判定人':'judge_user_id','承担费用比例':'expense_bearing_ratio','责任划分理由':'responsibility_reason'};
const allocationKeys:Record<string,string>={'人员类型':'personnel_type','一线员工姓名':'frontline_name','公司说明':'company_description','责任人员':'responsible_user_id','人员层级':'personnel_level','责任比例':'responsibility_ratio','申诉后责任比例':'adjusted_ratio','备注':'remark'};
@Injectable()
export class AbnormalCostGraphSpreadsheetService {
  constructor(private readonly app:AbnormalCostApplicationService,private readonly organizations:OrganizationDirectoryService){}
  private async catalog(m:EntityManager,actor:AbnormalActor){
    const users:CostRow[]=await m.query('SELECT id,username,display_name FROM users WHERE tenant_id=$1',[actor.tenantId]);
    const units:CostRow[]=await m.query('SELECT id,name FROM organization_units');
    const paths=await this.organizations.listEnabled();
    const departments:CostRow[]=units.map(u=>({...u,label:paths.find(p=>p.id===u.id)?.pathLabel??u.name}));
    const categories:CostRow[]=await m.query('SELECT id,category_name FROM abnormal_categories WHERE tenant_id=$1 AND deleted_at IS NULL',[actor.tenantId]);
    return {users,departments,categories};
  }
  private unique(raw:unknown,rows:CostRow[],keys:string[],label:string){
    const text=String(raw??'').trim();const matches=rows.filter(r=>keys.some(k=>r[k]===text));
    if(matches.length!==1)throw new BadRequestException(`${label}“${text}”${matches.length?'存在重名，请使用唯一登录账号或完整组织路径':'无法匹配'}；不接受内部UUID`);
    return matches[0].id as string;
  }
  private json(raw:unknown,label:string):CostRow[]{
    try{const result=typeof raw==='string'?JSON.parse(raw):raw;if(!Array.isArray(result)||result.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error();return result;}catch{throw new BadRequestException(`${label}必须是模板说明中的JSON数组`);}
  }
  private async resolve(m:EntityManager,code:AbnormalCostResource,row:CostRow,actor:AbnormalActor){
    const input={...row.values};costWriteFields(actor,code,input,!row.id);
    let old:CostRow|undefined;
    if(row.id){costAssert(actor,code,'read');costAssert(actor,code,'update');costAssert(actor,code,'batch_update');await this.app.locked(m,code,row.id,'import',actor);await this.app.locked(m,code,row.id,'batch_update',actor);old=await this.app.locked(m,code,row.id,'read',actor,row.expectedVersion);}else costAssert(actor,code,'create');
    if(old&&row.parentNo){const [parent]=await m.query('SELECT abnormal_no FROM abnormal_responsibility_requests WHERE tenant_id=$1 AND id=$2::uuid',[actor.tenantId,old.request_id]);if(row.parentNo!==parent?.abnormal_no)throw new BadRequestException('不允许更换已有判定单的主表关联');}
    const catalog=await this.catalog(m,actor);
    const user=(v:unknown)=>this.unique(v,catalog.users,['username'],'成员登录账号');
    const department=(v:unknown)=>this.unique(v,catalog.departments,['label','name'],'部门');
    const config=(raw:CostRow)=>{
      const result:CostRow={};for(const [k,v] of Object.entries(raw)){if(!configKeys[k])throw new BadRequestException(`责任判定配置未知字段：${k}`);result[configKeys[k]]=v;}
      result.category_id=this.unique(result.category_id,catalog.categories,['category_name'],'异常类别');result.judgment_department_id=department(result.judgment_department_id);result.judge_user_id=user(result.judge_user_id);return result;
    };
    for(const [key,value] of Object.entries(input)){
      const f=tablePermissionFieldsFor(code).find(field=>field.key===key)!;
      if(value!==null&&f.type==='member')input[key]=user(value);
      if(value!==null&&f.type==='department')input[key]=department(value);
      if(key==='category_id'&&value!==null)input[key]=this.unique(value,catalog.categories,['category_name'],'异常类别');
      if(key==='responsibility_judgments'){
        if(row.id)throw new BadRequestException('已有主单的责任判定请使用子表独立导入，不能改写关联配置');
        input[key]=this.json(value,'责任划分配置').map(config);
      }
      if(key==='responsibility_allocations')input[key]=this.json(value,'责任划分').map(raw=>{
        const allocation:CostRow={};for(const [k,v] of Object.entries(raw)){if(k==='行序号')continue;if(!allocationKeys[k])throw new BadRequestException(`责任划分未知字段：${k}`);allocation[allocationKeys[k]]=v;}
        if(raw.行序号!=null){const index=Number(raw.行序号);if(!old||!Number.isInteger(index)||index<1||!old.responsibility_allocations[index-1])throw new BadRequestException('责任划分行序号不属于当前版本');allocation.id=old.responsibility_allocations[index-1].id;}
        if(allocation.personnel_type!=='公司')allocation.responsible_user_id=user(allocation.responsible_user_id);return allocation;
      });
      if(f.type==='attachment'){
        const names=key==='detail_attachment'?[value]:value==null?[]:this.jsonNames(value,f.label);
        const existing:string[]=old?(Array.isArray(old[key])?old[key]:[old[key]]):[];
        const ids:string[]=[];for(const name of names){const matches=await m.query('SELECT id FROM abnormal_cost_attachments WHERE tenant_id=$1 AND name=$2 AND purpose=$3 AND (created_by=$4::uuid OR id=ANY($5::uuid[]))',[actor.tenantId,name,key==='detail_attachment'?'DETAIL':key==='other_attachments'?'OTHER':'EVIDENCE',actor.userId,existing]);if(matches.length!==1)throw new BadRequestException(`${f.label}“${name}”未准备或同名歧义，请先上传有效附件且使用唯一文件名`);ids.push(matches[0].id);}input[key]=key==='detail_attachment'?ids[0]:ids;
      }
    }
    let parentId:string|undefined;
    if(code===JUDGMENT&&!row.id){const [parent]=await m.query('SELECT id FROM abnormal_responsibility_requests WHERE tenant_id=$1 AND abnormal_no=$2 AND deleted_at IS NULL',[actor.tenantId,row.parentNo]);if(!parent)throw new BadRequestException('主表异常单号无法匹配');await this.app.locked(m,REQUEST,parent.id,'update',actor);parentId=parent.id;}
    return {...row,values:input,parentId};
  }
  private jsonNames(value:unknown,label:string):string[]{try{const names=typeof value==='string'?JSON.parse(value):value;if(!Array.isArray(names)||names.some(n=>typeof n!=='string'||!n))throw Error();return names;}catch{throw new BadRequestException(`${label}请填写文件名JSON字符串数组`);}}
  private async execute(m:EntityManager,code:AbnormalCostResource,row:CostRow,key:string,actor:AbnormalActor){
    // JSONB reorders object keys; canonicalize on both Preview and Confirm before command hashing.
    const values=JSON.parse(JSON.stringify(row.values,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value));
    if(row.id)return code===REQUEST?this.app.updateRequest(row.id,{...values,expectedVersion:row.expectedVersion},actor,m):this.app.updateJudgment(row.id,{...values,expectedVersion:row.expectedVersion},actor,m);
    const result=await (code===REQUEST?this.app.createRequest(values,key,actor,m):this.app.addJudgment(row.parentId,values,key,actor,m));
    await this.app.locked(m,code,result.id,'import',actor);return result;
  }
  async template(code:AbnormalCostResource,mode:string,query:CostRow,actor:AbnormalActor){
    costAssert(actor,code,'import');if(!['CREATE','UPDATE'].includes(mode))throw new BadRequestException('模板模式无效');
    const fields=tablePermissionFieldsFor(code).filter(f=>f.editable&&(mode==='CREATE'?(costField(actor,code,f.key,'update')||costField(actor,code,f.key,'read')||!costCan(actor,code,'read')):costField(actor,code,f.key,'read')&&costField(actor,code,f.key,'update'))&&!(code===REQUEST&&mode==='UPDATE'&&f.key==='responsibility_judgments')&&!(code===JUDGMENT&&mode==='CREATE'&&['responsibility_allocations','judgment_evidence'].includes(f.key)));
    const book=new ExcelJS.Workbook(),sheet=book.addWorksheet(costResource(code).label);
    sheet.columns=[{header:'记录ID',key:'id',width:38},{header:'版本',key:'version',width:10},...(code===JUDGMENT&&mode==='CREATE'?[{header:'主表异常单号',key:'parentNo',width:30}]:[]),...fields.map(f=>({header:f.label,key:f.key,width:f.type==='structured'?65:25}))];
    sheet.getColumn(1).numFmt='@';for(const f of fields)if(f.type!=='number')sheet.getColumn(f.key).numFmt='@';if(code===JUDGMENT&&mode==='CREATE')sheet.getColumn('parentNo').numFmt='@';
    if(mode==='UPDATE')await this.app.transaction(actor,async m=>{
      costAssert(actor,code,'read');costAssert(actor,code,'update');costAssert(actor,code,'batch_update');
      const params:unknown[]=[actor.tenantId],clauses=['record.tenant_id=$1',...['read','update','import','batch_update'].map(action=>costScope(actor,code,action,params))];
      const compiler=new SqlFilterCompiler(tablePermissionFieldsFor(code),Object.fromEntries(Object.entries(costColumns(code)).map(([k,v])=>[k,`record.${v}`])),key=>costField(actor,code,key,'read'));
      if(query.filterGroup)clauses.push(compiler.compile(query.filterGroup,params));
      if(query.search){params.push(`%${String(query.search)}%`);const searchable=tablePermissionFieldsFor(code).filter(f=>costField(actor,code,f.key,'read')&&f.type==='text');clauses.push(searchable.length?`(${searchable.map(f=>`record.${f.key}::text ILIKE $${params.length}`).join(' OR ')})`:'false');}
      if(code===JUDGMENT&&query.requestId){params.push(costUuid(query.requestId));clauses.push(`record.request_id=$${params.length}::uuid`);}
      const records:CostRow[]=await m.query(`SELECT record.* FROM ${costResource(code).table} record WHERE ${clauses.map(c=>`(${c})`).join(' AND ')} ORDER BY record.created_at DESC,record.id LIMIT 5001`,params);if(records.length>5000)throw new BadRequestException('更新模板超过5000行，请缩小查询范围');
      const catalog=await this.catalog(m,actor),member=(id:string)=>catalog.users.find(u=>u.id===id)?.username,department=(id:string)=>catalog.departments.find(d=>d.id===id)?.label;
      for(const record of records){const out:CostRow={id:record.id,version:record.version};for(const f of fields){let v=record[f.key];if(f.type==='member')v=member(v);if(f.type==='department')v=department(v);if(f.key==='category_id')v=catalog.categories.find(c=>c.id===v)?.category_name;
        if(f.key==='responsibility_allocations')v=JSON.stringify((v as CostRow[]).map((a,index)=>Object.fromEntries([['行序号',index+1],...Object.entries(allocationKeys).map(([label,k])=>[label,k==='responsible_user_id'?(a.personnel_type==='公司'?null:member(a[k])):a[k]])])));
        if(f.type==='attachment'){const ids=Array.isArray(v)?v:v?[v]:[];const files=await m.query('SELECT id,name FROM abnormal_cost_attachments WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[actor.tenantId,ids]);const names=ids.map((id:string)=>files.find((a:CostRow)=>a.id===id)?.name);v=f.key==='detail_attachment'?names[0]:JSON.stringify(names);}
        out[f.key]=v;
      }sheet.addRow(out);}
    });
    book.addWorksheet('填写说明').addRows([
      [fields.map(f=>`${f.label}：${f.required?'必填':'可空'}${f.options?`；选项${f.options.map(o=>o.label).join('/')}`:''}`).join('；')],
      ['ID与版本同时为空新增，同时有效更新；空白不改，【清空】清空可空字段。更新模板仅携带有读写权限且范围允许的数据。'],
      ['成员填写唯一登录账号；部门填写完整组织路径；异常类别填写唯一名称；不得填内部UUID。'],
      ['先用页面“准备导入附件”上传；附件以同租户本人的唯一文件名匹配，明细必须已通过规定模板完整校验。多个附件填写JSON数组，例如["evidence.pdf"]。'],
      ['主单新增责任划分示例：[{"异常类别":"品质","判定部门":"公司 / 部门","判定人":"login","承担费用比例":null}]；必须至少一条；已有主单的子单单独维护。'],
      ['判定新增须填主表异常单号，仅配置类别/部门/判定人/承担费用比例/理由；不在此阶段要求责任比例。'],
      ['判定更新责任划分示例：[{"行序号":1,"人员类型":"公司","公司说明":"公司","人员层级":"总经理","责任比例":100.0,"申诉后责任比例":100.0}]；公司责任人员自动admin；其他类型责任人员填登录账号。'],
      ['已保存行保留行序号，新行不填；移除旧行需要删除权限。更新待判定单仅保存草稿，完成判定仍在详情执行并精确校验合计100%。已完成单更新仍执行合计校验。'],
      ['整批预览和确认同正式命令校验，任何错误整体回滚；重复文件/重复确认不重复创建主单、子单或通知；最多5000行。']
    ]);return Buffer.from(await book.xlsx.writeBuffer());
  }
  async preview(code:AbnormalCostResource,buffer:Buffer,actor:AbnormalActor){
    costAssert(actor,code,'import');assertSpreadsheetNotEncrypted(buffer);const book=new ExcelJS.Workbook();try{await book.xlsx.load(buffer as never);}catch{throw new BadRequestException('无效Excel文件');}
    const sheet=book.worksheets[0];if(!sheet||sheet.rowCount>5001)throw new BadRequestException('文件必须包含不超过5000行的数据');
    const definitions=tablePermissionFieldsFor(code).filter(f=>f.editable),keys:string[]=[];
    sheet.getRow(1).eachCell({includeEmpty:true},cell=>{const h=cell.text.trim(),key=h==='记录ID'?'id':h==='版本'?'expectedVersion':h==='主表异常单号'&&code===JUDGMENT?'parentNo':definitions.find(f=>f.label===h)?.key;if(!key||keys.includes(key))throw new BadRequestException(`表头无效或重复：${h}`);keys.push(key);});
    if(!keys.includes('id')||!keys.includes('expectedVersion')||keys.length<3)throw new BadRequestException('请使用正式模板');
    const rows:CostRow[]=[],commands:CostRow[]=[],errors:Array<{row:number;reason:string}>=[],ids=new Set<string>(),hash=createHash('sha256').update(buffer).digest('hex');
    sheet.eachRow((row,index)=>{if(index===1||!row.hasValues)return;const out:CostRow={row:index,values:{},commandKey:`abnormal-xlsx:${code}:${hash}:${index}`};keys.forEach((key,i)=>{const cell=row.getCell(i+1);if(cell.value==null||cell.text==='')return;if(cell.type===ExcelJS.ValueType.Formula||cell.type===ExcelJS.ValueType.Error||!['string','number','boolean'].includes(typeof cell.value)){errors.push({row:index,reason:'单元格必须为明确文本或数字，不接受公式/错误值'});return;}if(key==='id')out.id=cell.text.trim();else if(key==='expectedVersion')out.expectedVersion=Number(cell.text);else if(key==='parentNo')out.parentNo=cell.text;else out.values[key]=cell.text==='【清空】'?null:cell.value;});
      if(Boolean(out.id)!==Boolean(out.expectedVersion))errors.push({row:index,reason:'记录ID和版本必须同时提供或留空'});if(out.id){try{out.id=costUuid(out.id);if(ids.has(out.id))throw new Error('记录ID重复');ids.add(out.id);}catch(error){errors.push({row:index,reason:(error as Error).message});}}rows.push(out);
    });if(!rows.length)throw new BadRequestException('没有可导入数据');
    class Rollback extends Error{}if(!errors.length)try{await this.app.transaction(actor,async m=>{for(const row of rows){try{const command=await this.resolve(m,code,row,actor);await this.execute(m,code,command,row.commandKey,actor);commands.push(command);}catch(error){errors.push({row:row.row,reason:(error as Error).message});break;}}throw new Rollback();});}catch(error){if(!(error instanceof Rollback))throw error;}
    const result:CostRow={resource:code,total:rows.length,rows,errors};if(!errors.length)result.previewId=await this.app.transaction(actor,async m=>{const [preview]=await m.query('INSERT INTO abnormal_cost_import_previews(tenant_id,actor_id,resource,rows) VALUES($1,$2::uuid,$3,$4::jsonb) RETURNING id',[actor.tenantId,actor.userId,code,JSON.stringify(commands)]);return preview.id;});return result;
  }
  async confirm(code:AbnormalCostResource,id:string,actor:AbnormalActor){costAssert(actor,code,'import');return this.app.transaction(actor,async m=>{
    const [preview]=await m.query('SELECT * FROM abnormal_cost_import_previews WHERE tenant_id=$1 AND actor_id=$2::uuid AND id=$3::uuid AND resource=$4 FOR UPDATE',[actor.tenantId,actor.userId,costUuid(id),code]);if(!preview)throw new NotFoundException('预览不存在');if(preview.result)return {...preview.result,repeated:true};if(new Date(preview.expires_at).getTime()<Date.now())throw new ConflictException('预览已过期，请重新上传');
    let created=0,updated=0,repeated=0;for(const row of preview.rows){if(row.id){costAssert(actor,code,'read');costAssert(actor,code,'batch_update');await this.app.locked(m,code,row.id,'import',actor);await this.app.locked(m,code,row.id,'batch_update',actor);}const result=await this.execute(m,code,row,row.commandKey,actor);if(result.repeated)repeated++;else if(row.id)updated++;else created++;}
    const result={created,updated,repeated,total:preview.rows.length};await this.app.audit(m,actor,code,null,`${code}.import_confirmed`,null,{...result,previewId:id});await m.query('UPDATE abnormal_cost_import_previews SET result=$2::jsonb WHERE id=$1::uuid',[id,JSON.stringify(result)]);return result;
  });}
}
