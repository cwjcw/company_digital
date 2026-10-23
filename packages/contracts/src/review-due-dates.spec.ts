import { describe,it,expect } from 'vitest';
import { reviewDueDateFields,reviewDueDateCreateFields,reviewDueDateRequiredCreateKeys,reviewDueDateExportFilename,reviewDueDateTemplateNotes } from './review-due-dates';
describe('Review due dates canonical fields',()=>{
  it('registers nine business columns followed by four readonly audit fields',()=>{expect(reviewDueDateFields.map(f=>f.label)).toEqual(['事业部','订单号','批次号','品项编码','品项名称','入库时间','数量','交期变更次数','上次入库时间','创建人','创建时间','更新人','更新时间']);expect(reviewDueDateFields.slice(0,9).every(f=>f.editable)).toBe(true);expect(reviewDueDateFields.slice(9).every(f=>f.editable===false)).toBe(true)});
  it('offers nine create fields and six required without system identities',()=>{expect(reviewDueDateCreateFields.map(f=>f.key)).toEqual(['divisionId','orderNumber','batchNumber','drawingNumber','inspectionTimeName','inboundDate','quantity','changeCount','previousInboundDate']);expect(reviewDueDateRequiredCreateKeys).toEqual(['divisionId','orderNumber','batchNumber','drawingNumber','inboundDate','quantity']);});
  it('documents paired ID/version, explicit optional clearing and manual counts',()=>{const notes=reviewDueDateTemplateNotes.join(' ');expect(notes).toContain('同时留空');expect(notes).toContain('[清空]');expect(notes).toContain('不会自动改变');expect(notes).toContain('旧六列文件缺少事业部');});
  it('uses the Shanghai export date across UTC day boundaries',()=>expect(reviewDueDateExportFilename(new Date('2026-10-21T16:01:00Z'))).toBe('mps_review_due_dates_20261022.xlsx'));
});
