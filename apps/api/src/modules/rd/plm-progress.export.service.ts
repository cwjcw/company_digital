import {BadRequestException,ForbiddenException,Injectable,ServiceUnavailableException} from '@nestjs/common';
import ExcelJS from 'exceljs';
import {DataSource} from 'typeorm';
import {PlmProgressQueryService} from './plm-progress.query.service';
import type {RdActor} from './rd.types';
@Injectable()
export class PlmProgressExportService {
 constructor(private readonly query:PlmProgressQueryService,private readonly db:DataSource){}
 async export(tableKey:string,fields:unknown,actor:RdActor){
  if(tableKey!=='projects')throw new BadRequestException('不支持的PLM报表');
  const columns=this.query.exportColumns(fields,actor);if(!columns.length)throw new ForbiddenException('没有获权的可见导出字段');
  const snapshot=await this.query.read(actor);if(!snapshot.data)throw new ServiceUnavailableException('尚无成功同步的PLM快照');
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('项目明细');sheet.columns=columns.map(([key,label])=>({key,header:label,width:key==='name'?38:20}));sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true};
  const rows=[...snapshot.data.projects].sort((a,b)=>((b.progress??0)-(a.progress??0))||String(a.no??'').localeCompare(String(b.no??'')));
  for(const row of rows)sheet.addRow(Object.fromEntries(columns.map(([key])=>[key,key==='health'?row[key]==='red'?'红色预警':row[key]==='green'?'绿色正常':'未标记':key==='progress'?row[key]==null?null:row[key]/100:row[key]??null])));
  if(columns.some(([key])=>key==='progress'))sheet.getColumn('progress').numFmt='0.##%';
  // Metadata-only audit; no source projects, credentials or raw response bodies.
  await this.db.transaction(async m=>{await m.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);await m.query(`INSERT INTO audit_logs(actor_id,actor_name,resource,record_id,action,after_json,request_id,source,created_by,updated_by) VALUES($1::uuid,$2,'rd-plm-project-progress',$3::uuid,'EXPORT',$4::jsonb,$5,$6,$1::uuid,$1::uuid)`,[actor.userId,actor.username,snapshot.snapshotId,JSON.stringify({tenantId:actor.tenantId,snapshotId:snapshot.snapshotId,rowCount:rows.length,fields:columns.map(([key])=>key)}),actor.requestId,actor.source]);});
  return Buffer.from(await book.xlsx.writeBuffer());
 }
}
