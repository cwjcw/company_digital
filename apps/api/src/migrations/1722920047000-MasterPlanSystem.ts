import { MigrationInterface, QueryRunner } from "typeorm";

export class MasterPlanSystem1722920047000 implements MigrationInterface {
  name = "MasterPlanSystem1722920047000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE mps_erp_order_lines (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        source_system varchar(32) NOT NULL, source_database varchar(128) NOT NULL,
        source_account_name varchar(128), source_key varchar(255) NOT NULL,
        salesperson_name varchar(255), customer_code varchar(128), customer_name varchar(500),
        order_number varchar(128) NOT NULL, order_type varchar(128), order_date date,
        customer_due_date date, preproduction_review_date date, expected_shipping_date date,
        item_code varchar(128) NOT NULL, item_name varchar(500), unit varchar(64),
        order_quantity numeric(20,4) NOT NULL DEFAULT 0,
        tax_included_unit_price numeric(20,6), tax_included_amount numeric(20,2), order_status varchar(128),
        source_active boolean NOT NULL DEFAULT true, source_updated_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_erp_order_source UNIQUE(tenant_id,source_system,source_database,source_key),
        CONSTRAINT ck_mps_erp_order_key CHECK(btrim(order_number)<>'' AND btrim(item_code)<>''),
        CONSTRAINT ck_mps_erp_order_version CHECK(version>0)
      );
      CREATE INDEX idx_mps_erp_order_business ON mps_erp_order_lines(tenant_id,order_number,item_code);
      CREATE INDEX idx_mps_erp_order_date ON mps_erp_order_lines(tenant_id,order_date DESC);

      CREATE TABLE mps_customer_division_mappings (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, customer_code varchar(128) NOT NULL,
        customer_name varchar(500), primary_division_id uuid NOT NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
        enabled boolean NOT NULL DEFAULT true, remark text,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_customer_division UNIQUE(tenant_id,customer_code),
        CONSTRAINT ck_mps_customer_division_code CHECK(btrim(customer_code)<>''),
        CONSTRAINT ck_mps_customer_division_version CHECK(version>0)
      );

      CREATE TABLE mps_order_allocations (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        order_number varchar(128) NOT NULL, item_code varchar(128) NOT NULL,
        salesperson_name varchar(255), customer_code varchar(128), order_date date, expected_shipping_date date,
        item_name varchar(500), unit varchar(64), order_quantity numeric(20,4) NOT NULL DEFAULT 0,
        allocated_quantity numeric(20,4) NOT NULL DEFAULT 0,
        tax_included_unit_price numeric(20,6), tax_included_amount numeric(20,2), order_status varchar(128),
        division_id uuid REFERENCES organization_units(id) ON DELETE RESTRICT, remark text,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_order_allocation UNIQUE(tenant_id,order_number,item_code),
        CONSTRAINT ck_mps_order_allocation_key CHECK(btrim(order_number)<>'' AND btrim(item_code)<>''),
        CONSTRAINT ck_mps_order_allocation_quantities CHECK(order_quantity>=0 AND allocated_quantity>=0),
        CONSTRAINT ck_mps_order_allocation_version CHECK(version>0)
      );
      CREATE INDEX idx_mps_order_allocation_division ON mps_order_allocations(tenant_id,division_id);

      CREATE TABLE mps_group_plans (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, order_number varchar(128) NOT NULL,
        source_accounts text, order_type varchar(128), customer_code varchar(128), customer_name varchar(500),
        order_date date, customer_due_date date, preproduction_review_date date,
        order_amount numeric(20,2) NOT NULL DEFAULT 0, required_quantity numeric(20,4) NOT NULL DEFAULT 0,
        primary_division_id uuid REFERENCES organization_units(id) ON DELETE RESTRICT,
        completed_quantity numeric(20,4) NOT NULL DEFAULT 0, pending_quantity numeric(20,4) NOT NULL DEFAULT 0,
        completion_rate numeric(7,4) NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_group_plan UNIQUE(tenant_id,order_number),
        CONSTRAINT ck_mps_group_plan_rate CHECK(completion_rate BETWEEN 0 AND 1),
        CONSTRAINT ck_mps_group_plan_version CHECK(version>0)
      );
      CREATE INDEX idx_mps_group_plan_date ON mps_group_plans(tenant_id,order_date DESC);

      CREATE TABLE mps_monthly_plans (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        order_number varchar(128) NOT NULL, item_code varchar(128) NOT NULL,
        division_id uuid REFERENCES organization_units(id) ON DELETE RESTRICT,
        customer_code varchar(128), customer_name varchar(500), order_date date, customer_due_date date,
        preproduction_review_date date, latest_customer_due_date date, model_age varchar(64), item_name varchar(500),
        image_refs jsonb NOT NULL DEFAULT '[]'::jsonb, product_attribute varchar(64), surface_nature varchar(64), special_item text,
        required_quantity numeric(20,4) NOT NULL DEFAULT 0, cumulative_inbound_quantity numeric(20,4) NOT NULL DEFAULT 0,
        pending_quantity numeric(20,4) NOT NULL DEFAULT 0, completion_rate numeric(7,4) NOT NULL DEFAULT 0,
        manufacturing_method varchar(64), planned_page_count integer, order_exception_info text,
        inspection_required boolean NOT NULL DEFAULT false, inspection_quantity numeric(20,4), remark text, order_week_count integer,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_monthly_plan UNIQUE(tenant_id,order_number,item_code),
        CONSTRAINT ck_mps_monthly_plan_rate CHECK(completion_rate BETWEEN 0 AND 1),
        CONSTRAINT ck_mps_monthly_plan_version CHECK(version>0)
      );
      CREATE INDEX idx_mps_monthly_plan_division ON mps_monthly_plans(tenant_id,division_id);
      CREATE INDEX idx_mps_monthly_plan_date ON mps_monthly_plans(tenant_id,order_date DESC);

      CREATE TABLE mps_shipping_plans (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        customer_code varchar(128) NOT NULL, order_number varchar(128) NOT NULL, item_code varchar(128) NOT NULL,
        delivery_number integer NOT NULL, item_name varchar(500), order_date date, latest_customer_due_date date NOT NULL,
        planned_quantity numeric(20,4) NOT NULL, division_id uuid REFERENCES organization_units(id) ON DELETE RESTRICT,
        model_age varchar(64), entered_weekly_plan boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_shipping_plan UNIQUE(tenant_id,order_number,item_code,delivery_number),
        CONSTRAINT ck_mps_shipping_plan_quantity CHECK(planned_quantity>0),
        CONSTRAINT ck_mps_shipping_plan_delivery CHECK(delivery_number>0),
        CONSTRAINT ck_mps_shipping_plan_version CHECK(version>0)
      );
      CREATE INDEX idx_mps_shipping_plan_due ON mps_shipping_plans(tenant_id,latest_customer_due_date);

      CREATE TABLE mps_base_plans (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        shipping_plan_id uuid NOT NULL REFERENCES mps_shipping_plans(id) ON DELETE RESTRICT,
        division_id uuid REFERENCES organization_units(id) ON DELETE RESTRICT, customer_code varchar(128),
        order_number varchar(128) NOT NULL, item_code varchar(128) NOT NULL, item_name varchar(500), delivery_number integer NOT NULL,
        order_date date, latest_customer_due_date date NOT NULL, planned_quantity numeric(20,4) NOT NULL,
        latest_review_due_date date, model_age varchar(64), image_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
        product_attribute varchar(64), surface_nature varchar(64), manufacturing_method varchar(64),
        admission_status varchar(32) NOT NULL DEFAULT 'INCOMPLETE', admission_message text,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_base_plan UNIQUE(tenant_id,order_number,item_code,delivery_number),
        CONSTRAINT uq_mps_base_shipping UNIQUE(tenant_id,shipping_plan_id),
        CONSTRAINT ck_mps_base_admission CHECK(admission_status IN ('INCOMPLETE','READY','SYNCED')),
        CONSTRAINT ck_mps_base_version CHECK(version>0)
      );

      CREATE TABLE mps_weekly_plans (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        base_plan_id uuid NOT NULL REFERENCES mps_base_plans(id) ON DELETE RESTRICT,
        division_id uuid REFERENCES organization_units(id) ON DELETE RESTRICT, customer_code varchar(128),
        order_number varchar(128) NOT NULL, item_code varchar(128) NOT NULL, item_name varchar(500), delivery_number integer NOT NULL,
        order_date date, latest_customer_due_date date NOT NULL, latest_review_due_date date NOT NULL, model_age varchar(64),
        image_refs jsonb NOT NULL DEFAULT '[]'::jsonb, product_attribute varchar(64), surface_nature varchar(64),
        planned_quantity numeric(20,4) NOT NULL, allocated_inbound_quantity numeric(20,4) NOT NULL DEFAULT 0,
        pending_quantity numeric(20,4) NOT NULL DEFAULT 0, manufacturing_method varchar(64),
        technical_cycle_days integer, drawing_due_date date,
        hardware_cycle_days integer, hardware_due_date date, wood_cycle_days integer, wood_due_date date,
        planned_page_count integer, order_exception_info text, inspection_required boolean NOT NULL DEFAULT false,
        inspection_quantity numeric(20,4), remark text, order_week_count integer,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_weekly_plan UNIQUE(tenant_id,order_number,item_code,delivery_number),
        CONSTRAINT uq_mps_weekly_base UNIQUE(tenant_id,base_plan_id),
        CONSTRAINT ck_mps_weekly_quantities CHECK(planned_quantity>0 AND allocated_inbound_quantity>=0 AND pending_quantity>=0),
        CONSTRAINT ck_mps_weekly_cycles CHECK((technical_cycle_days IS NULL OR technical_cycle_days>=0) AND (hardware_cycle_days IS NULL OR hardware_cycle_days>=0) AND (wood_cycle_days IS NULL OR wood_cycle_days>=0)),
        CONSTRAINT ck_mps_weekly_version CHECK(version>0)
      );
      CREATE INDEX idx_mps_weekly_plan_fifo ON mps_weekly_plans(tenant_id,order_number,item_code,latest_customer_due_date,delivery_number);

      CREATE TABLE mps_process_cycles (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, item_code varchar(128) NOT NULL, item_name varchar(500),
        technical_days integer, cutting_days integer, machining_days integer, bending_days integer, spot_welding_days integer,
        welding_days integer, woodworking_days integer, grinding_days integer, surface_treatment_days integer, packaging_days integer,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_process_cycle UNIQUE(tenant_id,item_code),
        CONSTRAINT ck_mps_process_cycle_nonnegative CHECK(
          (technical_days IS NULL OR technical_days>=0) AND (cutting_days IS NULL OR cutting_days>=0) AND
          (machining_days IS NULL OR machining_days>=0) AND (bending_days IS NULL OR bending_days>=0) AND
          (spot_welding_days IS NULL OR spot_welding_days>=0) AND (welding_days IS NULL OR welding_days>=0) AND
          (woodworking_days IS NULL OR woodworking_days>=0) AND (grinding_days IS NULL OR grinding_days>=0) AND
          (surface_treatment_days IS NULL OR surface_treatment_days>=0) AND (packaging_days IS NULL OR packaging_days>=0)),
        CONSTRAINT ck_mps_process_cycle_version CHECK(version>0)
      );

      CREATE TABLE mps_weekly_process_plans (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        weekly_plan_id uuid NOT NULL REFERENCES mps_weekly_plans(id) ON DELETE CASCADE,
        process_code varchar(32) NOT NULL, process_name varchar(64) NOT NULL, sequence integer NOT NULL,
        cycle_days integer, due_date date, status varchar(32) NOT NULL DEFAULT '未开始', exception_text text,
        reported_quantity numeric(20,4) NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_weekly_process UNIQUE(tenant_id,weekly_plan_id,process_code),
        CONSTRAINT ck_mps_weekly_process_code CHECK(process_code IN ('cutting','machining','bending','spotWelding','welding','woodworking','grinding','surfaceTreatment','packaging')),
        CONSTRAINT ck_mps_weekly_process_status CHECK(status IN ('未开始','进行中','已完成','延期')),
        CONSTRAINT ck_mps_weekly_process_cycle CHECK(cycle_days IS NULL OR cycle_days>=0),
        CONSTRAINT ck_mps_weekly_process_version CHECK(version>0)
      );
      CREATE INDEX idx_mps_weekly_process_due ON mps_weekly_process_plans(tenant_id,due_date,status);

      CREATE TABLE mps_technical_reports (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        weekly_plan_id uuid NOT NULL REFERENCES mps_weekly_plans(id) ON DELETE RESTRICT,
        order_number varchar(128) NOT NULL, item_code varchar(128) NOT NULL, item_name varchar(500), delivery_number integer NOT NULL,
        drawing_refs jsonb NOT NULL DEFAULT '[]'::jsonb, responsible_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
        drawing_due_date date, status varchar(32) NOT NULL DEFAULT '未完成', exception_text text,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_technical_report UNIQUE(tenant_id,order_number,item_code,delivery_number),
        CONSTRAINT ck_mps_technical_status CHECK(status IN ('已完成','未完成','延期')),
        CONSTRAINT ck_mps_technical_version CHECK(version>0)
      );

      CREATE TABLE mps_material_reports (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        weekly_plan_id uuid NOT NULL REFERENCES mps_weekly_plans(id) ON DELETE RESTRICT,
        order_number varchar(128) NOT NULL, item_code varchar(128) NOT NULL, item_name varchar(500), delivery_number integer NOT NULL,
        material_name varchar(32) NOT NULL, received boolean NOT NULL DEFAULT false, actual_inbound_date date, exception_text text,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_material_report UNIQUE(tenant_id,order_number,item_code,delivery_number,material_name),
        CONSTRAINT ck_mps_material_name CHECK(material_name IN ('五金','木作')),
        CONSTRAINT ck_mps_material_date CHECK(NOT received OR actual_inbound_date IS NOT NULL),
        CONSTRAINT ck_mps_material_version CHECK(version>0)
      );

      CREATE TABLE mps_outsourcing_reports (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        weekly_plan_id uuid NOT NULL REFERENCES mps_weekly_plans(id) ON DELETE RESTRICT,
        order_number varchar(128) NOT NULL, item_code varchar(128) NOT NULL, item_name varchar(500), delivery_number integer NOT NULL,
        purchase_order_number varchar(128), supplier_id uuid REFERENCES supply_chain_suppliers(id) ON DELETE RESTRICT,
        outsourcing_method varchar(32), outsourcing_due_date date, cycle_days integer,
        received boolean NOT NULL DEFAULT false, actual_inbound_date date, status varchar(32) NOT NULL DEFAULT '未开始', exception_text text,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_outsourcing_report UNIQUE(tenant_id,order_number,item_code,delivery_number),
        CONSTRAINT uq_mps_outsourcing_weekly UNIQUE(tenant_id,weekly_plan_id),
        CONSTRAINT ck_mps_outsourcing_method CHECK(outsourcing_method IS NULL OR outsourcing_method IN ('成品','毛坯','部件')),
        CONSTRAINT ck_mps_outsourcing_status CHECK(status IN ('未开始','进行中','延期','已入库')),
        CONSTRAINT ck_mps_outsourcing_cycle CHECK(cycle_days IS NULL OR cycle_days>=0),
        CONSTRAINT ck_mps_outsourcing_date CHECK(NOT received OR actual_inbound_date IS NOT NULL),
        CONSTRAINT ck_mps_outsourcing_version CHECK(version>0)
      );

      CREATE TABLE mps_process_reports (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        weekly_plan_id uuid NOT NULL REFERENCES mps_weekly_plans(id) ON DELETE RESTRICT,
        order_number varchar(128) NOT NULL, item_code varchar(128) NOT NULL, item_name varchar(500), delivery_number integer NOT NULL,
        process_code varchar(32) NOT NULL, process_name varchar(64) NOT NULL, production_date date NOT NULL,
        planned_quantity numeric(20,4) NOT NULL, production_quantity numeric(20,4) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT ck_mps_process_report_code CHECK(process_code IN ('cutting','machining','bending','spotWelding','welding','woodworking','grinding','surfaceTreatment','packaging')),
        CONSTRAINT ck_mps_process_report_quantities CHECK(planned_quantity>0 AND production_quantity>0),
        CONSTRAINT ck_mps_process_report_version CHECK(version>0)
      );
      CREATE INDEX idx_mps_process_report_rollup ON mps_process_reports(tenant_id,weekly_plan_id,process_code);

      CREATE TABLE mps_sync_configs (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, sync_key varchar(128) NOT NULL, name varchar(255) NOT NULL,
        enabled boolean NOT NULL DEFAULT true, interval_minutes integer NOT NULL DEFAULT 30,
        last_started_at timestamptz, last_success_at timestamptz, last_failure_at timestamptz,
        last_sync_count integer NOT NULL DEFAULT 0, status varchar(32) NOT NULL DEFAULT 'IDLE', error_message text,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_sync_config UNIQUE(tenant_id,sync_key),
        CONSTRAINT ck_mps_sync_interval CHECK(interval_minutes BETWEEN 1 AND 1440),
        CONSTRAINT ck_mps_sync_status CHECK(status IN ('IDLE','RUNNING','SUCCESS','FAILED','DISABLED')),
        CONSTRAINT ck_mps_sync_config_version CHECK(version>0)
      );

      CREATE TABLE mps_sync_logs (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        sync_config_id uuid NOT NULL REFERENCES mps_sync_configs(id) ON DELETE RESTRICT,
        sync_key varchar(128) NOT NULL, run_type varchar(32) NOT NULL, status varchar(32) NOT NULL,
        started_at timestamptz NOT NULL, completed_at timestamptz, sync_count integer NOT NULL DEFAULT 0,
        error_message text, idempotency_key varchar(255) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_sync_log_idempotency UNIQUE(tenant_id,idempotency_key),
        CONSTRAINT ck_mps_sync_run_type CHECK(run_type IN ('SCHEDULED','MANUAL','EVENT','RECONCILIATION')),
        CONSTRAINT ck_mps_sync_log_status CHECK(status IN ('RUNNING','SUCCESS','FAILED')),
        CONSTRAINT ck_mps_sync_log_version CHECK(version>0)
      );
      CREATE INDEX idx_mps_sync_log_time ON mps_sync_logs(tenant_id,started_at DESC);

      CREATE TABLE mps_data_exceptions (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
        exception_key varchar(500) NOT NULL, resource varchar(128) NOT NULL, record_id uuid,
        business_key varchar(500) NOT NULL, exception_type varchar(128) NOT NULL, severity varchar(16) NOT NULL DEFAULT 'ERROR',
        message text NOT NULL, active boolean NOT NULL DEFAULT true, resolved_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_data_exception UNIQUE(tenant_id,exception_key),
        CONSTRAINT ck_mps_exception_severity CHECK(severity IN ('WARNING','ERROR')),
        CONSTRAINT ck_mps_exception_version CHECK(version>0)
      );
      CREATE INDEX idx_mps_exception_active ON mps_data_exceptions(tenant_id,active,severity,resource);

      CREATE TABLE mps_system_settings (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, setting_key varchar(128) NOT NULL,
        name varchar(255) NOT NULL, value_json jsonb NOT NULL, description text,
        created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_system_setting UNIQUE(tenant_id,setting_key),
        CONSTRAINT ck_mps_system_setting_version CHECK(version>0)
      );
    `);

    const tenantTables = [
      "mps_erp_order_lines", "mps_customer_division_mappings", "mps_order_allocations", "mps_group_plans",
      "mps_monthly_plans", "mps_shipping_plans", "mps_base_plans", "mps_weekly_plans", "mps_process_cycles",
      "mps_weekly_process_plans", "mps_technical_reports", "mps_material_reports", "mps_outsourcing_reports",
      "mps_process_reports", "mps_sync_configs", "mps_sync_logs", "mps_data_exceptions", "mps_system_settings"
    ];
    for (const table of tenantTables) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`CREATE POLICY ${table}_tenant_policy ON ${table}
        USING (tenant_id=current_setting('app.tenant_id',true))
        WITH CHECK (tenant_id=current_setting('app.tenant_id',true))`);
    }
    await queryRunner.query(`
      INSERT INTO mps_sync_configs(tenant_id,sync_key,name,enabled,interval_minutes,status,updated_by)
      VALUES
        ('KAINAN','erp-orders','ERP订单同步',true,30,'IDLE','migration'),
        ('KAINAN','plan-projections','集团/月度计划对账',true,30,'IDLE','migration'),
        ('KAINAN','shipping-to-base','出货计划同步基础计划',true,30,'IDLE','migration'),
        ('KAINAN','base-to-weekly','基础计划同步周计划',true,30,'IDLE','migration'),
        ('KAINAN','inbound-allocation','系统入库与FIFO分摊',true,30,'IDLE','migration'),
        ('KAINAN','execution-rollup','报工与计划状态对账',true,30,'IDLE','migration')
      ON CONFLICT(tenant_id,sync_key) DO NOTHING;
      INSERT INTO mps_system_settings(tenant_id,setting_key,name,value_json,description,updated_by)
      VALUES
        ('KAINAN','shipping_edit_weekday','出货计划开放星期','5'::jsonb,'1=周一，5=周五，7=周日','migration'),
        ('KAINAN','shipping_temporary_unlock_until','出货计划临时解锁截止时间','null'::jsonb,'管理员临时解锁时间','migration'),
        ('KAINAN','base_plan_require_sketch','基础计划简图是否必填','false'::jsonb,'控制基础计划进入周计划的简图准入条件','migration')
      ON CONFLICT(tenant_id,setting_key) DO NOTHING;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS
      mps_system_settings,mps_data_exceptions,mps_sync_logs,mps_sync_configs,mps_process_reports,
      mps_outsourcing_reports,mps_material_reports,mps_technical_reports,mps_weekly_process_plans,
      mps_process_cycles,mps_weekly_plans,mps_base_plans,mps_shipping_plans,mps_monthly_plans,
      mps_group_plans,mps_order_allocations,mps_customer_division_mappings,mps_erp_order_lines CASCADE`);
  }
}
