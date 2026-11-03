import { MigrationInterface, QueryRunner } from "typeorm";

export class UserTablePreferences1722920117000 implements MigrationInterface {
  name = "UserTablePreferences1722920117000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS table_preferences jsonb NOT NULL DEFAULT '{}'::jsonb`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS table_preferences`);
  }
}
