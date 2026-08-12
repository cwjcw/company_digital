import { MigrationInterface, QueryRunner } from "typeorm";

export class SalesOrderSummaryFields1722920008000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" ADD "salesperson" character varying`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "order_amount" numeric(18,4)`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "actual_completion_date" date`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "shipping_date" date`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "delivery_score" numeric(8,2)`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "quality_score" numeric(8,2)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "quality_score"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "delivery_score"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "shipping_date"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "actual_completion_date"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "order_amount"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "salesperson"`);
  }
}
