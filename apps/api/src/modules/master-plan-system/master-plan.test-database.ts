import { DataSource, type QueryRunner } from "typeorm";
import { MasterPlanSystem1722920047000 as Initial } from "../../migrations/1722920047000-MasterPlanSystem";
import { MasterPlanIntegrityAndOutbox1722920048000 as Integrity } from "../../migrations/1722920048000-MasterPlanIntegrityAndOutbox";
import { MasterPlanShippingMonthlyReference1722920049000 as ShippingReference } from "../../migrations/1722920049000-MasterPlanShippingMonthlyReference";
import { MasterPlanManualCreationAndDailyReporting1722920050000 as Manual } from "../../migrations/1722920050000-MasterPlanManualCreationAndDailyReporting";
import { MasterPlanReportDivisions1722920051000 as Divisions } from "../../migrations/1722920051000-MasterPlanReportDivisions";
import { MasterPlanExecutionEligibility1722920052000 as Eligibility } from "../../migrations/1722920052000-MasterPlanExecutionEligibility";
import { MasterPlanNonnegativeQuantities1722920054000 as Nonnegative } from "../../migrations/1722920054000-MasterPlanNonnegativeQuantities";
import { MasterPlanWeeklyIdentity1722920056000 as Identity } from "../../migrations/1722920056000-MasterPlanWeeklyIdentity";
import { MasterPlanDeliveryCodeAuto1722920075000 as Codes } from "../../migrations/1722920075000-MasterPlanDeliveryCodeAuto";
import { MasterPlanProcessCodeConstraint1722920059000 as ProcessCodes } from "../../migrations/1722920059000-MasterPlanProcessCodeConstraint";
import { MpsProcessRoutingV11722920107000 as Routing } from "../../migrations/1722920107000-MpsProcessRoutingV1";
import { MpsProcessDueDateRefreshV11722920108000 as Dates } from "../../migrations/1722920108000-MpsProcessDueDateRefresh";
import { MpsSyncLeases1722920118000 as Leases } from "../../migrations/1722920118000-MpsSyncLeases";

/** Dedicated Unix socket, synthetic schema and data only. Never accepts a DSN. */
export async function createMpsTestDatabase(schema: "sync_1a_fixture" | "facts_1b_fixture" | "lifecycle_1c_fixture", actor: string, division: string) {
  const socket = process.env.KDOS_SYNC_RELIABILITY_TEST_SOCKET;
  if (!socket?.endsWith("/test/mps_sync_reliability/pg_socket")) throw Error("Only dedicated network-none test socket is allowed");
  const db = new DataSource({ type: "postgres", host: socket, username: "postgres", database: "mps_sync_1a_test", entities: [], poolSize: 8,
    extra: { options: `-c search_path=${schema},public` }, logging: false });
  await db.initialize();
  await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`);
  await db.query(`CREATE TABLE supply_chain_suppliers(id uuid PRIMARY KEY);
    CREATE TABLE users(id uuid PRIMARY KEY,username text UNIQUE,display_name text,password_hash text,enabled boolean DEFAULT true,must_change_password boolean,created_by uuid,updated_by uuid);
    CREATE TABLE organization_units(id uuid PRIMARY KEY,name text,enabled boolean DEFAULT true);
    CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id text,actor_id uuid,actor_name text,resource text,record_id varchar,action text,before_json jsonb,after_json jsonb,request_id text NOT NULL,source text,created_by uuid,updated_by uuid,created_at timestamptz DEFAULT clock_timestamp());
    CREATE TABLE fixture_effects(tenant_id text,business_key text,PRIMARY KEY(tenant_id,business_key));
    INSERT INTO users(id,username,display_name)VALUES('${actor}','synthetic','合成用户');
    INSERT INTO organization_units(id,name)VALUES('${division}','合成事业部');`);
  const migrationRunner = { query: (sql: string, args?: unknown[]) => db.query(sql, args) } as QueryRunner;
  for (const Migration of [Initial, Integrity, ShippingReference, Manual, Divisions, Eligibility, Nonnegative, Identity, Codes, ProcessCodes, Routing, Dates]) await new Migration().up(migrationRunner);
  await db.query("ALTER TABLE mps_sync_logs ADD COLUMN metrics jsonb; ALTER TABLE mps_reconciliation_outbox ADD COLUMN scope_json jsonb,ADD COLUMN record_id uuid");
  await new Leases().up(migrationRunner);
  return db;
}
