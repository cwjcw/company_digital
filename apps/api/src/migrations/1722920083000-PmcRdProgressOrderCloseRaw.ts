import type { MigrationInterface, QueryRunner } from 'typeorm';
/** CLOSE is an existing stable E10 source field. Preserve it without interpreting or excluding orders. */
export class PmcRdProgressOrderCloseRaw1722920083000 implements MigrationInterface {
  name = 'PmcRdProgressOrderCloseRaw1722920083000';
  async up(runner: QueryRunner): Promise<void> { await runner.query('ALTER TABLE pmc_rd_progress_items ADD COLUMN order_close_raw text NULL'); }
  async down(runner: QueryRunner): Promise<void> { await runner.query('ALTER TABLE pmc_rd_progress_items DROP COLUMN order_close_raw'); }
}
