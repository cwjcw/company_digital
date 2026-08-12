import { MigrationInterface, QueryRunner } from "typeorm";

export class ProcessQuantity1722920004000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "item_process_progress" ADD COLUMN "quantity" numeric(12,2)'
    );
    await queryRunner.query(`
      UPDATE "item_process_progress" progress
      SET "quantity" = CASE
        WHEN trim(progress."status") ~ '^-?[0-9]+([.][0-9]+)?$' THEN trim(progress."status")::numeric
        WHEN upper(trim(progress."status")) = 'Y' THEN item."production_quantity"
        ELSE NULL
      END
      FROM "process_definitions" definition, "order_items" item
      WHERE progress."process_definition_id" = definition."id"
        AND progress."order_item_id" = item."id"
        AND definition."code" IN ('blank', 'bakingPlating', 'assemblyPacking')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "item_process_progress" DROP COLUMN "quantity"');
  }
}
