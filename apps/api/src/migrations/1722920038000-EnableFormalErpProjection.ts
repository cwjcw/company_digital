import { MigrationInterface, QueryRunner } from "typeorm";

export class EnableFormalErpProjection1722920038000 implements MigrationInterface {
  name = "EnableFormalErpProjection1722920038000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE orders SET source_system='T+' WHERE source_system='TPLUS';
      UPDATE sales_orders SET source_system='T+' WHERE source_system='TPLUS';
      UPDATE finished_goods_inbound SET source_system='T+' WHERE source_system='TPLUS';
      UPDATE finished_goods_outbound SET source_system='T+' WHERE source_system='TPLUS';

      DROP INDEX IF EXISTS "UQ_sales_orders_order_item_sequence";
      CREATE UNIQUE INDEX uq_sales_orders_manual_business_key
        ON sales_orders(order_number,item_number,sequence_number) NULLS NOT DISTINCT
        WHERE source_key IS NULL;

      UPDATE erp_projection_consumers
      SET record_types=ARRAY['ORDER_HEADER','ORDER_LINE','DELIVERY_PLAN'],updated_at=now(),updated_by='migration',version=version+1
      WHERE tenant_id='KAINAN' AND consumer_key='sales-orders-v1';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE erp_projection_consumers
      SET record_types=ARRAY['ORDER_HEADER','ORDER_LINE'],updated_at=now(),updated_by='migration',version=version+1
      WHERE tenant_id='KAINAN' AND consumer_key='sales-orders-v1';
      DROP INDEX IF EXISTS uq_sales_orders_manual_business_key;
      CREATE UNIQUE INDEX "UQ_sales_orders_order_item_sequence"
        ON sales_orders(order_number,item_number,sequence_number) NULLS NOT DISTINCT;
      UPDATE orders SET source_system='TPLUS' WHERE source_system='T+';
      UPDATE sales_orders SET source_system='TPLUS' WHERE source_system='T+';
      UPDATE finished_goods_inbound SET source_system='TPLUS' WHERE source_system='T+';
      UPDATE finished_goods_outbound SET source_system='TPLUS' WHERE source_system='T+';
    `);
  }
}
