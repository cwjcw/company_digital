import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { DataSource } from "typeorm";
import { AppModule } from "../../app.module";
import { PlanningApplicationService } from "./planning.application.service";
import { inferDivisionAssignments } from "./planning-division-source";
import { PlanningOrganizationDirectoryService } from "./planning-organization-directory.service";
import { PlanQueryService } from "./planning.query.service";
import type { PlanningActor } from "./planning.types";

async function run() {
  const positional = process.argv.slice(2).filter((value) => !value.startsWith("--"));
  const year = Number(positional[0] ?? 2026);
  const month = Number(positional[1] ?? 9);
  const dryRun = process.argv.includes("--dry-run");
  const application = await NestFactory.createApplicationContext(AppModule, { logger: ["error"], abortOnError: false });
  try {
    const dataSource = application.get(DataSource);
    const commands = application.get(PlanningApplicationService);
    const queries = application.get(PlanQueryService);
    const directory = application.get(PlanningOrganizationDirectoryService);
    const [admin] = await dataSource.query("SELECT id FROM users WHERE username=$1 AND enabled=true LIMIT 1", [process.env.ADMIN_USERNAME ?? "admin"]);
    const actor: PlanningActor = {
      tenantCode: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN", userId: admin?.id ?? null,
      permissions: ["*"], roles: ["SYSTEM_IMPORT"], requestId: `division-source-backfill:${randomUUID()}`, source: "IMPORT"
    };
    const period = await queries.getPeriodByMonth(year, month, actor);
    const draft = period?.versions.find((version) => version.status === "DRAFT");
    if (!draft) throw new Error(`${year} 年 ${month} 月没有可回填的 DRAFT 计划版本`);
    const [rows, organizations] = await Promise.all([
      queries.searchPlanItems({ versionId: draft.id, limit: 10_000 }, actor),
      directory.listEnabled()
    ]);
    const divisions = organizations.filter((organization) => /^事业[一二三四]部$/.test(organization.name));
    const duplicateNames = divisions.filter((division, index) => divisions.findIndex((candidate) => candidate.name === division.name) !== index);
    if (duplicateNames.length) throw new Error(`企业微信组织架构存在重名事业部：${[...new Set(duplicateNames.map((entry) => entry.name))].join("、")}`);
    const byName = new Map(divisions.map((division) => [division.name, division]));
    const byId = new Map(divisions.map((division) => [division.id, division.name]));
    const inferred = inferDivisionAssignments(rows, byId);
    if (inferred.unresolved.length) {
      throw new Error(`仍有 ${inferred.unresolved.length} 条计划无法从源文件归属唯一解析：${JSON.stringify(inferred.unresolved.slice(0, 10))}`);
    }
    const patches = rows.flatMap((row) => {
      const divisionName = inferred.assignments.get(row.id);
      const organization = divisionName ? byName.get(divisionName) : undefined;
      if (!organization) throw new Error(`事业部“${divisionName}”不在企业微信组织架构中`);
      return row.responsibleOrgId === organization.id ? [] : [{ id: row.id, field: "responsibleOrgId", value: organization.id, expectedVersion: row.version }];
    });
    if (!dryRun) {
      for (let index = 0; index < patches.length; index += 500) {
        await commands.bulkUpdate(draft.id, patches.slice(index, index + 500), actor);
      }
    }
    const counts = Object.fromEntries([...inferred.assignments.values()].reduce((map, name) => map.set(name, (map.get(name) ?? 0) + 1), new Map<string, number>()));
    process.stdout.write(`${JSON.stringify({ mode: dryRun ? "DRY_RUN" : "CONFIRMED", year, month, versionId: draft.id, total: rows.length, updated: dryRun ? 0 : patches.length, pending: patches.length, unchanged: rows.length - patches.length, divisions: counts }, null, 2)}\n`);
  } finally {
    await application.close();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
