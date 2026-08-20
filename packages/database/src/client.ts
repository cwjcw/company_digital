import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { schema, type KdosSchema } from "./schema";

export type KdosDatabase = NodePgDatabase<KdosSchema>;

export interface KdosDatabaseClient {
  pool: Pool;
  db: KdosDatabase;
  close(): Promise<void>;
}

export function kdosPoolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  return {
    host: env.KDOS_DATABASE_HOST ?? env.DATABASE_HOST ?? "127.0.0.1",
    port: Number(env.KDOS_DATABASE_PORT ?? env.DATABASE_PORT ?? 5432),
    user: env.KDOS_DATABASE_USER ?? env.DATABASE_USER ?? "postgres",
    password: env.KDOS_DATABASE_PASSWORD ?? env.DATABASE_PASSWORD,
    database: env.KDOS_DATABASE_NAME ?? "kdos",
    max: Number(env.KDOS_DATABASE_POOL_MAX ?? 10),
    application_name: "kdos-api"
  };
}

export function createKdosDatabase(config: PoolConfig = kdosPoolConfig()): KdosDatabaseClient {
  const pool = new Pool(config);
  const db = drizzle(pool, { schema });
  return { pool, db, close: () => pool.end() };
}
