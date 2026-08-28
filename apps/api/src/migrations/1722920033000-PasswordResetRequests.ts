import { MigrationInterface, QueryRunner } from "typeorm";

export class PasswordResetRequests1722920033000 implements MigrationInterface {
  name = "PasswordResetRequests1722920033000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS password_reset_requests (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash varchar NOT NULL,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      request_ip varchar,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by varchar NOT NULL DEFAULT 'system',
      version integer NOT NULL DEFAULT 1 CHECK (version > 0)
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS IDX_password_reset_requests_user_created ON password_reset_requests(user_id, created_at DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS IDX_password_reset_requests_expiry ON password_reset_requests(expires_at) WHERE consumed_at IS NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS password_reset_requests`);
  }
}
