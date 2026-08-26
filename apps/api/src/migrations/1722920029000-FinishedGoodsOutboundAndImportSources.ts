import { MigrationInterface, QueryRunner } from "typeorm";

export class FinishedGoodsOutboundAndImportSources1722920029000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS finished_goods_outbound (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        source_system varchar NOT NULL,
        source_database varchar NOT NULL,
        source_key varchar NOT NULL,
        document_date date,
        document_number varchar NOT NULL,
        document_status varchar,
        direction_value smallint,
        voucher_type varchar,
        business_type varchar,
        customer_code varchar,
        customer_name varchar,
        sales_order_number varchar,
        item_number varchar NOT NULL,
        item_name varchar,
        specification varchar,
        quantity numeric(18,4),
        unit varchar,
        unit_price numeric(18,6),
        total_amount numeric(20,6),
        warehouse_code varchar,
        warehouse varchar,
        source_document_number varchar,
        creator varchar,
        auditor varchar,
        remark text,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by uuid,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system',
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT UQ_finished_goods_outbound_source UNIQUE(source_system,source_database,source_key),
        CONSTRAINT CK_finished_goods_outbound_version_positive CHECK(version > 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS IDX_finished_goods_outbound_document ON finished_goods_outbound(document_number)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS IDX_finished_goods_outbound_sales_order ON finished_goods_outbound(sales_order_number)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS IDX_finished_goods_outbound_item ON finished_goods_outbound(item_number)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS IDX_finished_goods_outbound_source_database ON finished_goods_outbound(source_system,source_database)`);

    for (const table of ["sales_orders", "finished_goods_inbound"]) {
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS source_system varchar`);
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS source_database varchar`);
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS source_key varchar`);
      await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS UQ_${table}_source ON ${table}(source_system,source_database,source_key) WHERE source_key IS NOT NULL`);
    }
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS UQ_orders_source_order ON orders(source_system,source_database,order_number) WHERE source_system IS NOT NULL AND source_database IS NOT NULL`);

    await queryRunner.query(`
      INSERT INTO permissions(id,role_id,resource,field_key,"read","create","copy","update","delete",batch_print,batch_update,"import","export",updated_by)
      SELECT uuid_generate_v4(),role.id,'finished-goods-outbound','*',true,
        COALESCE(existing."create",false),COALESCE(existing.copy,false),COALESCE(existing."update",false),COALESCE(existing."delete",false),
        COALESCE(existing.batch_print,false),COALESCE(existing.batch_update,false),COALESCE(existing."import",false),COALESCE(existing."export",false),'migration'
      FROM roles role
      LEFT JOIN permissions existing ON existing.role_id=role.id AND existing.resource='finished-goods-inbound' AND existing.field_key='*'
      WHERE NOT EXISTS (SELECT 1 FROM permissions present WHERE present.role_id=role.id AND present.resource='finished-goods-outbound' AND present.field_key='*')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM permissions WHERE resource='finished-goods-outbound'`);
    await queryRunner.query(`DROP INDEX IF EXISTS UQ_orders_source_order`);
    await queryRunner.query(`DROP TABLE IF EXISTS finished_goods_outbound`);
    for (const table of ["finished_goods_inbound", "sales_orders"]) {
      await queryRunner.query(`DROP INDEX IF EXISTS UQ_${table}_source`);
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS source_key`);
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS source_database`);
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS source_system`);
    }
  }
}
