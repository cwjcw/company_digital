import { reviewDueDateFields, reviewDueDateCreateFields } from '@kdos/contracts';
import { reviewDueColumns, reviewDueExpression } from './review-due-date.query.service';

describe('independent review due-date resource', () => {
  it('uses local columns and has no monthly-plan expression', () => {
    expect(reviewDueColumns.orderDate).toBe('order_date');
    expect(reviewDueColumns.productReviewDueDate).toBe('customer_due_date');
    expect(reviewDueExpression(reviewDueColumns.orderDate)).toBe('record.order_date');
    expect(reviewDueExpression(reviewDueColumns.productReviewDueDate)).toBe('record.customer_due_date');
    const labels = reviewDueDateFields.map(field => field.label);
    expect(labels).not.toContain('产前评审交期');
    expect(labels).not.toContain('交期');
    expect(labels).not.toContain('交期变更次数');
    expect(labels).not.toContain('上次入库时间');
    expect(labels).toContain('最新交期');
    expect(reviewDueDateCreateFields.map(field => field.key)).toContain('productReviewDueDate');
    expect(reviewDueDateCreateFields.map(field => field.key)).toContain('orderDate');
  });
});
