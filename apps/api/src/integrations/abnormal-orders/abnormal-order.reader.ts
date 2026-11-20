import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import type { AbnormalOrderSource,SourceOrderLine } from './abnormal-order.facts';
const databases={'e10-main':'E10_6.0.0.1.NEW.CHS','tplus-kainan':'UFTData741219_000012','tplus-kejia':'UFTData418971_000003'};
@Injectable()
export class AbnormalOrderReader {
 async read(source:AbnormalOrderSource):Promise<SourceOrderLine[]>{
  for(let attempt=0;attempt<2;attempt++){try{return await this.once(source);}catch{if(attempt===1)throw Error('ABNORMAL_ORDER_SOURCE_READ_FAILED');}}
  throw Error('ABNORMAL_ORDER_SOURCE_READ_FAILED');
 }
 private async once(source:AbnormalOrderSource){
  if(!Object.hasOwn(databases,source))throw Error('ABNORMAL_ORDER_SOURCE_INVALID');
  const child=spawn(process.env.RD_E10_PYTHON??'/data/automation/code/work/basci/basic_code/.venv/bin/python',[path.resolve(process.cwd(),'../../data-operations/abnormal-orders/reader.py')],{env:{...process.env,PYTHONPATH:process.env.RD_BASIC_CODE_ROOT??'/data/automation/code/work/basci/basic_code'},stdio:['pipe','pipe','pipe']});
  const closed=new Promise<number|null>(resolve=>{child.once('error',()=>resolve(-1));child.once('close',resolve);});
  const timer=setTimeout(()=>child.kill('SIGKILL'),180000);let begin=false,end=false,bytes=0;const rows:SourceOrderLine[]=[];
  child.stderr.resume();child.stdin.on('error',()=>undefined);child.stdin.end(JSON.stringify({source}));
  try{for await(const line of createInterface({input:child.stdout,crlfDelay:Infinity})){
   bytes+=Buffer.byteLength(line);if(bytes>150_000_000||line.length>5_000_000||end)throw Error('ABNORMAL_ORDER_PROTOCOL_INVALID');const e=JSON.parse(line);
   if(e.type==='begin'&&!begin&&e.source===source&&e.database===databases[source])begin=true;
   else if(e.type==='page'&&begin&&Array.isArray(e.records)&&e.records.length<=1000){rows.push(...e.records);if(rows.length>200000)throw Error('ABNORMAL_ORDER_LIMIT');}
   else if(e.type==='end'&&begin&&e.source===source&&e.verified===true&&e.scanned===rows.length&&/^[0-9a-f]{64}$/.test(e.digest))end=true;
   else throw Error('ABNORMAL_ORDER_PROTOCOL_INVALID');
  }if(await closed!==0||!begin||!end)throw Error('ABNORMAL_ORDER_INCOMPLETE');return rows;
  }finally{clearTimeout(timer);child.kill('SIGKILL');await closed;}
 }
}
