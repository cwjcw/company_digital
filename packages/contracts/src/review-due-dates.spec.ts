import { describe,it,expect } from 'vitest';
import { reviewDueDateFields,reviewDueDateExportFilename } from './review-due-dates';
describe('Review due dates canonical fields',()=>{
  it('registers the six original columns followed by four tracking columns',()=>{expect(reviewDueDateFields.map(f=>f.label)).toEqual(['订单号','批次号','试制计划图号','验货时间名称','入库时间','数量','交期变更次数','上次入库时间','最近变更时间','最近同步时间']);expect(reviewDueDateFields.slice(0,6).every(f=>f.editable)).toBe(true);expect(reviewDueDateFields.slice(6).every(f=>f.editable===false)).toBe(true)});
  it('uses the Shanghai export date across UTC day boundaries',()=>expect(reviewDueDateExportFilename(new Date('2026-10-21T16:01:00Z'))).toBe('mps_review_due_dates_20261022.xlsx'));
});
