import { MigrationInterface, QueryRunner } from "typeorm";

export class SalesOrderAndPlanningOperations1722920023000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const columns = [
      ['document_date','date'],['document_name','character varying'],['close_status','character varying'],['customer_code','character varying'],
      ['ship_to_customer_code','character varying'],['invoice_customer_code','character varying'],['employee_name','character varying'],['tax_included','character varying'],
      ['currency_code','character varying'],['exchange_rate','numeric(18,6)'],['sequence_number','integer'],['unit_name','character varying'],
      ['business_quantity','numeric(18,4)'],['price_quantity','numeric(18,4)'],['price','numeric(18,6)'],['rmb_price','numeric(18,6)'],
      ['rmb_tax_included_amount','numeric(20,6)'],['delivered_business_quantity','numeric(18,4)'],['planned_delivery_date','date'],
      ['tax_rate','numeric(10,4)'],['amount_excluding_tax_bc','numeric(20,6)'],['tax_bc','numeric(20,6)'],
      ['creator_user_id','character varying'],['creator_user_name','character varying'],['admin_unit_name','character varying'],
      ['owner_department','character varying'],['owner_employee','character varying'],['owner_division','character varying']
    ];
    for (const [name, type] of columns) await queryRunner.query(`ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "${name}" ${type}`);
    await queryRunner.query(`UPDATE sales_orders SET business_quantity=quantity, planned_delivery_date=review_due_date WHERE business_quantity IS NULL`);
    await queryRunner.query(`ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS "UQ_sales_orders_order_item"`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_sales_orders_order_item_sequence" ON sales_orders(order_number,item_number,sequence_number) NULLS NOT DISTINCT`);
    await queryRunner.query(`UPDATE permissions SET resource='order-schedule' WHERE resource='two-week-schedule' AND NOT EXISTS (SELECT 1 FROM permissions p2 WHERE p2.role_id=permissions.role_id AND p2.resource='order-schedule' AND p2.field_key=permissions.field_key)`);
    await queryRunner.query(`DELETE FROM permissions WHERE resource='two-week-schedule'`);
    await queryRunner.query(`INSERT INTO permissions(id,role_id,resource,field_key,"read","create","update","delete","import","export")
      SELECT uuid_generate_v4(),role.id,resource.code,'*',true,true,true,true,true,true FROM roles role CROSS JOIN (VALUES('order-schedule'),('weekly-plan'),('work-report')) resource(code)
      WHERE role.name='集团管理员' ON CONFLICT(role_id,resource,field_key) DO NOTHING`);
  }
  async down(): Promise<void> { /* Forward-only: imported E10 columns and operational records are retained. */ }
}
