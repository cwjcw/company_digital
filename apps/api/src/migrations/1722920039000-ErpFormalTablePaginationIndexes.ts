import { MigrationInterface, QueryRunner } from "typeorm";

export class ErpFormalTablePaginationIndexes1722920039000 implements MigrationInterface {
  name = "ErpFormalTablePaginationIndexes1722920039000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX idx_sales_orders_page
        ON sales_orders(order_date DESC,order_number,item_number,id);
      CREATE INDEX idx_finished_goods_inbound_page
        ON finished_goods_inbound(inbound_date DESC,document_number,line_number,id);
      CREATE INDEX idx_finished_goods_outbound_page
        ON finished_goods_outbound(document_date DESC,document_number,item_number,id);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_finished_goods_outbound_page;
      DROP INDEX IF EXISTS idx_finished_goods_inbound_page;
      DROP INDEX IF EXISTS idx_sales_orders_page;
    `);
  }
}
