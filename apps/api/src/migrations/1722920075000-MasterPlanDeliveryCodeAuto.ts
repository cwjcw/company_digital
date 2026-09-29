import { MigrationInterface, QueryRunner } from "typeorm";

const systemUserId = "0199e000-0000-7000-8000-000000000001";
const deliveryTables = [
  "mps_shipping_plans",
  "mps_base_plans",
  "mps_weekly_plans",
  "mps_technical_reports",
  "mps_material_reports",
  "mps_outsourcing_reports",
  "mps_process_reports"
] as const;

/**
 * KDOS-DELIVERY-CODE-AUTO-001 主计划身份修复：
 * - id 已经是正式 UUID 主键，本 migration 不创建第二个身份字段；
 * - delivery_number 从旧 integer 规范为可扩展字符串，历史数值只补齐展示前导零；
 * - counter 是“曾经分配过的下一个号码”，因此删除记录不会回收号码；
 * - 计数器按租户+订单+品项隔离，应用层在事务内加 advisory lock 后消费。
 */
export class MasterPlanDeliveryCodeAuto1722920075000 implements MigrationInterface {
  name = "MasterPlanDeliveryCodeAuto1722920075000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS mps_delivery_code_counters (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        tenant_id varchar(64) NOT NULL,
        order_number varchar(128) NOT NULL,
        item_code varchar(128) NOT NULL,
        next_number bigint NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system',
        CONSTRAINT uq_mps_delivery_code_counter UNIQUE(tenant_id,order_number,item_code),
        CONSTRAINT ck_mps_delivery_code_counter_next CHECK(next_number>0)
      )
    `);

    await queryRunner.query(`ALTER TABLE mps_shipping_plans DROP CONSTRAINT IF EXISTS ck_mps_shipping_plan_delivery`);
    for (const table of deliveryTables) {
      await queryRunner.query(`
        ALTER TABLE ${table}
          ALTER COLUMN delivery_number TYPE varchar(32)
          USING lpad(delivery_number::text,3,'0')
      `);
    }

    const checks: Record<string, string> = {
      mps_shipping_plans: "ck_mps_shipping_plan_delivery",
      mps_base_plans: "ck_mps_base_plan_delivery",
      mps_weekly_plans: "ck_mps_weekly_plan_delivery",
      mps_technical_reports: "ck_mps_technical_report_delivery",
      mps_material_reports: "ck_mps_material_report_delivery",
      mps_outsourcing_reports: "ck_mps_outsourcing_report_delivery",
      mps_process_reports: "ck_mps_process_report_delivery"
    };
    for (const table of deliveryTables) {
      await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${checks[table]}`);
      await queryRunner.query(`ALTER TABLE ${table} ADD CONSTRAINT ${checks[table]} CHECK(delivery_number ~ '^0*[1-9][0-9]*$')`);
    }

    /* 初始化“已分配过的最大号码 + 1”，不改动任何计划行、日期或 UUID。 */
    await queryRunner.query(`
      INSERT INTO mps_delivery_code_counters(tenant_id,order_number,item_code,next_number,created_by,updated_by)
      SELECT tenant_id,order_number,item_code,(max(delivery_number::bigint)+1), '${systemUserId}'::uuid, '${systemUserId}'
      FROM (
        SELECT tenant_id,order_number,item_code,delivery_number FROM mps_shipping_plans
        UNION ALL
        SELECT tenant_id,order_number,item_code,delivery_number FROM mps_base_plans
      ) source_codes
      GROUP BY tenant_id,order_number,item_code
      ON CONFLICT(tenant_id,order_number,item_code) DO UPDATE SET
        next_number=GREATEST(mps_delivery_code_counters.next_number,excluded.next_number),
        updated_at=now(),updated_by=excluded.updated_by
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS mps_delivery_code_counters`);
    const checks = [
      ["mps_shipping_plans", "ck_mps_shipping_plan_delivery"],
      ["mps_base_plans", "ck_mps_base_plan_delivery"],
      ["mps_weekly_plans", "ck_mps_weekly_plan_delivery"],
      ["mps_technical_reports", "ck_mps_technical_report_delivery"],
      ["mps_material_reports", "ck_mps_material_report_delivery"],
      ["mps_outsourcing_reports", "ck_mps_outsourcing_report_delivery"],
      ["mps_process_reports", "ck_mps_process_report_delivery"]
    ] as const;
    for (const [table, constraint] of checks) await queryRunner.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint}`);
    for (const [table] of checks) await queryRunner.query(`ALTER TABLE ${table} ALTER COLUMN delivery_number TYPE integer USING delivery_number::integer`);
    await queryRunner.query(`ALTER TABLE mps_shipping_plans ADD CONSTRAINT ck_mps_shipping_plan_delivery CHECK(delivery_number>0)`);
  }
}
