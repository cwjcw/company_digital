import { MigrationInterface, QueryRunner } from "typeorm";

export class UserPortalModuleOrder1722920034000 implements MigrationInterface {
  name = "UserPortalModuleOrder1722920034000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS portal_module_order jsonb NOT NULL DEFAULT '[]'::jsonb`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS portal_module_order`);
  }
}
