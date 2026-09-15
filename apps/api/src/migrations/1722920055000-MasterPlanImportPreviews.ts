import { MigrationInterface, QueryRunner } from "typeorm";

export class MasterPlanImportPreviews1722920055000 implements MigrationInterface {
  name = "MasterPlanImportPreviews1722920055000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE mps_import_previews (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        tenant_id varchar(64) NOT NULL,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        resource varchar(128) NOT NULL,
        file_hash varchar(64) NOT NULL,
        payload_json jsonb NOT NULL,
        expires_at timestamptz NOT NULL,
        confirmed_at timestamptz,
        confirmation_result jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT ck_mps_import_preview_expiry CHECK(expires_at > created_at),
        CONSTRAINT ck_mps_import_preview_version CHECK(version > 0)
      );
      CREATE INDEX idx_mps_import_previews_expiry ON mps_import_previews(expires_at);
      CREATE INDEX idx_mps_import_previews_owner ON mps_import_previews(tenant_id,user_id,resource,expires_at);
      ALTER TABLE mps_import_previews ENABLE ROW LEVEL SECURITY;
      CREATE POLICY mps_import_previews_tenant_policy ON mps_import_previews
        USING (tenant_id=current_setting('app.tenant_id',true))
        WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS mps_import_previews");
  }
}
