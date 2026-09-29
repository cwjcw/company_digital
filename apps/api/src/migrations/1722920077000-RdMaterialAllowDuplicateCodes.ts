import { MigrationInterface, QueryRunner } from "typeorm";

export class RdMaterialAllowDuplicateCodes1722920077000 implements MigrationInterface {
  name = "RdMaterialAllowDuplicateCodes1722920077000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE rd_items DROP CONSTRAINT IF EXISTS uq_rd_items_code");
    await queryRunner.query("CREATE INDEX IF NOT EXISTS idx_rd_items_code ON rd_items(tenant_id,item_code)");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP INDEX IF EXISTS idx_rd_items_code");
    await queryRunner.query("ALTER TABLE rd_items ADD CONSTRAINT uq_rd_items_code UNIQUE(tenant_id,item_code)");
  }
}
