import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env"), quiet: true });

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
};

const positiveInteger = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} 必须为正整数`);
  return value;
};

export function integrationConfig({ requireApiKey = true } = {}) {
  return {
    beginDate: process.env.TPLUS_BEGIN_DATE?.trim() || "2026-01-01",
    sqlFile: process.env.TPLUS_SQL_FILE?.trim() || "/data/automation/code/sql/TplusSQL/50_双账套有效订单统一报表.sql",
    sql: {
      server: process.env.TPLUS_SQL_HOST?.trim() || "127.0.0.1",
      port: positiveInteger("TPLUS_SQL_PORT", 14330),
      user: required("TPLUS_SQL_USER"),
      password: required("TPLUS_SQL_PASSWORD"),
      database: process.env.TPLUS_SQL_DATABASE?.trim() || "master",
      connectionTimeout: positiveInteger("TPLUS_SQL_CONNECTION_TIMEOUT_MS", 15_000),
      requestTimeout: positiveInteger("TPLUS_SQL_REQUEST_TIMEOUT_MS", 180_000),
      pool: { min: 0, max: 2, idleTimeoutMillis: 10_000 },
      options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true }
    },
    apiUrl: (process.env.KNPLAN_API_URL?.trim() || "http://127.0.0.1:15172/api/v1").replace(/\/$/, ""),
    apiKey: requireApiKey ? required("KNPLAN_TPLUS_API_KEY") : process.env.KNPLAN_TPLUS_API_KEY?.trim()
  };
}
