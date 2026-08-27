import { MigrationInterface, QueryRunner } from "typeorm";

export class TablePermissionGroups1722920031000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS permission_group_resource varchar`);
    await queryRunner.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS permission_group_type varchar`);
    await queryRunner.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS permission_group_display_name varchar`);
    await queryRunner.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS permission_group_enabled boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS permission_group_scope varchar`);
    await queryRunner.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS permission_group_condition_match varchar NOT NULL DEFAULT 'ALL'`);
    await queryRunner.query(`ALTER TABLE roles ADD COLUMN IF NOT EXISTS permission_group_data_rules jsonb NOT NULL DEFAULT '[]'::jsonb`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS UQ_table_permission_preset ON roles(permission_group_resource,permission_group_type) WHERE permission_group_resource IS NOT NULL AND permission_group_type <> 'CUSTOM'`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS UQ_table_permission_custom_name ON roles(permission_group_resource,lower(permission_group_display_name)) WHERE permission_group_resource IS NOT NULL AND permission_group_type = 'CUSTOM'`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS permission_group_subjects (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        subject_type varchar NOT NULL CHECK(subject_type IN ('USER','ORGANIZATION','ROLE')),
        subject_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system',
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT UQ_permission_group_subject UNIQUE(role_id,subject_type,subject_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS IDX_permission_group_subject_lookup ON permission_group_subjects(subject_type,subject_id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS permission_group_subjects`);
    await queryRunner.query(`DROP INDEX IF EXISTS UQ_table_permission_custom_name`);
    await queryRunner.query(`DROP INDEX IF EXISTS UQ_table_permission_preset`);
    await queryRunner.query(`ALTER TABLE roles DROP COLUMN IF EXISTS permission_group_data_rules`);
    await queryRunner.query(`ALTER TABLE roles DROP COLUMN IF EXISTS permission_group_condition_match`);
    await queryRunner.query(`ALTER TABLE roles DROP COLUMN IF EXISTS permission_group_scope`);
    await queryRunner.query(`ALTER TABLE roles DROP COLUMN IF EXISTS permission_group_enabled`);
    await queryRunner.query(`ALTER TABLE roles DROP COLUMN IF EXISTS permission_group_display_name`);
    await queryRunner.query(`ALTER TABLE roles DROP COLUMN IF EXISTS permission_group_type`);
    await queryRunner.query(`ALTER TABLE roles DROP COLUMN IF EXISTS permission_group_resource`);
  }
}
