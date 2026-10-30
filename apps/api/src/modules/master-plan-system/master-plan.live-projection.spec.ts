import { MasterPlanSyncService } from "./master-plan.sync.service";
import { allocationProjectionCandidatesSql } from "./master-plan.allocation-projection";
import { allocationOrderTotalsSql } from "./master-plan.allocation-source";

/** Detailed quantities, migration, idempotency/history and scope are exercised by
 * scripts/test-allocation-plan-source-postgres.cjs on real isolated PostgreSQL. */
describe("allocation demand boundaries", () => {
  it("admits approved active allocations by tenant/order/item/division independently of ERP", () => {
    expect(allocationProjectionCandidatesSql).toContain("a.order_status='已审核'");
    expect(allocationProjectionCandidatesSql).toContain("a.archived_at IS NULL");
    expect(allocationProjectionCandidatesSql).toContain("GROUP BY a.tenant_id,a.order_number,a.item_code,a.division_id");
    expect(allocationProjectionCandidatesSql).not.toMatch(/mps_erp_order_lines|watermark|order_quantity|source_key|customer_division_mappings/);
  });
  it("preserves ambiguous historical ownership and aggregates item fractions before averaging orders", () => {
    expect(allocationProjectionCandidatesSql).toContain("parent.archived_at IS NOT NULL");
    expect(allocationProjectionCandidatesSql).toContain("保留历史计划或人工归属");
    expect(allocationOrderTotalsSql).toContain("GROUP BY a.order_number,a.item_code");
    expect(allocationOrderTotalsSql).toContain("avg(CASE WHEN required_quantity<=0");
    expect(allocationOrderTotalsSql).toContain("blocked.skip_reason IS NOT NULL");
  });
  it("keeps tenant locks and never writes allocation/ERP source records during plan reconciliation", async () => {
    const query = jest.fn(async (sql:string) => sql.includes("count(*)::integer count FROM stock_facts")
      ? [{count:0}] : sql.includes("unapproved_allocations\n") ? [{unapproved_allocations:0}] : []);
    const service = new MasterPlanSyncService({transaction:async (_isolation:string,work:any)=>work({query})} as never);
    const result = await (service as any).projectPlans("SYNTHETIC",null,"test");
    expect(result.count).toBe(0);
    const sql=query.mock.calls.map(([s])=>s).join("\n");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:mps_order_allocations|mps_erp_order_lines)\b/);
    expect(sql).not.toContain("SET cumulative_inbound_quantity=0");
  });
});

describe("retained weekly stock allocation", () => {
  it("keeps the existing Kejia-only FIFO and does not treat missing stock as allocated demand", async () => {
    const query=jest.fn(async(sql:string)=>sql.includes("count(*)::integer count FROM stock_facts")?[{count:0}]:[]);
    const service=new MasterPlanSyncService({transaction:async(work:any)=>work({query})} as never);
    await (service as any).allocateInbound("SYNTHETIC","test");
    const sql=query.mock.calls.map(([s])=>s).find(s=>s.includes("WITH inbound_totals AS"))!;
    expect(sql).toContain("source_database='UFTData418971_000003'");
    expect(sql).toContain("ORDER BY w.latest_customer_due_date NULLS LAST,w.delivery_number::numeric,w.id");
    expect(sql).toContain("least(inbound_quantity-prior_planned,planned_quantity)");
    expect(sql).not.toContain("UFTData741219_000012");
  });
});
