#!/usr/bin/env node
/** Creates disposable databases only; no business DB rows are read or changed. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parse } from "dotenv";
import pg from "pg";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  apiRequire = createRequire(path.join(root, "apps/api/package.json"));
const env = parse(fs.readFileSync(path.join(root, ".env")));
const connection = {
  host: process.env.KNOWLEDGE_TEST_POSTGRES_HOST ?? "127.0.0.1",
  port: Number(process.env.KNOWLEDGE_TEST_POSTGRES_PORT ?? 15433),
  user: env.DATABASE_USER,
  password: env.DATABASE_PASSWORD,
};
const suffix = `${Date.now()}_${process.pid}`,
  fixture = `knowledge_test_fixture_${suffix}`,
  fresh = `knowledge_test_fresh_${suffix}`,
  created = [];
const admin = new pg.Client({ ...connection, database: "postgres" });
const { DataSource } = apiRequire("typeorm"),
  { AuditLog } = apiRequire("./dist/entities"),
  { validateKnowledgeDatabase } = apiRequire(
    "./dist/modules/knowledge/knowledge.database-validation",
  );
let fixtureSource, freshSource;
try {
  await admin.connect();
  for (const name of [fixture, fresh]) {
    if (!/^knowledge_test_[a-z0-9_]+$/.test(name))
      throw new Error("Unsafe database name");
    await admin.query(`CREATE DATABASE ${name}`);
    created.push(name);
  }
  fixtureSource = new DataSource({
    type: "postgres",
    host: connection.host,
    port: connection.port,
    username: connection.user,
    password: connection.password,
    database: fixture,
    entities: [AuditLog],
    logging: false,
  });
  await fixtureSource.initialize();
  const report = await validateKnowledgeDatabase(fixtureSource);
  await fixtureSource.destroy();
  Object.assign(process.env, {
    ...env,
    DATABASE_HOST: connection.host,
    DATABASE_PORT: String(connection.port),
    DATABASE_NAME: fresh,
    KDOS_DEFAULT_TENANT_CODE: env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN",
  });
  freshSource = apiRequire("./dist/data-source").default;
  if (freshSource.options.database !== fresh)
    throw new Error("Fresh migration database guard failed");
  await freshSource.initialize();
  const migrations = await freshSource.runMigrations();
  const spaces = await freshSource.query(
    "SELECT code,name FROM knowledge_spaces",
  );
  if (spaces.length !== 1 || spaces[0].code !== "HR")
    throw new Error("Fresh HR seed validation failed");
  await freshSource.destroy();
  const result = {
    ...report,
    freshMigration: {
      status: "PASS",
      migrationCount: migrations.length,
      lastMigration: migrations.at(-1)?.name,
      spaces,
    },
    validatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(root, "outputs/KNOWLEDGE_2_1_DATABASE_VALIDATION.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    `Knowledge database PASS: ${report.count} scenarios; ${migrations.length} fresh migrations.`,
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Knowledge validation failed",
  );
  process.exitCode = 1;
} finally {
  if (fixtureSource?.isInitialized) await fixtureSource.destroy();
  if (freshSource?.isInitialized) await freshSource.destroy();
  for (const name of created)
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`).catch(() => {
      console.error("Disposable test database cleanup failed");
      process.exitCode = 1;
    });
  await admin.end();
}
