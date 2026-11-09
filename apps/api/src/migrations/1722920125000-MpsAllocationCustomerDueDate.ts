import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds the dedicated customer due date to KDOS order allocations.
 * Existing rows remain NULL; this migration never reads ERP/E10 dates or updates allocations.
 */
export class MpsAllocationCustomerDueDate1722920125000 implements MigrationInterface {
  name = 'MpsAllocationCustomerDueDate1722920125000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE mps_order_allocations ADD COLUMN customer_due_date date NULL`);
    await runner.query(`COMMENT ON COLUMN mps_order_allocations.customer_due_date IS '客户交期，由KDOS订单分配表维护；不从ERP订单自动回填'`);
  }

  async down(): Promise<void> {
    throw new Error('Forward-only migration: customer_due_date may contain business values; preserve the column and roll back application code only.');
  }
}
