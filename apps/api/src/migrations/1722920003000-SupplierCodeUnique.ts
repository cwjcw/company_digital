import { MigrationInterface, QueryRunner } from "typeorm";

export class SupplierCodeUnique1722920003000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_suppliers_code"');
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_suppliers_code" ON "suppliers" ("code")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_suppliers_code"');
    await queryRunner.query('CREATE UNIQUE INDEX "IDX_suppliers_code" ON "suppliers" ("code") WHERE "code" IS NOT NULL');
  }
}
