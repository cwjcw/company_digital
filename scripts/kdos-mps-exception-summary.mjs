#!/usr/bin/env node
import { config } from "dotenv";

const projectRoot = "/data/automation/code/work/PMC/knweb";
config({ path: `${projectRoot}/.env` });

const kind = process.argv[2] ?? "daily";
if (kind !== "daily" && kind !== "initial") throw new Error("usage: kdos-mps-exception-summary.mjs [daily|initial]");
const token = String(process.env.KDOS_NOTIFICATION_INTERNAL_TOKEN ?? "").trim();
if (!token) throw new Error("KDOS通知内部凭据未配置");
const apiBase = String(process.env.KDOS_LOCAL_API_BASE_URL ?? "http://127.0.0.1:15172/api/v1").replace(/\/$/, "");
const response = await fetch(`${apiBase}/internal/master-plan/notifications/summary`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-kdos-internal-token": token,
    "x-kdos-tenant-id": String(process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN"),
    "x-kdos-worker-id": "n8n-mps-exception-summary"
  },
  body: JSON.stringify({ kind }),
  signal: AbortSignal.timeout(20000)
});
if (!response.ok) throw new Error(`主计划异常汇总入队失败，HTTP ${response.status}`);
const result = await response.json();
if (result.routeMissing === true) throw new Error("主计划异常群汇总路由尚未启用");
if (result.dataUnavailable === true) throw new Error("主计划异常汇总数据暂不可用");
if (result.created !== true && result.created !== false) throw new Error("主计划异常汇总返回格式无效");
process.stdout.write(`${JSON.stringify({ status: result.created ? "QUEUED" : "ALREADY_QUEUED", kind })}\n`);
