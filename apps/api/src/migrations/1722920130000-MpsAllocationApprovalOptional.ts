import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Plan demand is determined by an active positive allocation, not the KDOS review label. */
export class MpsAllocationApprovalOptional1722920130000 implements MigrationInterface {
  name = 'MpsAllocationApprovalOptional1722920130000';

  async up(q: QueryRunner): Promise<void> {
    const [row] = await q.query(`SELECT pg_get_functiondef('mps_allocation_source_recovery_allowed(jsonb,jsonb)'::regprocedure) definition`);
    let definition = String(row?.definition ?? '');
    const beforeSource = "OR new_source.id IS NULL OR new_source.archived_at IS NOT NULL OR new_source.order_status<>'已审核' OR NOT new_source.manually_maintained";
    const afterSource = 'OR new_source.id IS NULL OR new_source.archived_at IS NOT NULL OR new_source.allocated_quantity<=0';
    const beforeGroup = "AND a.archived_at IS NULL AND a.order_status='已审核' AND (NOT a.manually_maintained OR a.allocated_quantity<0\n            OR a.customer_code IS DISTINCT FROM new_source.customer_code";
    const afterGroup = 'AND a.archived_at IS NULL AND a.allocated_quantity>0 AND (a.customer_code IS DISTINCT FROM new_source.customer_code';
    if (!definition.includes(beforeSource) || !definition.includes(beforeGroup)) {
      throw new Error('mps_allocation_source_recovery_allowed() changed; refusing an unreviewed trigger rewrite');
    }
    definition = definition.replace(beforeSource, afterSource).replace(beforeGroup, afterGroup);
    await q.query(definition);
  }

  async down(): Promise<void> {
    throw new Error('Forward-only: allocation approval is metadata; use a reviewed forward migration to change this rule');
  }
}
