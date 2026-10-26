import type { MigrationInterface, QueryRunner } from 'typeorm';
import { standardProcesses } from '@tracker/shared';

/** Configuration only: never changes weekly tasks, historical reports or source ERP. */
export class MpsExternalProcessMappings1722920109000 implements MigrationInterface {
  name = 'MpsExternalProcessMappings1722920109000';
  async up(q: QueryRunner) {
    const codes = standardProcesses.map(p => `'${p.code}'`).join(',');
    await q.query(`CREATE TABLE mps_external_process_mappings (
      id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
      division_id uuid NOT NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
      source_key varchar(64) NOT NULL, source_process_code varchar(128) NOT NULL,
      source_process_name varchar(256) NOT NULL, mapping_mode varchar(16) NOT NULL,
      process_code varchar(32), enabled boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
      updated_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system',
      version integer NOT NULL DEFAULT 1 CHECK(version>0),
      UNIQUE(tenant_id,division_id,source_key,source_process_code),
      CHECK(length(trim(source_key))>0 AND length(trim(source_process_code))>0 AND length(trim(source_process_name))>0),
      CHECK((mapping_mode='MATCH' AND process_code IN (${codes})) OR (mapping_mode='IGNORE' AND process_code IS NULL)),
      CHECK(mapping_mode<>'MATCH' OR process_code IS NOT NULL)
    );
    ALTER TABLE mps_external_process_mappings ENABLE ROW LEVEL SECURITY;
    CREATE POLICY mps_external_process_mappings_tenant ON mps_external_process_mappings
      USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
    CREATE FUNCTION mps_external_process_mapping_division_guard() RETURNS trigger AS $$
    BEGIN
      IF NOT EXISTS(SELECT 1 FROM organization_units o WHERE o.id=NEW.division_id AND o.tenant_id=NEW.tenant_id) THEN
        RAISE EXCEPTION '工序映射事业部不属于当前租户' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER mps_external_process_mapping_division_guard BEFORE INSERT OR UPDATE OF tenant_id,division_id
      ON mps_external_process_mappings FOR EACH ROW EXECUTE FUNCTION mps_external_process_mapping_division_guard();`);
  }
  async down(q: QueryRunner) {
    const [r] = await q.query('SELECT count(*)::int n FROM mps_external_process_mappings');
    if (r.n) throw new Error('已有事业部工序绑定，请先保护配置数据后再回退');
    await q.query('DROP TABLE mps_external_process_mappings; DROP FUNCTION mps_external_process_mapping_division_guard();');
  }
}
