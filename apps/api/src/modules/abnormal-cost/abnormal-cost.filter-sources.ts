import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { abnormalCostResources, tablePermissionFieldsFor } from '@kdos/contracts';
import { TableFilterRegistry } from '../../common/filtering/table-filter.registry';
import { costAssert, costCan, costColumns, costField, costScope } from './abnormal-cost.policy';
import { costUuid } from './abnormal-cost.domain';
import { AbnormalCostApplicationService } from './abnormal-cost.application.service';
@Injectable()
export class AbnormalCostFilterSources implements OnModuleInit {
  constructor(private readonly registry:TableFilterRegistry,private readonly db:DataSource,private readonly app:AbnormalCostApplicationService){}
  onModuleInit(){for(const resource of abnormalCostResources){
    const code=resource.code;
    this.registry.register({code,table:resource.table,columns:costColumns(code),fields:tablePermissionFieldsFor(code),
      expressions:code==='abnormal-responsibility-requests'?{responsibility_judgments:'NULL::jsonb'}:code==='abnormal-responsibility-judgments'?{abnormal_request_link:"'/workflow/abnormal-cost/requests/'||record.request_id::text"}:{},
      defaultSort:{field:'createdAt',order:'desc',stableColumns:['id']},exportFilename:()=>`${resource.kind}.xlsx`,exportNullAsBlank:true,exportExactNumbers:true,
      authorize:actor=>costAssert(actor,code,'read'),canReadResource:actor=>costCan(actor,code,'read'),fieldReadPermission:(actor,key)=>costField(actor,code,key,'read'),buildScope:(actor,params,action)=>costScope(actor,code,action??'read',params),
      buildContext:(context,params)=>{
        if(code!=='abnormal-responsibility-judgments'||!context.requestId)return '1=1';params.push(costUuid(context.requestId));return `record.request_id=$${params.length}::uuid`;
      },
      // Resolve business relation labels in ordinary export; UUIDs remain internal identities.
      printResolvers: { ...Object.fromEntries((code==='abnormal-responsibility-requests'?[['severity_level_id','incident_severity_levels','severity_name']]:code==='abnormal-responsibility-judgments'?[['category_id','abnormal_categories','category_name']]:[]).map(([field,table,label])=>[field,async(rows,actor)=>{
        const result:Record<string,string>[] =await this.db.transaction(async m=>{await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor?.tenantId]);return m.query(`SELECT id,${label} label FROM ${table} WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,[actor?.tenantId,rows.map(r=>r[field]).filter(Boolean)]);});const labels=new Map(result.map(r=>[r.id,r.label]));return new Map(rows.map(r=>[String(r.id),labels.get(String(r[field]))??'—']));
      }])), ...Object.fromEntries((code==='abnormal-responsibility-requests'?['detail_attachment','other_attachments']:code==='abnormal-responsibility-judgments'?['judgment_evidence']:[]).map(field=>[field,async(rows,actor)=>{
        const ids=rows.flatMap(r=>Array.isArray(r[field])?r[field]:r[field]?[r[field]]:[]);
        const names:Record<string,string>[]=ids.length?await this.db.transaction(async m=>{await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor?.tenantId]);return m.query('SELECT id,name FROM abnormal_cost_attachments WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[actor?.tenantId,ids]);}):[];
        const labels=new Map(names.map(n=>[n.id,n.name]));return new Map(rows.map(r=>[String(r.id),(Array.isArray(r[field])?r[field]:r[field]?[r[field]]:[]).map((id:unknown)=>labels.get(String(id))??'—').join('、')]));
      }])) },
      exportDisplayValue:(field,value)=>field.key==='expense_bearing_ratio'?(value==null?'':`${value}%`):field.type==='structured'?Array.isArray(value)?`${value.length}条`:'—':field.type==='attachment'?String(value??''):field.key==='abnormal_request_link'?'查看异常信息':undefined,
      recordExport:async(summary,actor)=>{costAssert(actor,code,'export');await this.app.transaction(actor,m=>this.app.audit(m,actor,code,null,`${code}.exported`,null,summary));},
      memberCandidates:async(term,size,actor)=>this.db.transaction(async m=>{await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor?.tenantId]);return (await m.query("SELECT id value,COALESCE(NULLIF(display_name,''),username) label FROM users WHERE tenant_id=$1 AND enabled=true AND (display_name ILIKE $2 OR username ILIKE $2) ORDER BY display_name,id LIMIT $3",[actor?.tenantId,`%${term}%`,size]));}),
      runQuery:(sql,params)=>this.db.transaction(async m=>{await m.query("SELECT set_config('app.tenant_id',$1,true)",[String(params[0])]);return m.query(sql,params);})
    });
  }}
}
