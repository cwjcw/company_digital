import { MpsExecutionFactProtection1722920119000 as Protection } from '../../migrations/1722920119000-MpsExecutionFactProtection';

describe('MPS119 additive execution guards',()=>{
  it('adds no columns/tables, rewrites no historical rows and preserves 107/108 lock functions',async()=>{
    const statements: string[]=[];
    await new Protection().up({query:async(s: string)=>{statements.push(s);}} as never);
    const sql=statements.join('\n');
    expect(sql).not.toMatch(/ALTER TABLE|CREATE TABLE|DROP |CREATE OR REPLACE FUNCTION mps_guard_weekly_process_config/i);
    expect(sql).not.toMatch(/UPDATE mps_process_reports|DELETE FROM mps_|INSERT INTO mps_/i);
    expect(sql).toContain('process_config_locked_at');
    expect(sql).toContain('mps_execution_parent_fence');
    expect(sql).toContain('order_link_stable=true');
    expect(sql).toContain("r.tenant_id=p.tenant_id");
    expect(sql).toContain("r->'drawing_refs','[]'::jsonb");
    expect(sql).toContain("ck_mps_report_context");
  });
  it('refuses destructive down that removes protection',async()=>{
    await expect(new Protection().down()).rejects.toThrow('Forward-only');
  });
});
