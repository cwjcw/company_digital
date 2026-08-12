import { MigrationInterface, QueryRunner } from "typeorm";

export class SalesOrdersAndFinishedGoodsInbound1722920007000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sales_orders" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "order_number" character varying NOT NULL,
        "item_number" character varying NOT NULL,
        "item_name" character varying,
        "order_date" date,
        "review_due_date" date,
        "quantity" numeric(18,4),
        "remark" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sales_orders" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sales_orders_order_item" UNIQUE ("order_number", "item_number")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_sales_orders_order_number" ON "sales_orders" ("order_number")`);
    await queryRunner.query(`CREATE INDEX "IDX_sales_orders_item_number" ON "sales_orders" ("item_number")`);
    await queryRunner.query(`
      CREATE TABLE "finished_goods_inbound" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sales_order_number" character varying,
        "document_date" date,
        "created_time" TIMESTAMP WITH TIME ZONE,
        "document_number" character varying NOT NULL,
        "business_type" character varying,
        "warehouse_code" character varying,
        "warehouse" character varying,
        "inbound_category" character varying,
        "workshop_code" character varying,
        "workshop" character varying,
        "handler_code" character varying,
        "handler" character varying,
        "remark" text,
        "creator" character varying,
        "auditor" character varying,
        "inventory_code" character varying NOT NULL,
        "inventory_name" character varying,
        "specification" character varying,
        "unit" character varying,
        "relation_info" character varying NOT NULL,
        "received_quantity" numeric(18,4),
        "unit_price" numeric(18,6),
        "total_amount" numeric(18,6),
        "voucher_word" character varying,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finished_goods_inbound" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_finished_goods_inbound_business_key"
          UNIQUE ("document_number", "inventory_code", "relation_info")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_finished_goods_inbound_sales_order" ON "finished_goods_inbound" ("sales_order_number")`);
    await queryRunner.query(`CREATE INDEX "IDX_finished_goods_inbound_inventory" ON "finished_goods_inbound" ("inventory_code")`);
    await queryRunner.query(`CREATE INDEX "IDX_finished_goods_inbound_relation" ON "finished_goods_inbound" ("relation_info")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "finished_goods_inbound"`);
    await queryRunner.query(`DROP TABLE "sales_orders"`);
  }
}
