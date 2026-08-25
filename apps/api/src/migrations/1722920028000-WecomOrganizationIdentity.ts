import { MigrationInterface, QueryRunner } from "typeorm";

export class WecomOrganizationIdentity1722920028000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "organization_units" ADD COLUMN IF NOT EXISTS "wechat_department_id" varchar`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_organization_units_wechat_department_id" ON "organization_units" ("wechat_department_id") WHERE "wechat_department_id" IS NOT NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_organization_units_wechat_department_id"`);
    await queryRunner.query(`ALTER TABLE "organization_units" DROP COLUMN IF EXISTS "wechat_department_id"`);
  }
}
