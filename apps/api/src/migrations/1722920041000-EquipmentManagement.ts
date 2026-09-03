import { MigrationInterface, QueryRunner } from "typeorm";

export class EquipmentManagement1722920041000 implements MigrationInterface {
  name = "EquipmentManagement1722920041000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE equipment_assets (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        tenant_id varchar(64) NOT NULL,
        division_organization_unit_id uuid NOT NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
        division_name_snapshot varchar NOT NULL,
        usage_department_organization_unit_id uuid NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
        usage_department_name_snapshot varchar NOT NULL,
        equipment_code varchar NOT NULL,
        equipment_name varchar NOT NULL,
        purchase_date date NULL,
        monitored boolean NOT NULL DEFAULT true,
        active boolean NOT NULL DEFAULT true,
        source_sheet_row integer NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system',
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_equipment_assets_business UNIQUE (tenant_id, division_organization_unit_id, equipment_code),
        CONSTRAINT ck_equipment_assets_code CHECK (btrim(equipment_code) <> ''),
        CONSTRAINT ck_equipment_assets_name CHECK (btrim(equipment_name) <> ''),
        CONSTRAINT ck_equipment_assets_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_equipment_assets_division ON equipment_assets(tenant_id, division_organization_unit_id)`);
    await queryRunner.query(`CREATE INDEX idx_equipment_assets_monitoring ON equipment_assets(tenant_id, monitored, active) WHERE active=true`);

    await queryRunner.query(`
      CREATE TABLE equipment_responsibles (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        tenant_id varchar(64) NOT NULL,
        equipment_id uuid NOT NULL REFERENCES equipment_assets(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system',
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_equipment_responsibles UNIQUE (tenant_id, equipment_id, user_id),
        CONSTRAINT ck_equipment_responsibles_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_equipment_responsibles_user ON equipment_responsibles(tenant_id, user_id)`);

    await queryRunner.query(`
      CREATE TABLE equipment_status_reports (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        tenant_id varchar(64) NOT NULL,
        equipment_id uuid NOT NULL REFERENCES equipment_assets(id) ON DELETE RESTRICT,
        division_organization_unit_id uuid NOT NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
        usage_department_organization_unit_id uuid NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
        equipment_code_snapshot varchar NOT NULL,
        equipment_name_snapshot varchar NOT NULL,
        division_name_snapshot varchar NOT NULL,
        usage_department_name_snapshot varchar NOT NULL,
        report_date date NOT NULL,
        runtime_minutes integer NOT NULL DEFAULT 0,
        fault_minutes integer NOT NULL DEFAULT 0,
        fault_reason varchar NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system',
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_equipment_status_report UNIQUE (tenant_id, equipment_id, report_date),
        CONSTRAINT ck_equipment_status_runtime CHECK (runtime_minutes >= 0),
        CONSTRAINT ck_equipment_status_fault CHECK (fault_minutes >= 0),
        CONSTRAINT ck_equipment_status_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_equipment_status_report_date ON equipment_status_reports(tenant_id, report_date DESC)`);
    await queryRunner.query(`CREATE INDEX idx_equipment_status_equipment ON equipment_status_reports(tenant_id, equipment_id, report_date DESC)`);

    await queryRunner.query(`
      INSERT INTO dictionary_types(code, name, created_by, updated_by)
      VALUES ('equipmentFaultReason', '设备故障原因', NULL, 'migration')
      ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, updated_at=now(), updated_by='migration'
    `);
    await queryRunner.query(`
      INSERT INTO dictionary_values(type_id, value, sort_order, enabled, created_by, updated_by)
      SELECT dt.id, source.value, source.sort_order, true, NULL, 'migration'
      FROM dictionary_types dt
      CROSS JOIN (VALUES
        ('机械故障', 1), ('电气故障', 2), ('辅助系统故障', 3),
        ('工装刀具故障', 4), ('物料工艺故障', 5)
      ) AS source(value, sort_order)
      WHERE dt.code='equipmentFaultReason'
      ON CONFLICT (type_id, value) DO UPDATE SET sort_order=EXCLUDED.sort_order, enabled=true, updated_at=now(), updated_by='migration'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS equipment_status_reports`);
    await queryRunner.query(`DROP TABLE IF EXISTS equipment_responsibles`);
    await queryRunner.query(`DROP TABLE IF EXISTS equipment_assets`);
    await queryRunner.query(`DELETE FROM dictionary_values WHERE type_id IN (SELECT id FROM dictionary_types WHERE code='equipmentFaultReason')`);
    await queryRunner.query(`DELETE FROM dictionary_types WHERE code='equipmentFaultReason'`);
  }
}
