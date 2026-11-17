import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { costDecimal, detailWorkbookTemplate, normalizeAllocations, parseCostDetail } from './abnormal-cost.domain';
describe('abnormal cost business rules',()=>{
  it('uses exact money and rejects zero, negatives and excess precision',()=>{expect(costDecimal('0.10','金额',2,undefined,true)).toBe('0.10');for(const value of [0,-1,'0.001','NaN'])expect(()=>costDecimal(value,'金额',2,undefined,true)).toThrow();});
  it('accepts decimal percentages summing exactly and applies the company/system-admin rule',()=>{const admin=randomUUID();const rows=normalizeAllocations(['33.3','33.3','33.4'].map(r=>({personnel_type:'公司',personnel_level:'经理',responsibility_ratio:r})),admin,true);expect(rows).toHaveLength(3);expect(rows[0]).toMatchObject({responsible_user_id:admin,company_description:'公司',frontline_name:null,adjusted_ratio:'33.3'});});
  it('requires frontline name and notification remark and rejects fractional expense percentages',()=>{expect(()=>normalizeAllocations([{personnel_type:'一线员工',personnel_level:'组长',responsible_user_id:randomUUID(),responsibility_ratio:100}],randomUUID(),true)).toThrow('一线员工姓名');expect(()=>costDecimal('60.1','承担费用比例',0,'100')).toThrow();});
  it('accepts the correct Excel template and reports all invalid rows rather than a partial success',async()=>{
    const book=new ExcelJS.Workbook();await book.xlsx.load(await detailWorkbookTemplate() as never);const sheet=book.worksheets[0];sheet.addRow(['SO','ITEM','品名',10,1,'']);expect(await parseCostDetail(Buffer.from(await book.xlsx.writeBuffer()))).toHaveLength(1);
    sheet.addRow(['SO','','品名','bad',1,'']);await expect(parseCostDetail(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow('未填必填项：第3行，字段品号');
  });
  it('rejects missing template columns and encrypted containers',async()=>{const book=new ExcelJS.Workbook();book.addWorksheet('异常明细').addRow(['订单号','品号']);await expect(parseCostDetail(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow('表头');await expect(parseCostDetail(Buffer.from([0x88,0x7d,0x1c,0xe4]))).rejects.toThrow('该文件被加密,请解密后再导入.');});
});
