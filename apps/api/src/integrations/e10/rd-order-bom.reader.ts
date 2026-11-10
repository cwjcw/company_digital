import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { E10BomBundle } from '../../modules/rd/rd-order-bom-report.calculator';

@Injectable()
export class RdOrderBomReader {
  private cache = new Map<string, { expiresAt: number; value: E10BomBundle }>();
  async read(itemCodes: string[]): Promise<E10BomBundle> {
    const codes = [...new Set(itemCodes.map(code => code.trim()).filter(Boolean))].sort();
    if (codes.length > 10000) throw new Error('E10品项核验超过单次读取上限，请缩小筛选范围');
    const key = codes.join('\u001f'), cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const script = process.env.RD_ORDER_BOM_E10_READER ?? path.resolve(process.cwd(), '../../data-operations/e10/rd_order_bom_reader.py');
    const python = process.env.RD_E10_PYTHON ?? '/data/automation/code/work/basci/basic_code/.venv/bin/python';
    const value = await new Promise<E10BomBundle>((resolve, reject) => {
      const child = spawn(python, [script], { env: { ...process.env, PYTHONPATH: process.env.RD_BASIC_CODE_ROOT ?? '/data/automation/code/work/basci/basic_code' } });
      let output = '', error = '', bytes = 0, settled = false;
      const fail = (reason: Error) => { if (!settled) { settled = true; child.kill(); reject(reason); } };
      const timer = setTimeout(() => fail(new Error('E10品项核验超时')), 30_000);
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.on('error', fail);
      child.stdout.on('data', (chunk: string) => { output += chunk; bytes += Buffer.byteLength(chunk); if (bytes > 16 * 1024 * 1024) fail(new Error('E10品项核验结果超过安全上限')); });
      child.stderr.on('data', (chunk: string) => { error = (error + chunk).slice(-400); });
      child.on('close', code => {
        clearTimeout(timer); if (settled) return;
        if (code !== 0) return fail(new Error(`E10品项只读查询失败${error ? `：${error}` : ''}`));
        try {
          const result = JSON.parse(output) as E10BomBundle;
          if (!result.sourceSnapshotAt || !Array.isArray(result.items)) throw new Error('E10品项核验结果契约无效');
          settled = true; resolve(result);
        } catch (reason) { fail(reason instanceof Error ? reason : new Error('E10品项核验结果解析失败')); }
      });
      child.stdin.on('error', fail); child.stdin.end(JSON.stringify(codes));
    });
    this.cache.set(key, { value, expiresAt: Date.now() + 60_000 });
    if (this.cache.size > 20) for (const [cacheKey, entry] of this.cache) if (entry.expiresAt <= Date.now() || this.cache.size > 20) this.cache.delete(cacheKey);
    return value;
  }
}
