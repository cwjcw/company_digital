import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { BOM_SOURCES, BOM_SOURCE_NAMES, createUnifiedBomMatcher, type BomSource, type UnifiedBomHead } from './unified-bom.matcher';

@Injectable()
export class UnifiedBomQueryService {
  constructor(private readonly db: DataSource) {}
  async read(tenant:string,codes:string[]) {
    return this.db.transaction('REPEATABLE READ',async m=>{
      await m.query('SET TRANSACTION READ ONLY');
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      return this.readSnapshot(m,tenant,codes);
    });
  }
  async readSnapshot(m:EntityManager,tenant:string,codes:string[]) {
      const tplus=await m.query(`SELECT source,active_generation::text generation,report_enabled enabled,last_status status,last_started_at::text started,last_success_at::text success,last_error_code error FROM rd_tplus_bom_sync_state WHERE tenant_id=$1`,[tenant]);
      if (tplus.length!==2 || tplus.some((s:any)=>!s.enabled)) return {enabled:false as const};
      const [e10]=await m.query(`SELECT active_generation::text generation,last_change_version::text watermark,last_status status,last_success_at::text success,last_error_code error FROM rd_bom_sync_state WHERE tenant_id=$1`,[tenant]);
      const states=BOM_SOURCES.map(source=>({source,...(source==='e10-main'?e10:tplus.find((s:any)=>s.source===source))}));
      const freshness=(s: any)=>!s.generation||!s.success?'未初始化':s.status==='FAILED'||(s.source!=='e10-main'&&s.status==='RUNNING'&&s.started&&Date.now()-new Date(s.started).getTime()>15*60000)?'异常':s.status==='RUNNING'?'同步中':(!Number.isFinite(Date.parse(s.success))||Date.now()-new Date(s.success).getTime()>36*3600000)?'数据过期':'正常';
      const verified=states.every(s=>freshness(s)==='正常' && s.status==='SUCCESS');
      const syncText=states.map(s=>`${BOM_SOURCE_NAMES[s.source as BomSource]}：${freshness(s)}，最近成功${s.success?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s.success)):'无'}${freshness(s)==='异常'&&s.generation?'（使用上次成功快照）':''}`).join('；');
      const heads:UnifiedBomHead[]=[];
      if (e10?.generation) {
        const rows=await m.query(`SELECT source_bom_id::text "bomId",item_code "itemCode",version_times version,last_modified_date::text "modifiedAt",approve_date::text "auditedAt" FROM rd_bom_master_heads WHERE tenant_id=$1 AND generation_id=$2 AND item_code=ANY($3::text[]) AND approve_status='Y'`,[tenant,e10.generation,codes]);
        heads.push(...rows.map((h:any)=>({...h,source:'e10-main' as BomSource,approved:true,disabled:false})));
      }
      const rows=await m.query(`SELECT h.source,h.source_bom_id::text "bomId",h.item_code "itemCode",h.bom_version version,h.source_modified_at::text "modifiedAt",h.source_audited_at::text "auditedAt",(h.voucher_state=189) approved,h.disabled FROM rd_tplus_bom_heads h JOIN rd_tplus_bom_sync_state s ON s.tenant_id=h.tenant_id AND s.source=h.source AND s.active_generation=h.generation_id WHERE h.tenant_id=$1 AND h.item_code=ANY($2::text[]) AND h.voucher_state=189 AND NOT h.disabled`,[tenant,codes]);
      heads.push(...rows);
      const reliableSources=new Set(states.filter(s=>freshness(s)==='正常'&&s.status==='SUCCESS').map(s=>s.source));
      return {enabled:true as const,matchReliable:createUnifiedBomMatcher(heads.filter(h=>reliableSources.has(h.source)),true),match:createUnifiedBomMatcher(heads,verified),syncText,warning:verified?null:syncText,verified,evidence:states};
  }
}
