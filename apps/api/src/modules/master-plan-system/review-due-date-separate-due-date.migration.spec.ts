import { MpsReviewDueDateSeparateDueDate1722920116000 } from '../../migrations/1722920116000-MpsReviewDueDateSeparateDueDate';

describe('separate review due-date migration', () => {
  it('adds the source delivery date and allows NULL for textual/blank latest review dates without touching history', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new MpsReviewDueDateSeparateDueDate1722920116000().up({ query } as never);
    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('ADD COLUMN due_date date');
    expect(sql).toContain('ALTER COLUMN inbound_date DROP NOT NULL');
    expect(sql).toContain("COMMENT ON COLUMN mps_review_due_dates.due_date IS 'Excel F列交期");
    expect(sql).not.toMatch(/DELETE FROM|DROP TABLE|TRUNCATE|mps_review_due_date_changes/);
  });
  it('refuses to drop the new field during rollback', async () => {
    await expect(new MpsReviewDueDateSeparateDueDate1722920116000().down()).rejects.toThrow('不删除该列');
  });
});
