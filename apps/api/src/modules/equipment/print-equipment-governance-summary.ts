import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { EquipmentQueryService } from "./equipment.query.service";
import type { EquipmentActor } from "./equipment.types";

export const DAILY_DIVISIONS = ["事业一部", "事业二部", "事业三部", "事业四部", "研发中心"];
const canonicalName = (name: string) => name.replace(/^凯南(?=事业[一二三四]部$)/, "");

/** Thin read-only adapter. All counts, status precedence, minutes and utilization
 * remain owned by dashboard(); no parallel business SQL or averaged percentages. */
export async function dailySummary(queries: Pick<EquipmentQueryService, "dashboard">, reportDate: string, tenantId: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || Number.isNaN(Date.parse(`${reportDate}T00:00:00Z`)) || new Date(`${reportDate}T00:00:00Z`).toISOString().slice(0, 10) !== reportDate) throw new Error("日报日期必须为有效 YYYY-MM-DD");
  const discovery: EquipmentActor = { tenantId, userId: null, username: "设备日报只读任务", permissions: ["equipment-dashboard:*:read"], tableDataScopes: [{ resource: "equipment-dashboard", scope: "ALL", actions: ["read"] }], requestId: `equipment-daily-${randomUUID()}` };
  const initial = await queries.dashboard({ periodType: "day", period: reportDate }, discovery);
  const ids = DAILY_DIVISIONS.flatMap(name => {
    const matches = initial.filters.divisions.filter((unit: { id: string; name: string }) => canonicalName(unit.name) === name);
    if (matches.some((unit: { id: string | null }) => !unit.id) || new Set(matches.map((unit: { id: string }) => unit.id)).size > 1) throw new Error(`日报单位归属不明确：${name}`);
    return matches.slice(0, 1).map((unit: { id: string }) => unit.id);
  });
  const actor: EquipmentActor = { ...discovery, tableDataScopes: [{ resource: "equipment-dashboard", scope: "CUSTOM", actions: ["read"], rules: [{ fieldKey: "divisionId", operator: "IN", value: ids }] }] };
  const days = [];
  let reporting: any;
  for (let offset = -6; offset <= 0; offset++) {
    const date = new Date(`${reportDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + offset);
    const day = date.toISOString().slice(0, 10);
    const dashboard = await queries.dashboard({ periodType: "day", period: day }, actor);
    days.push({ date: day, metrics: dashboard.metrics, divisionRows: dashboard.divisionRows });
    if (offset === 0) reporting = dashboard.operationsMonitoring;
  }
  // No equipment/person IDs, contacts or unrestricted discovery payload in output.
  return { schemaVersion: 1, reportDate, startDate: days[0]!.date, endDate: reportDate, divisions: DAILY_DIVISIONS, days, reporting };
}

export async function run(reportDate: string) {
  const db = new DataSource({ type: "postgres", host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT), username: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME, logging: false, poolSize: 1 });
  await db.initialize();
  try {
    const summary = await db.transaction("REPEATABLE READ", async manager => {
      await manager.query("SET TRANSACTION READ ONLY");
      await manager.query("SELECT set_config('app.tenant_id',$1,true),set_config('TimeZone','Asia/Shanghai',true),set_config('statement_timeout','20000',true)", [process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN"]);
      return dailySummary(new EquipmentQueryService(manager as unknown as DataSource), reportDate, process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN");
    });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally { await db.destroy(); }
}

if (require.main === module) run(process.argv[2] ?? "").catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1;
});
