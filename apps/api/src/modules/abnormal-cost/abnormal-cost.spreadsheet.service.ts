import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { tablePermissionFieldsFor, type AbnormalCostResource } from '@kdos/contracts';
import { SqlFilterCompiler } from '../../common/filtering/sql-filter.compiler';
import { assertSpreadsheetNotEncrypted } from '../../spreadsheet-upload';
import { AbnormalCostApplicationService } from './abnormal-cost.application.service';
import { costAssert, costCan, costColumns, costField, costResource, costScope, type AbnormalActor, type CostRow } from './abnormal-cost.policy';
import { costUuid } from './abnormal-cost.domain';
import { AbnormalCostGraphSpreadsheetService } from './abnormal-cost.graph-spreadsheet.service';
@Injectable()
export class AbnormalCostSpreadsheetService {
  constructor(private readonly app:AbnormalCostApplicationService,private readonly graph:AbnormalCostGraphSpreadsheetService){}
  private basic(code:AbnormalCostResource){if(!['abnormal-categories','incident-severity-levels','abnormal-expense-categories'].includes(code))throw new BadRequestException('基础资料资源无效');}
  async template(code:AbnormalCostResource,mode:string,query:Record<string,unknown>,actor:AbnormalActor){
    if(!['abnormal-categories','incident-severity-levels','abnormal-expense-categories'].includes(code))return this.graph.template(code,mode,query,actor);
    this.basic(code);costAssert(actor,code,'import');if(!['CREATE','UPDATE'].includes(mode))throw new BadRequestException('模板模式无效');
    const fields=tablePermissionFieldsFor(code).filter(f=>f.editable&&(mode==='CREATE'?(costField(actor,code,f.key,'read')||costField(actor,code,f.key,'update')||!costCan(actor,code,'read')):costField(actor,code,f.key,'read')&&costField(actor,code,f.key,'update')));
    const book=new ExcelJS.Workbook(),sheet=book.addWorksheet(costResource(code).label);
    sheet.columns=[{header:'记录ID',key:'id',width:38},{header:'版本',key:'version',width:12},...fields.map(f=>({header:f.label,key:f.key,width:24}))];
    sheet.getColumn(1).numFmt='@';for(const f of fields)if(f.type!=='number')sheet.getColumn(f.key).numFmt='@';
    if(mode==='UPDATE'){
      costAssert(actor,code,'read');costAssert(actor,code,'update');costAssert(actor,code,'batch_update');
      await this.app.transaction(actor,async m=>{
        const params:unknown[]=[actor.tenantId],clauses=[costScope(actor,code,'read',params),costScope(actor,code,'update',params),costScope(actor,code,'import',params),costScope(actor,code,'batch_update',params),'record.tenant_id=$1'];
        if(query.filterGroup)clauses.push(new SqlFilterCompiler(tablePermissionFieldsFor(code),Object.fromEntries(Object.entries(costColumns(code)).map(([k,v])=>[k,`record.${v}`])),key=>costField(actor,code,key,'read')).compile(query.filterGroup,params));
        if(query.search){params.push(`%${String(query.search)}%`);const searchable=fields.filter(f=>costField(actor,code,f.key,'read'));clauses.push(searchable.length?`(${searchable.map(f=>`record.${f.key}::text ILIKE $${params.length}`).join(' OR ')})`:'false');}
        const rows=await m.query(`SELECT record.* FROM ${costResource(code).table} record WHERE ${clauses.map(c=>`(${c})`).join(' AND ')} ORDER BY record.created_at DESC,record.id LIMIT 5001`,params);
        if(rows.length>5000)throw new BadRequestException('更新模板超过5000行，请缩小查询范围');rows.forEach((row:CostRow)=>sheet.addRow(row));
      });
    }
    book.addWorksheet('填写说明').addRows([['记录ID和版本同时空为新增，同时有效为更新；仅填一项拒绝；不得伪造身份。'],['空白不改；【清空】用于可空字段；错误行阻止整批提交；金额2位小数且区间不重叠。'],[...fields.map(f=>`${f.label}：${f.required?'必填':'可空'}`)]]);
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  async preview(code:AbnormalCostResource,buffer:Buffer,actor:AbnormalActor){
    if(!['abnormal-categories','incident-severity-levels','abnormal-expense-categories'].includes(code))return this.graph.preview(code,buffer,actor);
    this.basic(code);costAssert(actor,code,'import');assertSpreadsheetNotEncrypted(buffer);
    const book=new ExcelJS.Workbook();try{await book.xlsx.load(buffer as never);}catch{throw new BadRequestException('无效Excel文件');}
    const sheet=book.worksheets[0];if(!sheet||sheet.rowCount>5001)throw new BadRequestException('文件必须包含不超过5000行的数据');
    const definitions=tablePermissionFieldsFor(code).filter(f=>f.editable),keys:string[]=[];
    sheet.getRow(1).eachCell({includeEmpty:true},cell=>{const h=cell.text.trim(),key=h==='记录ID'?'id':h==='版本'?'expectedVersion':definitions.find(f=>f.label===h)?.key;if(!key||keys.includes(key))throw new BadRequestException(`表头无效或重复：${h}`);keys.push(key);});
    if(!keys.includes('id')||!keys.includes('expectedVersion')||keys.length<3)throw new BadRequestException('请使用正式Excel模板');
    const rows:CostRow[]=[],errors:Array<{row:number;reason:string}>=[],ids=new Set<string>();
    sheet.eachRow((row,index)=>{
      if(index===1||!row.hasValues)return;
      const input:CostRow={values:{},row:index};keys.forEach((key,i)=>{
        const cell=row.getCell(i+1);if(cell.value==null||cell.text.trim()==='')return;
        if(cell.type===ExcelJS.ValueType.Error||cell.type===ExcelJS.ValueType.Formula){errors.push({row:index,reason:'请使用明确单元格值，不接受公式或错误值'});return;}
        if(key==='id')input.id=cell.text.trim();else if(key==='expectedVersion')input.expectedVersion=Number(cell.text);else input.values[key]=cell.text==='【清空】'?null:cell.value;
      });
      if(Boolean(input.id)!==Boolean(input.expectedVersion))errors.push({row:index,reason:'记录ID和版本必须同时提供或同时留空'});
      if(input.id){try{input.id=costUuid(input.id);if(ids.has(input.id))throw new Error('记录ID重复');ids.add(input.id);}catch(error){errors.push({row:index,reason:(error as Error).message});}}
      rows.push(input);
    });
    if(!rows.length)throw new BadRequestException('没有可导入数据');
    // Validate through the same Application Commands and real transaction, then deliberately roll it back.
    class PreviewRollback extends Error {}
    if(!errors.length)try{await this.app.transaction(actor,async m=>{
      for(const row of rows){try{if(row.id){costAssert(actor,code,'update');costAssert(actor,code,'batch_update');await this.app.locked(m,code,row.id,'import',actor);await this.app.locked(m,code,row.id,'batch_update',actor);}else costAssert(actor,code,'create');
        const saved=await this.app.saveBasic(code,row.id??null,{...row.values,...(row.id?{expectedVersion:row.expectedVersion}:{})},actor,m);await this.app.locked(m,code,saved.id,'import',actor);
      }catch(error){errors.push({row:row.row,reason:(error as Error).message});break;}}
      throw new PreviewRollback();
    });}catch(error){if(!(error instanceof PreviewRollback))throw error;}
    const result:CostRow={resource:code,total:rows.length,rows,errors};
    if(!errors.length)result.previewId=await this.app.transaction(actor,async m=>{const [r]=await m.query('INSERT INTO abnormal_cost_import_previews(tenant_id,actor_id,resource,rows) VALUES($1,$2::uuid,$3,$4::jsonb) RETURNING id',[actor.tenantId,actor.userId,code,JSON.stringify(rows)]);return r.id;});
    return result;
  }
  async confirm(code:AbnormalCostResource,id:string,actor:AbnormalActor){if(!['abnormal-categories','incident-severity-levels','abnormal-expense-categories'].includes(code))return this.graph.confirm(code,id,actor);this.basic(code);costAssert(actor,code,'import');return this.app.transaction(actor,async m=>{
    const [preview]=await m.query('SELECT * FROM abnormal_cost_import_previews WHERE tenant_id=$1 AND actor_id=$2::uuid AND id=$3::uuid AND resource=$4 FOR UPDATE',[actor.tenantId,actor.userId,costUuid(id),code]);
    if(!preview)throw new NotFoundException('预览不存在');if(preview.result)return {...preview.result,repeated:true};if(new Date(preview.expires_at).getTime()<Date.now())throw new ConflictException('预览已过期，请重新上传');
    let created=0,updated=0;for(const row of preview.rows){if(row.id){costAssert(actor,code,'batch_update');await this.app.locked(m,code,row.id,'import',actor);await this.app.locked(m,code,row.id,'batch_update',actor);}const saved=await this.app.saveBasic(code,row.id??null,{...row.values,...(row.id?{expectedVersion:row.expectedVersion}:{})},actor,m);await this.app.locked(m,code,saved.id,'import',actor);if(row.id)updated++;else created++;}
    const result={created,updated,total:preview.rows.length};await this.app.audit(m,actor,code,null,`${code}.import_confirmed`,null,{...result,previewId:id});await m.query('UPDATE abnormal_cost_import_previews SET result=$2::jsonb WHERE id=$1::uuid',[id,JSON.stringify(result)]);return result;
  });}
}
