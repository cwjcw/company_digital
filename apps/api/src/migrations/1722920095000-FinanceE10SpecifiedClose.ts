import type { MigrationInterface, QueryRunner } from 'typeorm';

const reviewed = 'NOT record.conflict AND NOT record.duplicate_sequence AND NOT record.duplicate_order_no AND record.missing_lines=0 AND record.issue_lines=0';

/** One eligible order relation for monthly rows, dashboard, ranking and their exports.
 * Keep every original item and the historical approval/date/amount policies unchanged.
 */
export class FinanceE10SpecifiedClose1722920095000 implements MigrationInterface {
  name = 'FinanceE10SpecifiedClose1722920095000';
  async up(r: QueryRunner) {
    await r.query(`CREATE OR REPLACE VIEW finance_e10_monthly WITH(security_invoker=true) AS
 SELECT record.* FROM finance_e10_orders_all record WHERE ${reviewed}
 AND NOT EXISTS (
  SELECT 1 FROM finance_e10_lines source
  WHERE source.tenant_id=record.tenant_id
   AND source.source_database=record.source_database
   AND source.source_order_id=record.source_order_id
   AND source.payload->>'headerCloseCode'='1'
 )`);
  }
  async down(r: QueryRunner) {
    // Roll back only the derived statistical policy; retained source rows/audits are never deleted.
    await r.query(`CREATE OR REPLACE VIEW finance_e10_monthly WITH(security_invoker=true) AS
 SELECT record.* FROM finance_e10_orders_all record WHERE ${reviewed}`);
  }
}
