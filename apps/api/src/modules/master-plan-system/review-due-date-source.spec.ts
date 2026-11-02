import ExcelJS from 'exceljs';
import { analyzeReviewDueSourceWorkbook, parseReviewDueSourceDate } from './review-due-date-source';

const headers = ['序号','业务员','项目','订 单 号','下单时间','交期','事业部评审交期','图    号','品   名','订单数量','未完成量','生产单位'];
async function workbook(rows: unknown[][]) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('在手未完成订单明细');
  sheet.addRow(headers); for (const row of rows) sheet.addRow(row);
  return Buffer.from(await book.xlsx.writeBuffer());
}
const row = (order: string, item: string, quantity: number, due: unknown, latest: unknown, division = '一部', name = '品项') => {
  const result = Array(12).fill(null); result[3] = order; result[5] = due; result[6] = latest; result[7] = item; result[8] = name; result[9] = quantity; result[11] = division; return result;
}

describe('review due-date Excel source adapter', () => {
  it('converts Excel dates, serials, full-year text and yearless dates', () => {
    expect(parseReviewDueSourceDate(new Date('2026-11-07T00:00:00Z'))).toBe('2026-11-07');
    expect(parseReviewDueSourceDate(46333)).toBe('2026-11-07');
    expect(parseReviewDueSourceDate('2026/11/7')).toBe('2026-11-07');
    expect(parseReviewDueSourceDate('11/7')).toBe('2026-11-07');
    expect(parseReviewDueSourceDate('25年订单')).toBeNull();
    expect(parseReviewDueSourceDate('2026/02/30')).toBeNull();
  });
  it('collapses identical duplicate quantities, keeps source rows, selects earliest delivery and maps supply chain to procurement', async () => {
    const input = await workbook([
      row('O-1', 'I-1', 10, new Date('2026-11-20T00:00:00Z'), '11/7'),
      row('O-1', 'I-1', 10, new Date('2026-11-15T00:00:00Z'), '11/7'),
      row('O-2', 'I-2', 2, '2026/11/7', '待确认', '供应链')
    ]);
    const result = await analyzeReviewDueSourceWorkbook(input, 'test-source-adapter');
    expect(result).toMatchObject({ sourceRows: 3, conflicts: [], invalidRows: [], latestDueDateNulls: 1 });
    expect(result.records).toEqual([
      expect.objectContaining({ sourceRows: [2, 3], orderNumber: 'O-1', batchNumber: '01', drawingNumber: 'I-1', quantity: '10', dueDate: '2026-11-15', latestDueDate: '2026-11-07', changeCount: 0, previousInboundDate: null }),
      expect.objectContaining({ sourceRows: [4], orderNumber: 'O-2', batchNumber: '01', divisionName: '凯南 / 计划中心 / 采购部', dueDate: '2026-11-07', latestDueDate: null })
    ]);
  });
  it('splits quantity and latest-date variants into stable source-order batches without summing', async () => {
    const input = await workbook([
      row('O-1', 'I-1', 175, '11/19', '11/19'),
      row('O-1', 'I-1', 910, '11/19', '11/19'),
      row('O-2', 'I-2', 11041, '11/27', '11/20'),
      row('O-2', 'I-2', 11041, '11/27', '11/27')
    ]);
    const result = await analyzeReviewDueSourceWorkbook(input, 'test-source-conflicts');
    expect(result.records.filter(r => r.orderNumber === 'O-1')).toEqual([
      expect.objectContaining({ batchNumber: '01', quantity: '175', sourceRows: [2] }),
      expect.objectContaining({ batchNumber: '02', quantity: '910', sourceRows: [3] })
    ]);
    expect(result.records.some(r => r.quantity === '1085')).toBe(false);
    expect(result.records.filter(r => r.orderNumber === 'O-2')).toEqual([
      expect.objectContaining({ batchNumber: '01', quantity: '11041', latestDueDate: '2026-11-20', sourceRows: [4] }),
      expect.objectContaining({ batchNumber: '02', quantity: '11041', latestDueDate: '2026-11-27', sourceRows: [5] })
    ]);
    expect(result.conflicts).toEqual([]);
  });
});
