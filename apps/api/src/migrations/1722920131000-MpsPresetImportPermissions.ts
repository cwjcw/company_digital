import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Applies the revised immutable import operation to existing preset permission
 * groups while leaving subjects, data scopes, fields and every other operation
 * untouched. Custom permission groups are not part of this migration.
 */
export class MpsPresetImportPermissions1722920131000 implements MigrationInterface {
  name = "MpsPresetImportPermissions1722920131000";

  async up(queryRunner: QueryRunner) {
    await queryRunner.query(`
      CREATE TEMP TABLE mps_preset_import_permission_before ON COMMIT DROP AS
      SELECT p.id AS permission_id,p.role_id,p.resource,p.field_key,p."import" AS old_import,
        r.permission_group_type AS group_type
      FROM permissions p
      JOIN roles r ON r.id=p.role_id
      WHERE r.permission_group_resource=p.resource
        AND r.permission_group_type IN ('ADD_ONLY','ADD_MANAGE_OWN','ADD_VIEW_ALL','MANAGE_ALL','VIEW_ALL')
        AND p.field_key='*'
        AND p."import" IS DISTINCT FROM (r.permission_group_type <> 'VIEW_ALL');

      UPDATE permissions p SET "import"=(r.permission_group_type <> 'VIEW_ALL'),updated_at=now(),updated_by='migration'
      FROM roles r
      WHERE p.role_id=r.id AND r.permission_group_resource=p.resource
        AND r.permission_group_type IN ('ADD_ONLY','ADD_MANAGE_OWN','ADD_VIEW_ALL','MANAGE_ALL','VIEW_ALL')
        AND p.field_key='*'
        AND p."import" IS DISTINCT FROM (r.permission_group_type <> 'VIEW_ALL');

      INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
      SELECT NULL,NULL,'系统迁移','permissions:'||resource,role_id::text,
        'table_permission_group.preset_import_matrix_migrated',
        jsonb_build_object('roleId',role_id,'resource',resource,'fieldKey',field_key,'groupType',group_type,'import',old_import),
        jsonb_build_object('roleId',role_id,'resource',resource,'fieldKey',field_key,'groupType',group_type,'import',(group_type <> 'VIEW_ALL')),
        'migration:MpsPresetImportPermissions1722920131000','api',NULL,'migration'
      FROM mps_preset_import_permission_before;
    `);
  }

  async down(queryRunner: QueryRunner) {
    // Do not revoke newly granted import permissions during rollback. Preset
    // action changes are forward-only because they may already have been used.
    await queryRunner.query(`SELECT 1`);
  }
}
