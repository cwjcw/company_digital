import { MigrationInterface, QueryRunner } from "typeorm";

export class MonthlyItemOrderFields1722920005000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items"
        ADD COLUMN "customer_due_date" date,
        ADD COLUMN "review_due_date" date,
        ADD COLUMN "exception_due_date" date,
        ADD COLUMN "exception_delivery_method" varchar,
        ADD COLUMN "customer" varchar,
        ADD COLUMN "division" varchar
    `);
    await queryRunner.query(`
      UPDATE "order_items" item
      SET
        "customer_due_date" = orders."customer_due_date",
        "review_due_date" = orders."review_due_date",
        "exception_due_date" = orders."exception_due_date",
        "exception_delivery_method" = orders."exception_delivery_method",
        "customer" = orders."customer",
        "division" = orders."division"
      FROM "orders" orders
      WHERE item."order_id" = orders."id"
    `);
    await queryRunner.query('CREATE INDEX "IDX_order_items_division" ON "order_items" ("division")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_order_items_division"');
    await queryRunner.query(`
      ALTER TABLE "order_items"
        DROP COLUMN "division",
        DROP COLUMN "customer",
        DROP COLUMN "exception_delivery_method",
        DROP COLUMN "exception_due_date",
        DROP COLUMN "review_due_date",
        DROP COLUMN "customer_due_date"
    `);
  }
}
