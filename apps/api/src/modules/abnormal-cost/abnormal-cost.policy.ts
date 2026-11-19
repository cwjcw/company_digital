import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { abnormalCostResources, tablePermissionFieldsFor, type AbnormalCostResource } from '@kdos/contracts';
import { buildDataScopeClause } from '../../common/filtering/data-scope';
import type { TableFilterActor } from '../../common/filtering/table-filter.registry';
export type AbnormalActor = TableFilterActor & { requestId?: string };
export type CostRow = Record<string, any>;
export function costResource(code: string) {
  const def = abnormalCostResources.find(r=>r.code===code);
  if (!def) throw new BadRequestException('异常费用资源无效');
  return def;
}
export function costAdmin(actor: AbnormalActor) { return actor.isSystemAdmin===true || actor.permissions.includes('*') || actor.moduleAdminCodes?.includes('workflow')===true; }
const JUDGMENT='abnormal-responsibility-judgments';
const ASSIGNEE_EDIT_FIELDS=new Set(['responsibility_allocations','responsibility_reason','judgment_evidence']);
const hasResourceGrant=(actor:AbnormalActor,code:string,action:string)=>costAdmin(actor)||actor.permissions.includes(`${code}:*:${action}`);
const isAssignedJudge=(actor:AbnormalActor)=>Boolean(actor.userId);
export function costCan(actor: AbnormalActor, code: string, action: string) {
  if(hasResourceGrant(actor,code,action))return true;
  // A judgment assignment itself grants access to that user's own record only;
  // costScope below enforces the row boundary for every read/update query.
  return code===JUDGMENT&&isAssignedJudge(actor)&&(action==='read'||action==='update');
}
export function costField(actor: AbnormalActor, code: string, field: string, action: 'read'|'update') {
  if(costAdmin(actor)||actor.permissions.includes(`${code}:${field}:${action}`))return true;
  if(code!==JUDGMENT||!isAssignedJudge(actor)||hasResourceGrant(actor,code,action))return false;
  return action==='read'||ASSIGNEE_EDIT_FIELDS.has(field);
}
export function costAssert(actor: AbnormalActor, code: string, action: string) { if(!costCan(actor,code,action)) throw new ForbiddenException('当前权限组没有此表的操作权限'); }
export const costColumns = (code: AbnormalCostResource) => Object.fromEntries([
  ['id','id'],['version','version'],...tablePermissionFieldsFor(code).filter(f=>!['responsibility_judgments','abnormal_request_link'].includes(f.key)).map(f=>[f.key,({createdBy:'created_by',createdAt:'created_at',updatedBy:'updated_by',updatedAt:'updated_at'} as Record<string,string>)[f.key]??f.key])
]);
export function costScope(actor: AbnormalActor, code: AbnormalCostResource, action: string, params: unknown[]) {
  const base='record.deleted_at IS NULL';
  if(costAdmin(actor))return base;
  if(code===JUDGMENT&&!hasResourceGrant(actor,code,action)){
    params.push(actor.userId);
    return `(${base}) AND (record.judge_user_id=$${params.length}::uuid)`;
  }
  return `(${base}) AND (${buildDataScopeClause({resource:code,action,columns:costColumns(code),actor:{...actor,moduleAdminCodes:[]},params,numericFields:['estimated_amount','confirmed_amount','amount_min','amount_max','expense_bearing_ratio']})})`;
}
export function costWriteFields(actor: AbnormalActor, code: AbnormalCostResource, body: CostRow, creating: boolean) {
  const fields=tablePermissionFieldsFor(code);
  for(const key of Object.keys(body)) {
    const field=fields.find(f=>f.key===key);
    if(!field?.editable)throw new BadRequestException(`不可填写字段：${key}`);
    if(!(costField(actor,code,key,'update')&&(creating||costField(actor,code,key,'read'))) && !(creating && (costField(actor,code,key,'read') || !costCan(actor,code,'read'))))throw new ForbiddenException(`无字段编辑权限：${field.label}`);
  }
}
export function costCrop(actor: AbnormalActor, code: AbnormalCostResource, row: CostRow) {
  const columns=costColumns(code), out:CostRow={id:row.id,version:row.version};
  for(const field of tablePermissionFieldsFor(code))if(costField(actor,code,field.key,'read'))out[field.key]=row[columns[field.key]??field.key];
  return out;
}
