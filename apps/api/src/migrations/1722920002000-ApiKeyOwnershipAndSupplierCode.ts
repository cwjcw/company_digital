import { MigrationInterface, QueryRunner } from "typeorm";

export class ApiKeyOwnershipAndSupplierCode1722920002000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "code" varchar');
    await queryRunner.query('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_suppliers_code" ON "suppliers" ("code") WHERE "code" IS NOT NULL');
    await queryRunner.query('ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "user_id" uuid');
    await queryRunner.query('ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "role_id" uuid');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "api_keys" DROP COLUMN IF EXISTS "role_id"');
    await queryRunner.query('ALTER TABLE "api_keys" DROP COLUMN IF EXISTS "user_id"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_suppliers_code"');
    await queryRunner.query('ALTER TABLE "suppliers" DROP COLUMN IF EXISTS "code"');
  }
}
