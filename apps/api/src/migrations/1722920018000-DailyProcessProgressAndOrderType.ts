import { MigrationInterface, QueryRunner } from "typeorm";

export class DailyProcessProgressAndOrderType1722920018000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN "order_type" varchar`);
    await queryRunner.query(`
      CREATE TABLE "daily_process_progress" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_item_id" uuid NOT NULL REFERENCES "order_items"("id") ON DELETE CASCADE,
        "process_definition_id" uuid NOT NULL REFERENCES "process_definitions"("id") ON DELETE RESTRICT,
        "work_date" date NOT NULL,
        "quantity" numeric(18,4) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" varchar NOT NULL DEFAULT 'system',
        CONSTRAINT "CK_daily_process_progress_quantity" CHECK ("quantity" >= 0),
        CONSTRAINT "UQ_daily_process_progress_item_process_date"
          UNIQUE ("order_item_id", "process_definition_id", "work_date")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_daily_process_progress_work_date" ON "daily_process_progress" ("work_date")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_daily_process_progress_work_date"`);
    await queryRunner.query(`DROP TABLE "daily_process_progress"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "order_type"`);
  }
}
