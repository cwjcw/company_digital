import type { MigrationInterface, QueryRunner } from 'typeorm';

/** organization_units is the retained shared directory, not a tenant-owned table.
 * Tenant isolation belongs to the mapping row/RLS and Application data scopes.
 * Keep migration108 immutable; replace its invalid directory-column assumption.
 */
export class MpsMappingSharedOrganizationDirectory1722920110000 implements MigrationInterface {
  name='MpsMappingSharedOrganizationDirectory1722920110000';
  async up(q:QueryRunner) {
    await q.query(`DROP TRIGGER mps_external_process_mapping_division_guard ON mps_external_process_mappings;
      DROP FUNCTION mps_external_process_mapping_division_guard();`);
  }
  async down(q:QueryRunner) {
    // Retain valid shared-directory semantics even when reversing this repair.
    // The original table FK continues to enforce directory membership throughout.
    await q.query(`CREATE FUNCTION mps_external_process_mapping_division_guard() RETURNS trigger AS $$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM organization_units o WHERE o.id=NEW.division_id) THEN
          RAISE EXCEPTION '工序映射事业部不存在' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER mps_external_process_mapping_division_guard BEFORE INSERT OR UPDATE OF tenant_id,division_id
        ON mps_external_process_mappings FOR EACH ROW EXECUTE FUNCTION mps_external_process_mapping_division_guard();`);
  }
}
