import { expect, it } from 'vitest';
import { mpsReviewApplicationMapping } from './master-plan-review-applications';
it('locks verified mapping; customer dueDate and real receipt are never substituted', () => { expect(mpsReviewApplicationMapping).toEqual({ source: 'inboundDate', target: 'latestReviewDueDate' }); });
