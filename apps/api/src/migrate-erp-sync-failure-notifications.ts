import "reflect-metadata";
import { DataSource } from "typeorm";
import original from "./data-source";
import { ErpSyncFailureNotifications1722920133000 } from "./migrations/1722920133000-ErpSyncFailureNotifications";

async function main() {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const [key, ...value] = arg.split("=");
    if (!["--preflight", "--execute", "--confirm", "--expected-host", "--expected-database"].includes(key!) || args.has(key!)) throw new Error("Invalid migration argument");
    args.set(key!, value.join("=") || "true");
  }
  const execute = args.has("--execute");
  if (execute === args.has("--preflight") || !args.get("--expected-host") || !args.get("--expected-database")
    || (execute && args.get("--confirm") !== "APPLY-ERP-SYNC-FAILURE-NOTIFICATIONS-133")) throw new Error("Explicit preflight/execute, target and migration confirmation required");
  if (original.options.type !== "postgres" || original.options.host !== args.get("--expected-host")
    || original.options.database !== args.get("--expected-database")) throw new Error("Configured database differs from explicit target");

  const db = new DataSource({ ...original.options, entities: [], subscribers: [], migrations: [ErpSyncFailureNotifications1722920133000],
    migrationsRun: false, logging: false, extra: { ...original.options.extra, options: "-c lock_timeout=5000 -c statement_timeout=120000 -c transaction_timeout=180000" } });
  await db.initialize();
  try {
    const ledger: Array<{ timestamp: string }> = await db.query("SELECT timestamp FROM migrations");
    const applied = new Set(ledger.map(row => Number(row.timestamp)));
    if (!applied.has(1722920132000) || [...applied].some(timestamp => timestamp > 1722920132000)) throw new Error("Migration ledger differs from reviewed 132 baseline");
    const [identity] = await db.query(`SELECT COUNT(*)::int matches,BOOL_AND(enabled AND NULLIF(btrim(wechat_user_id),'') IS NOT NULL) ready
      FROM users WHERE tenant_id='KAINAN' AND display_name='崔玮杰' AND username='08134'`);
    if (identity?.matches !== 1 || identity?.ready !== true) throw new Error("崔玮杰唯一启用账号/企业微信映射校验失败");
    const [ruleState] = await db.query(`SELECT COUNT(*)::int count FROM notification_rules WHERE tenant_id='KAINAN' AND event_type='erp.sync.failed'`);
    if (Number(ruleState?.count ?? 0) > 1) throw new Error("ERP同步失败通知规则不唯一");
    const alreadyApplied = applied.has(1722920133000);
    let completed: string[] = [];
    if (execute && !alreadyApplied) {
      completed = (await db.runMigrations({ transaction: "all" })).map(row => row.name);
      if (completed.length !== 1 || completed[0] !== "ErpSyncFailureNotifications1722920133000") throw new Error("Unexpected migration set");
    }
    console.log(JSON.stringify({ status: execute ? "APPLIED" : "PREFLIGHT_OK", migration: 1722920133000, alreadyApplied, completed }));
  } finally { await db.destroy(); }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : "ERP sync notification migration failed"); process.exitCode = 1; });
