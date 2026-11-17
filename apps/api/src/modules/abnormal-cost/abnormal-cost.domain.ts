import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import ExcelJS from 'exceljs';
import { abnormalPersonnelLevels, abnormalPersonnelOptions } from '@kdos/contracts';
import { v7 as uuidv7 } from 'uuid';
import { assertSpreadsheetNotEncrypted } from '../../spreadsheet-upload';
import type { CostRow } from './abnormal-cost.policy';

export const costUuid = (raw: unknown, label='记录ID'): string => {
  if(typeof raw!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw))throw new BadRequestException(`${label}无效`);
  return raw.toLowerCase();
};
export function costText(raw: unknown,label: string,max=4000,required=false,preserve=false):string|null {
  if(raw==null||raw===''){if(required)throw new BadRequestException(`${label}不能为空`);return null;}
  if(typeof raw!=='string'||raw.length>max||(required&&!raw.trim()))throw new BadRequestException(`${label}无效或超长`);
  return preserve?raw:raw.trim();
}
export function costDecimal(raw:unknown,label:string,scale=2,max='9999999999999999.99',positive=false,allowNegative=false) {
  let value:Decimal;
  try { if(!['string','number'].includes(typeof raw)||String(raw).trim()==='')throw Error();value=new Decimal(String(raw)); } catch { throw new BadRequestException(`${label}必须是有效数字`); }
  if(!value.isFinite()||value.decimalPlaces()>scale||value.abs().gt(max))throw new BadRequestException(`${label}超出范围或小数位数`);
  if(positive?value.lte(0):!allowNegative&&value.lt(0))throw new BadRequestException(positive?'金额必须大于0':`${label}不能小于0`);
  return value.toFixed(scale);
}
export function normalizeAllocations(raw:unknown,adminId:string,complete:boolean):CostRow[] {
  if(!Array.isArray(raw)||raw.length>200)throw new BadRequestException('责任划分必须为最多200行的子表单');
  if(complete&&!raw.length)throw new BadRequestException('至少填写一条责任划分');
  const ids=new Set<string>();
  const rows=raw.map((input,index)=>{
    if(!input||typeof input!=='object'||Array.isArray(input))throw new BadRequestException(`第${index+1}行责任划分无效`);
    const allowed=['id','personnel_type','frontline_name','company_description','responsible_user_id','personnel_level','responsibility_ratio','adjusted_ratio','remark'];
    if(Object.keys(input).some(k=>!allowed.includes(k)))throw new BadRequestException('责任划分包含未知字段');
    const row:CostRow={id:input.id?costUuid(input.id):uuidv7()};
    if(ids.has(row.id))throw new BadRequestException('责任划分行ID重复');ids.add(row.id);
    row.personnel_type=costText(input.personnel_type,'人员类型',20,true);
    if(!abnormalPersonnelOptions.some(o=>o.value===row.personnel_type))throw new BadRequestException('人员类型无效');
    row.personnel_level=costText(input.personnel_level,'人员层级',20,true);
    if(!abnormalPersonnelLevels.some(o=>o.value===row.personnel_level))throw new BadRequestException('人员层级无效');
    row.frontline_name=row.personnel_type==='一线员工'?costText(input.frontline_name,'一线员工姓名',100,true):null;
    row.company_description=row.personnel_type==='公司'?costText(input.company_description===undefined?'公司':input.company_description,'公司说明',4000,false):null;
    row.responsible_user_id=row.personnel_type==='公司'?adminId:costUuid(input.responsible_user_id,'责任人员');
    row.remark=costText(input.remark,'备注',4000,row.personnel_type==='一线员工');
    row.responsibility_ratio=costDecimal(input.responsibility_ratio,'责任比例',1,'100');
    row.adjusted_ratio=costDecimal(input.adjusted_ratio===undefined?input.responsibility_ratio:input.adjusted_ratio,'申诉后责任比例',1,'100');
    return row;
  });
  if(complete&&!rows.reduce((sum,row)=>sum.plus(row.responsibility_ratio),new Decimal(0)).eq(100))throw new BadRequestException('责任比例合计应为100%');
  if(complete&&!rows.reduce((sum,row)=>sum.plus(row.adjusted_ratio),new Decimal(0)).eq(100))throw new BadRequestException('申诉后责任比例合计应为100%');
  return rows;
}
export const costDetailHeaders=['订单号','品号','品名','订单数量','异常数量','异常描述'];
export async function detailWorkbookTemplate() {
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('异常明细');
  sheet.columns=costDetailHeaders.map((name,i)=>({header:`${name}${i<5?'*':''}`,width:i===5?40:22}));
  sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true};
  const note=workbook.addWorksheet('填写说明');note.addRow(['*为必填；数量使用有效数字；异常描述允许为空；请勿改变表头。']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
export async function parseCostDetail(buffer:Buffer) {
  assertSpreadsheetNotEncrypted(buffer);
  const book=new ExcelJS.Workbook();try{await book.xlsx.load(buffer as never);}catch{throw new BadRequestException('文件不是有效的Excel .xlsx文件');}
  const sheet=book.getWorksheet('异常明细')??book.worksheets[0];if(!sheet)throw new BadRequestException('文件没有工作表');
  if(sheet.rowCount>5001)throw new BadRequestException('明细附件最多5000行');
  const headers:string[]=[];sheet.getRow(1).eachCell({includeEmpty:true},cell=>headers.push(cell.text.trim().replace(/[*＊]$/,'')));
  if(headers.length!==costDetailHeaders.length||headers.some((h,i)=>h!==costDetailHeaders[i]))throw new BadRequestException(`表头与规定模板不匹配，应为：${costDetailHeaders.join('、')}`);
  const rows:CostRow[]=[],errors:Array<{row:number;field:string;reason:string}>=[];
  sheet.eachRow((row,index)=>{
    if(index===1||!row.values||!costDetailHeaders.some((_,i)=>row.getCell(i+1).text.trim()))return;
    const values:CostRow={};
    costDetailHeaders.forEach((name,i)=>{
      const cell=row.getCell(i+1),raw=cell.type===ExcelJS.ValueType.Formula?cell.result:cell.value;
      if(raw==null||String(raw).trim()==='') {if(i<5)errors.push({row:index,field:name,reason:`未填必填项：第${index}行，字段${name}`});values[name]=null;return;}
      try {
        if(cell.type===ExcelJS.ValueType.Error||!['number','string'].includes(typeof raw))throw new BadRequestException('单元格类型无效，公式须有有效缓存结果');
        values[name]=i===3||i===4?costDecimal(raw,name,4,'99999999999999.9999',false,true):costText(String(raw),name,i===5?4000:200,i<5,true);
      }catch(error){errors.push({row:index,field:name,reason:(error as Error).message});}
    });rows.push(values);
  });
  if(!rows.length&&!errors.length)throw new BadRequestException('明细附件没有有效数据');
  if(errors.length)throw new BadRequestException({message:errors.map(e=>e.reason.startsWith('未填')?e.reason:`第${e.row}行，字段${e.field}：${e.reason}`).join('\n'),errors});
  return rows;
}
