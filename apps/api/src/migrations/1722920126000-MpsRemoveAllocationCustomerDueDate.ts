import type { MigrationInterface, QueryRunner } from 'typeorm';

/** User-authorized removal of the unused allocation-only customer date.
 * No other table's delivery dates, permission grants or audit records change.
 */
export class MpsRemoveAllocationCustomerDueDate1722920126000 implements MigrationInterface {
  name = 'MpsRemoveAllocationCustomerDueDate1722920126000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query('LOCK TABLE mps_order_allocations IN ACCESS EXCLUSIVE MODE');
    const [state] = await runner.query('SELECT count(*)::integer populated FROM mps_order_allocations WHERE customer_due_date IS NOT NULL');
    if (Number(state.populated) !== 0) throw new Error('Allocation customer due date contains data; refuse deletion pending review');
    // RESTRICT is the default: unexpected dependencies abort instead of cascading.
    await runner.query('ALTER TABLE mps_order_allocations DROP COLUMN customer_due_date RESTRICT');
  }

  async down(runner: QueryRunner): Promise<void> {
    // up only permits an entirely empty column; restoring it loses no dates.
    await runner.query('ALTER TABLE mps_order_allocations ADD COLUMN customer_due_date date NULL');
  }
}
