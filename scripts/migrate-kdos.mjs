import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { config } from "dotenv";
import pg from "pg";

config({ path: path.resolve(process.cwd(), ".env"), quiet: true });

const pool = new pg.Pool({
  host: process.env.KDOS_DATABASE_HOST ?? process.env.DATABASE_HOST ?? "127.0.0.1",
  port: Number(process.env.KDOS_DATABASE_PORT ?? process.env.DATABASE_PORT ?? 5432),
  user: process.env.KDOS_DATABASE_USER ?? process.env.DATABASE_USER ?? "postgres",
  password: process.env.KDOS_DATABASE_PASSWORD ?? process.env.DATABASE_PASSWORD,
  database: process.env.KDOS_DATABASE_NAME ?? "kdos",
  application_name: "kdos-migration"
});

const directory = path.resolve(process.cwd(), "database/migrations");
const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();

try {
  await pool.query("CREATE SCHEMA IF NOT EXISTS core");
  await pool.query(`CREATE TABLE IF NOT EXISTS core.schema_migrations (
    id varchar(160) PRIMARY KEY,
    checksum varchar(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const file of files) {
    const source = await readFile(path.join(directory, file), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    const existing = await pool.query("SELECT checksum FROM core.schema_migrations WHERE id = $1", [file]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`已应用 migration ${file} 的校验和发生变化`);
      process.stdout.write(`SKIP ${file}\n`);
      continue;
    }
    await pool.query(source);
    await pool.query("INSERT INTO core.schema_migrations(id, checksum) VALUES ($1, $2)", [file, checksum]);
    process.stdout.write(`APPLIED ${file}\n`);
  }
} finally {
  await pool.end();
}
