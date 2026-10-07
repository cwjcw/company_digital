import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { SourceBundle, Watermark } from '../../modules/pmc-rd-progress/pmc-rd-progress.types';

@Injectable()
export class PmcRdProgressReader {
  read(mode: 'FULL' | 'INCREMENTAL', before: Watermark | null, customerCodes: string[] = []): Promise<SourceBundle> {
    const script = process.env.PMC_RD_E10_READER ?? path.resolve(process.cwd(),'../../data-operations/e10/pmc_rd_progress_reader.py');
    const python = process.env.RD_E10_PYTHON ?? '/data/automation/code/work/basci/basic_code/.venv/bin/python';
    return new Promise((resolve,reject) => {
      const child = spawn(python,[script,'--mode',mode],{env: {...process.env,PYTHONPATH:process.env.RD_BASIC_CODE_ROOT ?? '/data/automation/code/work/basci/basic_code'}});
      let output = '', error = '', bytes = 0; let settled = false;
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      const fail = (reason: Error) => { if (!settled) { settled=true; child.kill(); reject(reason); } };
      const timer = setTimeout(() => fail(new Error('E10研发进度读取超时')),10*60*1000);
      child.on('error',fail);
      child.stdout.on('data',(chunk: string) => { output += chunk; bytes += Buffer.byteLength(chunk); if (bytes > 128*1024*1024) fail(new Error('E10事实数据超过读取上限')); });
      child.stderr.on('data',(chunk: string) => { error = (error+chunk).slice(-1000); });
      child.on('close',code => {
        clearTimeout(timer); if (settled) return;
        if (code !== 0) return fail(new Error(`E10只读读取失败：${error}`));
        try { const bundle = JSON.parse(output) as SourceBundle; if (!bundle.sourceSnapshotAt || !Array.isArray(bundle.orders) || !Array.isArray(bundle.candidateLineIds) || !bundle.watermark?.sources) throw new Error('E10事实契约不完整'); settled=true; resolve(bundle); } catch (reason) { fail(reason instanceof Error ? reason : new Error('E10事实解析失败')); }
      });
      child.stdin.on('error',fail);
      child.stdin.end(JSON.stringify(before ? {...before,customerCodes} : null));
    });
  }
}
