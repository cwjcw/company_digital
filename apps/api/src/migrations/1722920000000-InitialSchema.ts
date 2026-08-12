import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1722920000000 implements MigrationInterface {
  name = "InitialSchema1722920000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username varchar NOT NULL UNIQUE,
        display_name varchar NOT NULL, password_hash varchar NOT NULL, enabled boolean NOT NULL DEFAULT true,
        division varchar, must_change_password boolean NOT NULL DEFAULT true, last_login_at timestamptz
      );
      CREATE TABLE roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar NOT NULL UNIQUE, description varchar
      );
      CREATE TABLE user_roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE, UNIQUE(user_id, role_id)
      );
      CREATE TABLE permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        resource varchar NOT NULL, field_key varchar NOT NULL DEFAULT '*',
        "read" boolean NOT NULL DEFAULT false, "create" boolean NOT NULL DEFAULT false,
        "update" boolean NOT NULL DEFAULT false, "delete" boolean NOT NULL DEFAULT false,
        "import" boolean NOT NULL DEFAULT false, "export" boolean NOT NULL DEFAULT false,
        UNIQUE(role_id, resource, field_key)
      );
      CREATE TABLE role_data_scopes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        division varchar NOT NULL, UNIQUE(role_id, division)
      );
      CREATE TABLE plan_periods (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), year smallint NOT NULL, month smallint NOT NULL,
        status varchar NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_plan_period_month CHECK (month BETWEEN 1 AND 12), UNIQUE(year, month)
      );
      CREATE TABLE orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_number varchar NOT NULL, order_date date,
        customer_due_date date, review_due_date date, exception_due_date date,
        exception_delivery_method varchar, customer varchar, division varchar,
        version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT ck_order_version CHECK (version > 0)
      );
      CREATE INDEX idx_orders_number ON orders(order_number);
      CREATE INDEX idx_orders_division ON orders(division);
      CREATE TABLE order_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        period_id uuid NOT NULL REFERENCES plan_periods(id) ON DELETE RESTRICT, item_number varchar NOT NULL,
        relation_key varchar NOT NULL, item_name varchar, container_date date, model_age varchar,
        image_refs jsonb, product_attribute varchar, surface_nature varchar, special_item varchar,
        production_quantity numeric(18,4), historical_inbound_quantity numeric(18,4),
        today_inbound_quantity numeric(18,4), handling_method varchar, plan_page numeric,
        order_exception varchar, inspection varchar, inspection_quantity numeric, remark varchar,
        order_weeks numeric, source_month smallint, unit_price numeric(18,4), active boolean NOT NULL DEFAULT true,
        version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_item_version CHECK (version > 0),
        CONSTRAINT ck_image_refs_array CHECK (image_refs IS NULL OR (jsonb_typeof(image_refs)='array' AND jsonb_array_length(image_refs) <= 2)),
        UNIQUE(period_id, order_id, item_number)
      );
      CREATE INDEX idx_order_items_period_order ON order_items(period_id, order_id);
      CREATE TABLE outsourcing_details (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_item_id uuid NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
        supplier varchar, method varchar, due_date date, exception_due_date date
      );
      CREATE TABLE process_definitions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar NOT NULL UNIQUE, name varchar NOT NULL,
        sort_order smallint NOT NULL, enable_required_days boolean NOT NULL DEFAULT false,
        enable_due_date boolean NOT NULL DEFAULT true, enable_status boolean NOT NULL DEFAULT true,
        enable_exception boolean NOT NULL DEFAULT false, enabled boolean NOT NULL DEFAULT true
      );
      CREATE TABLE item_process_progress (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
        process_definition_id uuid NOT NULL REFERENCES process_definitions(id) ON DELETE RESTRICT,
        required_days numeric(8,2), due_date date, status varchar, exception varchar,
        version integer NOT NULL DEFAULT 1, CONSTRAINT ck_progress_version CHECK (version > 0),
        CONSTRAINT ck_required_days CHECK (required_days IS NULL OR required_days >= 0),
        UNIQUE(order_item_id, process_definition_id)
      );
      CREATE TABLE dictionary_types (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar NOT NULL UNIQUE, name varchar NOT NULL
      );
      CREATE TABLE dictionary_values (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type_id uuid NOT NULL REFERENCES dictionary_types(id) ON DELETE CASCADE,
        value varchar NOT NULL, sort_order integer NOT NULL DEFAULT 0, enabled boolean NOT NULL DEFAULT true,
        UNIQUE(type_id, value)
      );
      CREATE TABLE suppliers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar NOT NULL UNIQUE,
        enabled boolean NOT NULL DEFAULT true, remark varchar
      );
      CREATE TABLE audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid, actor_name varchar, resource varchar NOT NULL,
        record_id varchar, action varchar NOT NULL, before_json jsonb, after_json jsonb,
        request_id varchar NOT NULL, source varchar NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_audit_source CHECK (source IN ('web','api','import'))
      );
      CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
      CREATE TABLE api_keys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar NOT NULL, key_hash varchar NOT NULL UNIQUE,
        scopes jsonb NOT NULL, expires_at timestamptz, last_used_at timestamptz, enabled boolean NOT NULL DEFAULT true
      );
      CREATE TABLE import_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), file_name varchar NOT NULL, file_hash varchar NOT NULL,
        status varchar NOT NULL, summary jsonb, preview_payload jsonb, created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_import_jobs_hash ON import_jobs(file_hash);
      CREATE TABLE import_job_errors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
        sheet_name varchar NOT NULL, row_number integer, field_key varchar, level varchar NOT NULL, message varchar NOT NULL
      );
      CREATE TABLE idempotency_keys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key varchar NOT NULL UNIQUE,
        request_hash varchar NOT NULL, response_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION create_monthly_plan(target_year integer, target_month integer)
      RETURNS uuid LANGUAGE plpgsql AS $$
      DECLARE new_period uuid; previous_period uuid;
      BEGIN
        INSERT INTO plan_periods(year, month, status) VALUES(target_year, target_month, 'active')
        ON CONFLICT(year, month) DO UPDATE SET status=EXCLUDED.status RETURNING id INTO new_period;
        SELECT id INTO previous_period FROM plan_periods
        WHERE (year * 12 + month) < (target_year * 12 + target_month)
        ORDER BY year DESC, month DESC LIMIT 1;
        IF previous_period IS NULL THEN RETURN new_period; END IF;
        INSERT INTO order_items(
          order_id, period_id, item_number, relation_key, item_name, container_date, model_age, image_refs,
          product_attribute, surface_nature, special_item, production_quantity, historical_inbound_quantity,
          today_inbound_quantity, handling_method, plan_page, order_exception, inspection,
          inspection_quantity, remark, order_weeks, source_month, unit_price, active, version
        )
        SELECT order_id, new_period, item_number, relation_key, item_name, container_date, model_age, image_refs,
          product_attribute, surface_nature, special_item,
          GREATEST(COALESCE(production_quantity,0)-COALESCE(historical_inbound_quantity,0)-COALESCE(today_inbound_quantity,0),0),
          0, 0, handling_method, plan_page, order_exception, inspection, inspection_quantity,
          remark, order_weeks, target_month, unit_price, true, 1
        FROM order_items
        WHERE period_id=previous_period AND active=true
          AND COALESCE(production_quantity,0)-COALESCE(historical_inbound_quantity,0)-COALESCE(today_inbound_quantity,0) > 0
        ON CONFLICT(period_id, order_id, item_number) DO NOTHING;
        RETURN new_period;
      END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS create_monthly_plan(integer, integer);
      DROP TABLE IF EXISTS idempotency_keys, import_job_errors, import_jobs, api_keys, audit_logs,
        suppliers, dictionary_values, dictionary_types, item_process_progress, process_definitions,
        outsourcing_details, order_items, orders, plan_periods, role_data_scopes, permissions,
        user_roles, roles, users CASCADE;
    `);
  }
}
