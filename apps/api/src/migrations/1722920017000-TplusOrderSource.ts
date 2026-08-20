import { MigrationInterface, QueryRunner } from "typeorm";

export class TplusOrderSource1722920017000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN "source_system" varchar`);
    await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN "source_database" varchar`);
    await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN "source_account_name" varchar`);
    await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN "source_total_quantity" numeric(28,6)`);
    await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN "source_active" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`CREATE INDEX "IDX_orders_source_system" ON "orders" ("source_system")`);
    await queryRunner.query(`CREATE INDEX "IDX_orders_source_database" ON "orders" ("source_database")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_orders_tplus_source_order" ON "orders" ("source_database", "order_number") WHERE "source_database" IS NOT NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_orders_tplus_source_order"`);
    await queryRunner.query(`DROP INDEX "IDX_orders_source_database"`);
    await queryRunner.query(`DROP INDEX "IDX_orders_source_system"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "source_active"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "source_total_quantity"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "source_account_name"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "source_database"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "source_system"`);
  }
}
