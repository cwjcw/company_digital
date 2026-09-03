import { MigrationInterface, QueryRunner } from "typeorm";

export class PasswordResetAttemptLock1722920040000 implements MigrationInterface {
  name = "PasswordResetAttemptLock1722920040000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_failures integer NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_locked_at timestamptz;
      DO $$ BEGIN
        ALTER TABLE users ADD CONSTRAINT ck_users_password_reset_failures
          CHECK (password_reset_failures >= 0 AND password_reset_failures <= 10);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_password_reset_failures;
      ALTER TABLE users DROP COLUMN IF EXISTS password_reset_locked_at;
      ALTER TABLE users DROP COLUMN IF EXISTS password_reset_failures;
    `);
  }
}
