import { MigrationInterface, QueryRunner } from "typeorm";

export class SupplyChainSuppliers1722920046000 implements MigrationInterface {
  name = "SupplyChainSuppliers1722920046000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE supply_chain_suppliers (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        tenant_id varchar(64) NOT NULL,
        source_system varchar(32) NOT NULL,
        source_database varchar(128) NOT NULL,
        source_account_name varchar(128) NOT NULL,
        source_id varchar(128) NOT NULL,
        code varchar(128) NOT NULL,
        name varchar(500) NOT NULL,
        abbreviation varchar(500) NULL,
        shorthand varchar(255) NULL,
        category_code varchar(128) NULL,
        category_name varchar(500) NULL,
        partner_type integer NOT NULL,
        partner_type_label varchar(64) NOT NULL,
        representative varchar(255) NULL,
        contact varchar(255) NULL,
        mobile_phone varchar(255) NULL,
        telephone varchar(255) NULL,
        fax varchar(255) NULL,
        email varchar(500) NULL,
        address text NULL,
        enabled boolean NOT NULL DEFAULT true,
        source_updated_at varchar(40) NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system',
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_supply_chain_supplier_source UNIQUE (tenant_id, source_system, source_database, source_id),
        CONSTRAINT ck_supply_chain_supplier_code CHECK (btrim(code) <> ''),
        CONSTRAINT ck_supply_chain_supplier_name CHECK (btrim(name) <> ''),
        CONSTRAINT ck_supply_chain_supplier_type CHECK (partner_type IN (226,228)),
        CONSTRAINT ck_supply_chain_supplier_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_supply_chain_suppliers_code ON supply_chain_suppliers(tenant_id, code)`);
    await queryRunner.query(`CREATE INDEX idx_supply_chain_suppliers_name ON supply_chain_suppliers(tenant_id, name)`);
    await queryRunner.query(`CREATE INDEX idx_supply_chain_suppliers_account_status ON supply_chain_suppliers(tenant_id, source_database, enabled)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS supply_chain_suppliers`);
  }
}
