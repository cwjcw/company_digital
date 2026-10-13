import type { MigrationInterface, QueryRunner } from "typeorm";
/** Independent finance classifications; never changes PMC mappings or ERP data. */
export class FinanceCustomerMappings1722920088000 implements MigrationInterface {
    name = "FinanceCustomerMappings1722920088000";
    async up(r: QueryRunner) {
        await r.query(`CREATE TABLE finance_customer_mappings (
      id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
      customer_code varchar(128) NOT NULL CHECK(btrim(customer_code)<>'' AND customer_code=btrim(customer_code)),
      department_category varchar(32) CHECK(department_category IN ('业务一部','业务二部','业务三部','业务四部')),
      sales_channel varchar(16) CHECK(sales_channel IN ('内销','外销')),
      source varchar(32) NOT NULL CHECK(source IN ('INITIAL_IMPORT','E10_SYNC')),
      version integer NOT NULL DEFAULT 1 CHECK(version>0),
      created_by uuid NOT NULL REFERENCES users(id), updated_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(tenant_id,customer_code), UNIQUE(tenant_id,id));
      CREATE INDEX finance_customer_mappings_categories ON finance_customer_mappings(tenant_id,department_category,sales_channel);
      CREATE TABLE finance_customer_sync_runs (
      id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, run_key varchar(180) NOT NULL,
      source varchar(32) NOT NULL CHECK(source IN ('INITIAL_IMPORT','E10_SYNC')),
      started_at timestamptz NOT NULL, completed_at timestamptz NOT NULL DEFAULT now(),
      read_count integer NOT NULL DEFAULT 0, created_count integer NOT NULL DEFAULT 0,
      skipped_count integer NOT NULL DEFAULT 0, error_count integer NOT NULL DEFAULT 0,
      status varchar(16) NOT NULL CHECK(status IN ('SUCCESS','FAILED')), error_summary varchar(500),
      actor_id uuid NOT NULL REFERENCES users(id), UNIQUE(tenant_id,run_key));
      CREATE INDEX finance_customer_sync_runs_latest ON finance_customer_sync_runs(tenant_id,source,completed_at DESC);`);
        for (const table of ["finance_customer_mappings", "finance_customer_sync_runs"]) {
            await r.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY ${table}_tenant ON ${table} USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));`);
        }
    }
    async down() { throw new Error("Finance classifications must be retained; roll back the application without dropping tables."); }
}
