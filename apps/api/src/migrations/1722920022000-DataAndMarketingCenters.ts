import { MigrationInterface, QueryRunner } from "typeorm";

export class DataAndMarketingCenters1722920022000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "finished_goods_inbound" ADD COLUMN IF NOT EXISTS "category_number" character varying`);
    await queryRunner.query(`ALTER TABLE "finished_goods_inbound" ADD COLUMN IF NOT EXISTS "document_full_name" character varying`);
    await queryRunner.query(`ALTER TABLE "finished_goods_inbound" ADD COLUMN IF NOT EXISTS "inbound_date" date`);
    await queryRunner.query(`ALTER TABLE "finished_goods_inbound" ADD COLUMN IF NOT EXISTS "line_number" integer`);
    await queryRunner.query(`ALTER TABLE "finished_goods_inbound" ADD COLUMN IF NOT EXISTS "work_order_number" character varying`);
    await queryRunner.query(`ALTER TABLE "finished_goods_inbound" ADD COLUMN IF NOT EXISTS "quick_code" character varying`);
    await queryRunner.query(`ALTER TABLE "finished_goods_inbound" ADD COLUMN IF NOT EXISTS "category" character varying`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_finished_goods_inbound_inbound_date" ON "finished_goods_inbound" ("inbound_date")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_finished_goods_inbound_work_order" ON "finished_goods_inbound" ("work_order_number")`);

    await queryRunner.query(`
      INSERT INTO permissions (id, role_id, resource, field_key, "read", "create", "update", "delete", "import", "export")
      SELECT uuid_generate_v4(), role.id, resource.code, '*', true, true, true, true, true, true
      FROM roles role
      CROSS JOIN (VALUES
        ('daily-progress'), ('sales-orders'), ('finished-goods-inbound'),
        ('business-customer-mapping'), ('two-week-schedule')
      ) AS resource(code)
      WHERE role.name = '集团管理员'
      ON CONFLICT (role_id, resource, field_key) DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO permissions (id, role_id, resource, field_key, "read", "create", "update", "delete", "import", "export")
      SELECT uuid_generate_v4(), source.role_id, 'daily-progress', '*', source."read", source."create", source."update", source."delete", source."import", source."export"
      FROM permissions source
      WHERE source.resource = 'monthly-plan' AND source.field_key = '*'
      ON CONFLICT (role_id, resource, field_key) DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM permissions WHERE resource IN ('daily-progress','business-customer-mapping','two-week-schedule')`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_finished_goods_inbound_work_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_finished_goods_inbound_inbound_date"`);
    await queryRunner.query(`ALTER TABLE "finished_goods_inbound" DROP COLUMN IF EXISTS "category"`);
    await queryRunner.query(`ALTER TABLE "finished_goods_inbound" DROP COLUMN IF EXISTS "quick_code"`);
    await queryRunner.query(`ALTER TABLE "finished_goods_inbound" DROP COLUMN IF EXISTS "work_order_number"`);
    await queryRunner.query(`ALTER TABLE "finished_goods_inbound" DROP COLUMN IF EXISTS "line_number"`);
    await queryRunner.query(`ALTER TABLE "finished_goods_inbound" DROP COLUMN IF EXISTS "inbound_date"`);
    await queryRunner.query(`ALTER TABLE "finished_goods_inbound" DROP COLUMN IF EXISTS "document_full_name"`);
    await queryRunner.query(`ALTER TABLE "finished_goods_inbound" DROP COLUMN IF EXISTS "category_number"`);
  }
}
