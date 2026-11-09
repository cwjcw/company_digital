import { MpsReviewDueDateIndependent1722920124000 } from '../../migrations/1722920124000-MpsReviewDueDateIndependent';

describe('review due-date independent migration guard',()=>{
  it('clears only review module rows, keeps system audit, and removes only reviewed links and named columns',async()=>{
    const query=jest.fn().mockImplementation(async(sql:string)=>{
      if(sql.includes('AS review_table'))return [{review_table:true,changes_table:true,application_links:true,demand_link:true,target_columns:0}];
      if(sql.includes("WHERE resource='mps-review-due-dates'"))return [{n:0}];
      if(sql.includes('SELECT DISTINCT tenant_id FROM mps_review_due_dates'))return [{tenant_id:'SYNTHETIC'}];
      if(sql.includes('pg_get_functiondef'))return [{definition:"CREATE FUNCTION mps_assert_demand_link() BEGIN item:=CASE WHEN kind='mps_review_due_dates' THEN r->>'drawing_number' ELSE r->>'item_code' END; END"}];
      return [];
    });
    await new MpsReviewDueDateIndependent1722920124000().up({query} as never);
    const sql=query.mock.calls.map(([statement])=>String(statement)).join('\n');
    expect(sql).toContain('customer_due_date');expect(sql).toContain('ADD COLUMN order_date');expect(sql).not.toContain('preproduction_review_date');
    expect(sql).not.toContain('UPDATE mps_review_due_dates');expect(sql).toContain('DELETE FROM mps_review_due_date_changes');expect(sql).toContain('DELETE FROM mps_review_due_dates');
    expect(sql).toContain('review_due_delete_authorized');expect(sql).not.toContain('DROP TABLE audit_logs');
    expect(sql).toContain('DROP TABLE mps_review_base_plan_links RESTRICT');
    for(const column of ['due_date','change_count','previous_inbound_date','monthly_plan_id'])expect(sql).toContain(`DROP COLUMN ${column} RESTRICT`);
    for(const column of ['source_division_id','source_order_number','source_batch_number','source_drawing_number'])expect(sql).toContain(`DROP COLUMN ${column} RESTRICT`);
    expect(sql).not.toContain('CASCADE');expect(sql).not.toContain('DROP TABLE mps_review_due_date_changes');
    expect(query.mock.calls.some(([statement])=>String(statement).includes('mps_guard_demand_parent'))).toBe(true);
  });
  it('stops on incompatible schema or queued legacy events before any DDL',async()=>{
    const run=async(state:Record<string,unknown>,queued=0)=>{
      const query=jest.fn().mockImplementation(async(sql:string)=>sql.includes('AS review_table')
        ?[state]:sql.includes("WHERE resource='mps-review-due-dates'")?[{n:queued}]:[]);
      await expect(new MpsReviewDueDateIndependent1722920124000().up({query} as never)).rejects.toThrow();
      expect(query.mock.calls.every(([statement])=>!String(statement).includes('ALTER TABLE')&&!String(statement).includes('DROP '))).toBe(true);
    };
    const valid={review_table:true,changes_table:true,application_links:true,demand_link:true,target_columns:0};
    await run({...valid,changes_table:false});await run(valid,1);
  });
  it('refuses reverse migration because deleted column values are not recoverable',async()=>{
    await expect(new MpsReviewDueDateIndependent1722920124000().down()).rejects.toThrow('不可安全降级');
  });
});
