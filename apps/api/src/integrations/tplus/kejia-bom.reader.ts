import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { BomProcessFacts } from '@kdos/contracts';

export interface KejiaBomRequest { tenantId: string; orderNumber: string; itemCode: string; orderLineId: string }
@Injectable()
export class KejiaBomReader {
  private readonly cache = new Map<string, { expires: number; promise: Promise<BomProcessFacts> }>();
  read(input: KejiaBomRequest): Promise<BomProcessFacts> {
    if (!/^\d+$/.test(input.orderLineId)) throw new ServiceUnavailableException('科加订单明细来源ID无效');
    const key = JSON.stringify(input), prior = this.cache.get(key);
    if (prior && prior.expires > Date.now()) return prior.promise;
    if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
    const promise = this.capture(input).catch(error => { if (this.cache.get(key)?.promise === promise) this.cache.delete(key); throw error; });
    this.cache.set(key, { expires: Date.now() + 120_000, promise });
    return promise;
  }
  private capture(input: KejiaBomRequest): Promise<BomProcessFacts> {
    return new Promise((resolve, reject) => {
      const python = process.env.RD_E10_PYTHON ?? '/data/automation/code/work/basci/basic_code/.venv/bin/python';
      const script = process.env.TPLUS_BOM_READER ?? path.resolve(process.cwd(), '../../data-operations/tplus/kejia-bom-reader.py');
      const child = spawn(python, [script], { env: { ...process.env, PYTHONPATH: process.env.RD_BASIC_CODE_ROOT ?? '/data/automation/code/work/basci/basic_code' } });
      let output = '', settled = false;
      const fail = () => { if (!settled) { settled = true; child.kill(); reject(new ServiceUnavailableException('科加一级BOM读取失败或超时，请稍后重试')); } };
      const timer = setTimeout(fail, 120_000);
      child.on('error', fail); child.stdin.on('error', fail);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { output += chunk; if (Buffer.byteLength(output) > 8 * 1024 * 1024) fail(); });
      // Driver errors can contain credentials. Consume stderr without returning or logging its contents.
      child.stderr.resume();
      child.on('close', code => {
        clearTimeout(timer); if (settled) return; if (code !== 0) return fail();
        try {
          const facts = JSON.parse(output) as BomProcessFacts;
          if (facts.sourceKey !== 'tplus-kejia' || facts.sourceDatabase !== 'UFTData418971_000003' || facts.orderLineId !== input.orderLineId
            || facts.orderNumber !== input.orderNumber || facts.itemCode !== input.itemCode || !facts.observedAt
            || !['READY','NO_BOM','AMBIGUOUS'].includes(facts.state) || !Array.isArray(facts.children) || facts.children.length > 2000 || !Array.isArray(facts.catalog)) return fail();
          if (facts.children.some(c => !c.id || !c.itemCode || !Array.isArray(c.processes) || c.processes.some(p => typeof p.code !== 'string' || !p.code || typeof p.name !== 'string'))) return fail();
          settled = true; resolve(facts);
        } catch { fail(); }
      });
      child.stdin.end(JSON.stringify(input));
    });
  }
}
