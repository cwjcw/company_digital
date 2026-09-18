import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * KN-MPS-WO-001：
 * 1) 事业部基础计划新增「毛坯完成日期 / 包装完成日期」（人工维护、可空、非周计划准入条件）；
 * 2) 新增正式资源「3天生产工单」物理表 mps_three_day_work_orders。
 *
 * 关键设计：
 * - 同步身份是 `weekly_plan_id`（UUID NOT NULL，UNIQUE(tenant_id, weekly_plan_id) + FK→mps_weekly_plans），
 *   绝不使用 order_number/item_code 拼接定位，也不保存 delivery_number 快照；
 * - 来源字段（source-owned）与人工字段（user-owned）在同一张表，但人工字段只由用户维护，同步只覆盖来源字段；
 * - 生产日期拆成两个原子 date 列，并保证「同时为空或同时有值」且 start<=end。
 */
export class MasterPlanThreeDayWorkOrders1722920063000 implements MigrationInterface {
  name = "MasterPlanThreeDayWorkOrders1722920063000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE mps_base_plans ADD COLUMN IF NOT EXISTS blank_completion_date date NULL`);
    await queryRunner.query(`ALTER TABLE mps_base_plans ADD COLUMN IF NOT EXISTS packaging_completion_date date NULL`);
    await queryRunner.query(`COMMENT ON COLUMN mps_base_plans.blank_completion_date IS 'KN-MPS-WO-001：毛坯完成日期（人工维护，可空，非周计划准入条件）'`);
    await queryRunner.query(`COMMENT ON COLUMN mps_base_plans.packaging_completion_date IS 'KN-MPS-WO-001：包装完成日期（人工维护，可空，非周计划准入条件）'`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS mps_three_day_work_orders (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        tenant_id varchar(64) NOT NULL,
        weekly_plan_id uuid NOT NULL REFERENCES mps_weekly_plans(id) ON DELETE RESTRICT,
        division_id uuid NOT NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
        customer_code varchar(128),
        order_number varchar(128) NOT NULL,
        order_date date,
        model_age varchar(64),
        item_code varchar(128) NOT NULL,
        item_name varchar(500),
        image_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
        required_quantity numeric(20,4) NOT NULL DEFAULT 0,
        blank_completion_date date,
        packaging_completion_date date,
        manufacturing_method varchar(64),
        production_start_date date,
        production_end_date date,
        remark text,
        processing_remark text,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by uuid NOT NULL DEFAULT '0199e000-0000-7000-8000-000000000001'::uuid REFERENCES users(id) ON DELETE RESTRICT,
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_mps_three_day_work_order UNIQUE (tenant_id, weekly_plan_id),
        CONSTRAINT ck_mps_three_day_work_order_key CHECK (btrim(order_number) <> '' AND btrim(item_code) <> ''),
        CONSTRAINT ck_mps_three_day_work_order_quantity CHECK (required_quantity >= 0),
        CONSTRAINT ck_mps_three_day_work_order_dates CHECK ((production_start_date IS NULL) = (production_end_date IS NULL)),
        CONSTRAINT ck_mps_three_day_work_order_range CHECK (production_start_date IS NULL OR production_end_date IS NULL OR production_start_date <= production_end_date),
        CONSTRAINT ck_mps_three_day_work_order_version CHECK (version > 0)
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_mps_three_day_work_order_plan ON mps_three_day_work_orders(tenant_id, weekly_plan_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_mps_three_day_work_order_business ON mps_three_day_work_orders(tenant_id, order_number, item_code)`);
    /* 多租户 RLS：与其它 mps_* 表完全一致的租户策略。 */
    await queryRunner.query(`ALTER TABLE mps_three_day_work_orders ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS mps_three_day_work_orders_tenant_policy ON mps_three_day_work_orders`);
    await queryRunner.query(`CREATE POLICY mps_three_day_work_orders_tenant_policy ON mps_three_day_work_orders
      USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true))`);
    await queryRunner.query(`COMMENT ON TABLE mps_three_day_work_orders IS 'KN-MPS-WO-001：3天生产工单（只能由“从周计划同步”生成；同步身份 weekly_plan_id；来源字段与人工字段分离）'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS mps_three_day_work_orders`);
    await queryRunner.query(`ALTER TABLE mps_base_plans DROP COLUMN IF EXISTS blank_completion_date`);
    await queryRunner.query(`ALTER TABLE mps_base_plans DROP COLUMN IF EXISTS packaging_completion_date`);
  }
}
