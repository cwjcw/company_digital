import { MigrationInterface, QueryRunner } from "typeorm";

export class AdministratorGrants1722920035000 implements MigrationInterface {
  name = "AdministratorGrants1722920035000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS administrator_grants (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        tenant_id varchar(64) NOT NULL,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        system_admin boolean NOT NULL DEFAULT false,
        module_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system',
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_administrator_grants_tenant_user UNIQUE (tenant_id, user_id),
        CONSTRAINT ck_administrator_grants_modules CHECK (jsonb_typeof(module_codes) = 'array' AND module_codes <@ '["cockpit","planning","data","marketing","hr","workflow"]'::jsonb),
        CONSTRAINT ck_administrator_grants_nonempty CHECK (system_admin OR jsonb_array_length(module_codes) > 0),
        CONSTRAINT ck_administrator_grants_system_exclusive CHECK (NOT system_admin OR jsonb_array_length(module_codes) = 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_administrator_grants_tenant ON administrator_grants(tenant_id)`);
    await queryRunner.query(`
      INSERT INTO administrator_grants (tenant_id, user_id, system_admin, module_codes, created_by, updated_by)
      SELECT COALESCE(NULLIF(current_setting('app.tenant_id', true), ''), 'KAINAN'), ur.user_id, true, '[]'::jsonb, ur.user_id, 'migration'
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      JOIN users u ON u.id = ur.user_id AND u.enabled = true
      WHERE r.name = '系统管理员'
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET system_admin = true, module_codes = '[]'::jsonb, updated_at = now(), updated_by = 'migration'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS administrator_grants`);
  }
}
