import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * KN-FILTER-001 第五轮：退役两个已确认无用的正式功能所专属的数据库对象。
 *
 * 1. 旧供应商基础资料 `suppliers`：正式供应商数据已统一为数据中心「供应商清单」（`supply_chain_suppliers`，T+ 同步投影），
 *    主计划外协 `mps_outsourcing_reports.supplier_id` 的候选来源改为 supplier-list（应用层迁移，见 contracts）。
 * 2. 重复订单业务复核：`duplicate_order_reviews`（人工复核结果）、`business_orders` / `business_order_sources`
 *    （仅由 OrderReviewService.rebuild 生成的 E10/T+ 人工合并分组，正式投影不读取）。
 *    正式订单投影写入 `orders` / `sales_orders`，来自 `erp_staging_raw_records`，本迁移不触碰。
 *
 * 顺序：先删最下游（有外键的表），再删被引用表，不使用 CASCADE，避免误删业务数据。
 * 反向迁移只恢复空表结构（历史数据只能通过迁移前备份恢复），并记录在迁移注释与进度文件中。
 */
const DROPPED_TABLES = ["duplicate_order_reviews", "business_order_sources", "business_orders", "suppliers"] as const;

export class RetireDuplicateOrderReviewAndLegacySuppliers1722920060000 implements MigrationInterface {
  name = "RetireDuplicateOrderReviewAndLegacySuppliers1722920060000";

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of DROPPED_TABLES) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS suppliers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code varchar UNIQUE,
      name varchar NOT NULL,
      remark varchar,
      enabled boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by varchar NOT NULL DEFAULT 'system',
      version integer NOT NULL DEFAULT 1
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS business_orders (
      id uuid PRIMARY KEY,
      tenant_id varchar(64) NOT NULL,
      rule_version varchar NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by varchar NOT NULL DEFAULT 'system',
      version integer NOT NULL DEFAULT 1
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS business_order_sources (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id varchar(64) NOT NULL,
      business_order_id uuid NOT NULL REFERENCES business_orders(id),
      source_system varchar NOT NULL,
      source_database varchar NOT NULL,
      source_table varchar NOT NULL,
      source_order_id varchar NOT NULL,
      source_order_number varchar,
      source_order_line_id varchar,
      rule_version varchar NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by varchar NOT NULL DEFAULT 'system',
      version integer NOT NULL DEFAULT 1
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS duplicate_order_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id varchar(64) NOT NULL,
      left_source_record_id uuid REFERENCES erp_staging_raw_records(id),
      right_source_record_id uuid REFERENCES erp_staging_raw_records(id),
      duplicate_level varchar NOT NULL,
      suggested_action varchar,
      e10_order_number varchar,
      tplus_order_number varchar,
      source_account_name varchar,
      customer_summary varchar,
      e10_item_quantity_summary text,
      tplus_item_quantity_summary text,
      total_quantity_consistent boolean,
      delivery_date_consistent boolean,
      matching_rule varchar,
      matching_reason text,
      system_suggestion text,
      business_confirmation_status varchar NOT NULL DEFAULT 'PENDING',
      business_confirmed_by varchar,
      business_confirmed_at timestamptz,
      business_remark text,
      rule_version varchar NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by varchar NOT NULL DEFAULT 'system',
      version integer NOT NULL DEFAULT 1
    )`);
  }
}
