import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSalesOrderSpecification1722920024000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "specification" character varying`);
  }

  async down(): Promise<void> { /* Forward-only: imported E10 specification data is retained. */ }
}
