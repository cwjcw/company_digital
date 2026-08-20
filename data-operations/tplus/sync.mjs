#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { integrationConfig } from "./config.mjs";
import { writeOrderSnapshot } from "./api-writer.mjs";
import { readTplusOrders, sourceDatabases } from "./tplus-reader.mjs";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : null;

async function main() {
  const config = integrationConfig({ requireApiKey: !dryRun });
  const startedAt = Date.now();
  console.log(`开始读取 T+ 有效订单，日期范围：${config.beginDate} 至今天`);
  const orders = await readTplusOrders(config);
  const counts = Object.fromEntries(sourceDatabases.map((database) => [database,
    orders.filter((row) => row.sourceDatabase === database).length]));
  console.log(`读取完成，共 ${orders.length} 单；分账套：${JSON.stringify(counts)}`);
  if (!orders.length) throw new Error("查询结果为空，已停止同步");

  if (outputPath) {
    const resolved = path.resolve(outputPath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, `${JSON.stringify({ beginDate: config.beginDate, sourceDatabases, orders }, null, 2)}\n`, { mode: 0o600 });
    console.log(`快照已写入 ${resolved}`);
  }
  if (dryRun) {
    console.log(`只读检查完成，未调用写入 API；耗时 ${Date.now() - startedAt}ms`);
    return;
  }
  const result = await writeOrderSnapshot({ ...config, sourceDatabases }, orders);
  console.log(`API 写入完成：接收 ${result.received}，新增 ${result.inserted}，更新 ${result.updated}，停用 ${result.deactivated}；耗时 ${Date.now() - startedAt}ms`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
