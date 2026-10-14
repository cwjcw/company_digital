import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
/** Integration boundary: Python owns verified SQL; all writes stay in Finance Commands. */
@Injectable()
export class FinanceOrderReader {
  async read(consume:(page:Record<string,any>)=>Promise<void>,checkpoint?:Record<string,unknown>) {
    const child=spawn(process.env.RD_E10_PYTHON ?? '/data/automation/code/work/PMC/knweb/automation/customer_import/.venv/bin/python',
      [path.resolve(process.cwd(),'../../data-operations/e10/finance_order_reader.py')], {env:{...process.env},stdio:['pipe','pipe','pipe']});
    child.stdin.on('error',()=>undefined);
    child.stdin.end(JSON.stringify(checkpoint??null));
    const timer=setTimeout(()=>child.kill('SIGKILL'),15*60*1000);
    const done=new Promise<void>((resolve,reject)=>{child.on('error',()=>reject(new Error('E10只读适配器不可用')));child.on('close',code=>code===0?resolve():reject(new Error('E10读取失败，请检查受控数据源连接')));});
    // Attach immediately so early process failure cannot create an unhandled rejection.
    void done.catch(()=>undefined);
    child.stderr.resume();
    try { for await (const line of createInterface({input:child.stdout,crlfDelay:Infinity})) {
      if(Buffer.byteLength(line)>4*1024*1024) throw new Error('E10页超过限制');
      await consume(JSON.parse(line));
    } await done; } finally {clearTimeout(timer);if(child.exitCode===null)child.kill('SIGKILL');}
  }
}
