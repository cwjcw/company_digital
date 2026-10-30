import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import { standardProcesses } from '@tracker/shared';
import { mpsExternalProcessMappingResource as mappingResource, mpsOrderProgressResource, type MpsBomProcessView } from '@kdos/contracts';
import { KejiaBomReader } from '../../integrations/tplus/kejia-bom.reader';
import { MasterPlanOrderProgressService } from './master-plan.order-progress.service';
import { MasterPlanApplicationService } from './master-plan.application.service';
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from './master-plan.types';
import { bindBomProcesses, type ExternalProcessMapping } from './master-plan.bom-process.domain';

export interface BomProcessQuery { orderId?: string; itemId?: string }
@Injectable()
export class MasterPlanBomProcessService {
  constructor(private readonly db: DataSource, private readonly progress: MasterPlanOrderProgressService,
    private readonly reader: KejiaBomReader, private readonly application: MasterPlanApplicationService) {}
  read(q: BomProcessQuery, actor: MasterPlanActor) { return this.view(q, actor, 'read'); }
  private async view(q: BomProcessQuery, actor: MasterPlanActor, action: 'read' | 'export'): Promise<MpsBomProcessView> {
    if (!q.orderId || !q.itemId) throw new BadRequestException('请选择具体订单品项');
    if (!['bomConfiguration','orderNumber','itemCode','divisionId'].every(k => this.progress.allowed(actor,k))) throw new ForbiddenException('没有一级BOM工序匹配或其来源字段的查看权限');
    const page = await this.progress.page({ orderId:q.orderId,itemId:q.itemId,dateType:'NONE',onlyUnfinishedOrders:'false',onlyUnfinishedItems:'false',page:1,pageSize:50 }, actor, 'items', action);
    const row = page.rows.find(r => r.id === q.itemId);
    if (!row) throw new NotFoundException('订单品项不在当前授权范围');
    if (row.sourceKind !== '月计划') throw new BadRequestException('请先为该订单品项建立正式月计划');
    const context = await this.db.transaction('REPEATABLE READ', async m => {
      await m.query('SET TRANSACTION READ ONLY');
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      const [parent] = await m.query(`SELECT p.division_id,o.name division_name FROM mps_monthly_plans p
        JOIN organization_units o ON o.id=p.division_id
        WHERE p.tenant_id=$1 AND p.id=$2::uuid AND p.order_number=$3 AND p.item_code=$4`,[actor.tenantId,row.id,row.orderNumber,row.itemCode]);
      if (!parent) throw new NotFoundException('月计划或事业部不存在');
      const sources = await m.query(`SELECT DISTINCT source_key FROM mps_erp_order_lines WHERE tenant_id=$1
        AND order_number=$2 AND item_code=$3 AND source_database='UFTData418971_000003' AND source_active=true`,[actor.tenantId,row.orderNumber,row.itemCode]);
      const mappings: ExternalProcessMapping[] = await m.query(`SELECT id,version,created_by,source_process_code,mapping_mode,process_code,enabled
        FROM mps_external_process_mappings WHERE tenant_id=$1 AND division_id=$2::uuid AND source_key='tplus-kejia'`,[actor.tenantId,parent.division_id]);
      return { parent, sources, mappings };
    });
    const canConfigure = hasMasterPlanPermission(actor,mappingResource,'read') && ['create','update'].some(a => hasMasterPlanPermission(actor,mappingResource,a))
      && ['divisionId','sourceKey','sourceProcessCode','sourceProcessName','mappingMode','processCode','enabled'].every(f => hasMasterPlanFieldPermission(actor,mappingResource,f,'read'));
    const base: MpsBomProcessView = { supported:false,message:'按科加物料范围匹配BOM与工艺',divisionId:context.parent.division_id,divisionName:context.parent.division_name,
      facts:null,bindings:[],progress:[],progressFields:['processName'],unmappedCount:0,canConfigure,canExport:hasMasterPlanPermission(actor,mpsOrderProgressResource,'export') };
    // Division controls responsibility/mapping permissions, not material identity.
    // A unique ERP line can refine executed versions; absent/ambiguous lines use
    // the adapter's explicit Kejia material scope and version rules by item code.
    const line = context.sources.length === 1 && /^\d+$/.test(String(context.sources[0]?.source_key))
      ? String(context.sources[0].source_key) : undefined;
    const facts = await this.reader.read({ tenantId:actor.tenantId,orderNumber:String(row.orderNumber),itemCode:String(row.itemCode),
      ...(line ? { orderLineId:line } : {}) });
    const result = bindBomProcesses(facts,context.mappings);
    for (const b of result.bindings) {
      const current = context.mappings.find(m => m.source_process_code === b.sourceCode);
      b.canWrite = canConfigure && this.application.externalProcessMappingCanWrite({ ...current, division_id:context.parent.division_id,
        source_key:'tplus-kejia',source_process_code:b.sourceCode,created_by:current?.created_by??actor.userId },actor,!!current);
      if (!canConfigure) { delete b.id; delete b.version; delete b.mappingMode; }
    }
    const names = new Map(standardProcesses.map(p => [p.code as string,p.name]));
    const definitions = [['requiredQuantity','RequiredQuantity'],['reportedQuantity','ReportedQuantity'],['productionProgress','ProductionProgress'],['status','Status'],['lastReportDate','LastReportDate']] as const;
    // Each canonical process reads the already-authorized formal aggregate exactly once.
    const progressFields = ['processName', ...definitions.filter(([,suffix]) => result.processCodes.length>0 && result.processCodes.every(code => this.progress.allowed(actor,code+suffix))).map(([field]) => field)];
    const progress = result.processCodes.map(code => {
      const value: Record<string,string|number|null> = { processCode:code,processName:names.get(code)! };
      for (const [field,suffix] of definitions) if (progressFields.includes(field)) value[field] = row[code+suffix] ?? null;
      return value;
    });
    return {...base,supported:true,message:facts.message,facts,bindings:result.bindings,progress,progressFields,unmappedCount:result.bindings.filter(b => b.state==='UNMAPPED').length};
  }
  async export(q: BomProcessQuery, tableKey: string, actor: MasterPlanActor) {
    if (!['children','bindings','progress'].includes(tableKey)) throw new BadRequestException('未知BOM明细表');
    const view = await this.view(q,actor,'export');
    let columns: Array<[string,string]> = [], rows: Array<Record<string,unknown>> = [];
    if (tableKey === 'children') {
      columns=[['itemCode','子件品号'],['itemName','子件名称'],['bomVersion','主BOM版本'],['routeCode','来源路线编码'],['routeName','来源路线名称'],['source','工序来源'],['state','配置状态'],['processNames','来源工序']];
      rows=(view.facts?.children??[]).map(c => ({...c,state:c.state==='READY'?'已取到工序':c.state==='AMBIGUOUS'?'来源歧义':'无工序配置',processNames:c.processes.map(p => p.name).join(' → ')}));
    } else if (tableKey === 'bindings') {
      columns=[['sourceCode','ERP工序编码'],['sourceName','ERP工序名称'],['children','引用子件'],['processName','KDOS工序'],['state','绑定状态']];
      rows=view.bindings.map(b => ({...b,children:b.childCodes.join('、'),state:b.state==='MATCHED'?'已绑定':b.state==='IGNORED'?'不参与内部报工':'待绑定'}));
    } else {
      columns=([['processName','KDOS工序'],['requiredQuantity','月计划需求'],['reportedQuantity','累计实际报工'],['productionProgress','生产进度'],['status','工序状态'],['lastReportDate','最近报工日期']] as Array<[string,string]>).filter(([key]) => view.progressFields.includes(key));
      rows=view.progress.map(r => ({...r,productionProgress:r.productionProgress==null?null:new Decimal(String(r.productionProgress)).mul(100).toString()+'%'}));
    }
    const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('一级BOM工序');
    sheet.columns=columns.map(([key,header]) => ({key,header,width:24}));
    for (const row of rows) sheet.addRow(Object.fromEntries(columns.map(([key]) => [key,row[key]??null])));
    sheet.views=[{state:'frozen',ySplit:1}];
    await this.application.recordOrderProgressExport({tableKey:'bom-'+tableKey,rowCount:rows.length,fields:columns.map(([key])=>key)},actor);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
