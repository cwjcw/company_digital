import { describe, expect, it } from 'vitest';
import { abnormalJudgmentNavigationItem } from './abnormal-cost-navigation';

describe('abnormal responsibility judgment navigation', () => {
  it('exposes the independent table to authenticated members for assignment-scoped access', () => {
    expect(abnormalJudgmentNavigationItem({})).toBeNull();
    expect(abnormalJudgmentNavigationItem({ sub: 'reader' }))
      .toEqual({ key: '/workflow/abnormal-cost/judgments', label: '责任判定表' });
    expect(abnormalJudgmentNavigationItem({ sub: 'assigned-user' })).not.toBeNull();
    expect(abnormalJudgmentNavigationItem({})).toBeNull();
  });
});
