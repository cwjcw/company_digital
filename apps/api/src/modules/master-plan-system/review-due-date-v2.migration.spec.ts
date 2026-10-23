import { MpsReviewDueDateFieldsV21722920106000 } from '../../migrations/1722920106000-MpsReviewDueDateFieldsV2';
describe('review due V2 forward migration boundary',()=>{
  it('removes automatic count/date coupling while retaining history, identity, RLS and permission groups',async()=>{
    const query=jest.fn().mockResolvedValue([]);await new MpsReviewDueDateFieldsV21722920106000().up({query} as never);
    const sql=query.mock.calls.map(call=>call[0]).join('\n');
    expect(sql).toContain('source_division_id');expect(sql).toContain('UNIQUE(tenant_id,division_id,order_number,batch_number,drawing_number)');
    expect(sql).toContain('ALTER COLUMN change_count DROP NOT NULL');expect(sql).toContain('ALTER COLUMN change_count DROP DEFAULT');
    expect(sql).toContain('DROP TRIGGER trg_mps_review_due_count');expect(sql).toContain('DROP TRIGGER trg_mps_review_due_history_count');
    expect(sql).toContain('ALTER COLUMN updated_by TYPE uuid');expect(sql).toContain('FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE RESTRICT');
    expect(sql).toContain('无法可靠判断事业部');expect(sql).toContain('无法转换为稳定用户ID');
    expect(sql).not.toMatch(/DROP TABLE|DISABLE ROW LEVEL SECURITY|DROP POLICY|DROP TRIGGER trg_mps_review_due_immutable|DELETE FROM|INSERT INTO permissions|UPDATE roles|UPDATE permissions/);
    expect(sql).not.toContain('NEW.change_count<>OLD.change_count+1');
  });
  it('refuses destructive down conversion',async()=>{await expect(new MpsReviewDueDateFieldsV21722920106000().down()).rejects.toThrow('不可安全降级');});
});
