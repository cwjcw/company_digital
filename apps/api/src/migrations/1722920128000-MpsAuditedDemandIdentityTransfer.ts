import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Permit only a same-transaction, audited monthly/allocation division transfer.
 * The application command still validates source identity and absence of execution.
 */
export class MpsAuditedDemandIdentityTransfer1722920128000 implements MigrationInterface {
  name = 'MpsAuditedDemandIdentityTransfer1722920128000';

  async up(q: QueryRunner): Promise<void> {
    const [row] = await q.query(`SELECT pg_get_functiondef('mps_guard_demand_parent()'::regprocedure) AS definition`);
    const marker = /BEGIN\s+IF \(OLD\.order_number,OLD\.item_code,OLD\.division_id,OLD\.customer_code,OLD\.allocation_id\)/;
    if (!row?.definition || !marker.test(row.definition)) {
      throw new Error('Migration121 demand-parent guard is incompatible; reviewed forward repair is required');
    }
    const definition = row.definition.replace(marker, `BEGIN
        IF TG_OP='UPDATE' AND TG_TABLE_NAME='mps_monthly_plans'
          AND (OLD.tenant_id,OLD.id,OLD.order_number,OLD.item_code,OLD.customer_code,OLD.allocation_id)
            IS NOT DISTINCT FROM (NEW.tenant_id,NEW.id,NEW.order_number,NEW.item_code,NEW.customer_code,NEW.allocation_id)
          AND OLD.division_id IS DISTINCT FROM NEW.division_id
          AND EXISTS(SELECT 1 FROM audit_logs l WHERE l.tenant_id=OLD.tenant_id
            AND l.resource='mps-order-allocation-transfers' AND l.record_id=OLD.allocation_id::text
            AND l.action='division_transfer.plan_identity_authorized'
            AND l.after_json->>'allocationId'=OLD.allocation_id::text
            AND l.after_json->>'monthlyPlanId'=OLD.id::text
            AND l.after_json->>'sourceDivisionId'=OLD.division_id::text
            AND l.after_json->>'targetDivisionId'=NEW.division_id::text
            AND l.after_json->>'xactId'=pg_current_xact_id()::text) THEN
          RETURN NEW;
        END IF;
        IF (OLD.order_number,OLD.item_code,OLD.division_id,OLD.customer_code,OLD.allocation_id)`);
    await q.query(definition);

    const [validator] = await q.query(`SELECT pg_get_functiondef('mps_assert_demand_link(text,jsonb)'::regprocedure) AS definition`);
    const linkMarker = /BEGIN\s+IF r->>'monthly_plan_id' IS NULL THEN RETURN; END IF;/;
    if (!validator?.definition || !linkMarker.test(validator.definition)) {
      throw new Error('Migration121 demand-link validator is incompatible; reviewed forward repair is required');
    }
    const linkDefinition = validator.definition.replace(linkMarker, `BEGIN
        IF r->>'monthly_plan_id' IS NULL THEN RETURN; END IF;
        IF kind='mps_order_allocations' AND EXISTS(SELECT 1 FROM audit_logs l WHERE l.tenant_id=r->>'tenant_id'
          AND l.resource='mps-order-allocation-transfers' AND l.record_id=r->>'id'
          AND l.action='division_transfer.plan_identity_authorized'
          AND l.after_json->>'allocationId'=r->>'id'
          AND l.after_json->>'monthlyPlanId'=r->>'monthly_plan_id'
          AND l.after_json->>'targetDivisionId'=r->>'division_id'
          AND l.after_json->>'xactId'=pg_current_xact_id()::text) THEN
          RETURN;
        END IF;`);
    await q.query(linkDefinition);
  }

  async down(): Promise<void> {
    throw new Error('Forward-only: retain audited plan identity transfer support and use a reviewed forward migration');
  }
}
