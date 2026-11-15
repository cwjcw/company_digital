import { BadRequestException, Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import { mpsDivisionOrderProgressColumns } from "@kdos/contracts";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanDivisionOrderProgressService, mpsDivisionOrderProgressMaxExportRows } from "./master-plan.division-order-progress.service";
import type { MasterPlanActor } from "./master-plan.types";

const numericFields = new Set(["orderQuantity","weldingQuantity","blankQuantity","surfaceTreatmentQuantity","packagingQuantity","inboundQuantity"]);
const identifierFields = new Set(["customerCode","orderNumber","itemCode"]);

@Injectable()
export class MasterPlanDivisionOrderProgressExportService {
  constructor(private readonly report:MasterPlanDivisionOrderProgressService,private readonly application:MasterPlanApplicationService){}
  async export(input:Record<string,unknown>,actor:MasterPlanActor){
    this.report.assert(actor,"export");
    const first=await this.report.page("fourth",{...input,page:1,pageSize:500},actor,"export");
    if(first.total>mpsDivisionOrderProgressMaxExportRows)throw new BadRequestException("当前筛选结果超过单次Excel导出上限，请缩小筛选范围");
    const rows=[...first.rows];
    for(let page=2;page<=Math.ceil(first.total/500);page++) rows.push(...(await this.report.page("fourth",{...input,page,pageSize:500},actor,"export")).rows);
    const workbook=new ExcelJS.Workbook();workbook.creator="KDOS";workbook.subject="事业部订单生产进度报表";workbook.created=new Date();
    const sheet=workbook.addWorksheet("事业四部生产进度");sheet.views=[{state:"frozen",xSplit:4,ySplit:1}];
    sheet.columns=mpsDivisionOrderProgressColumns.map(([key,label])=>({header:label,key,width:Math.max(14,Math.min(28,label.length*2+6)),style:identifierFields.has(key)?{numFmt:"@"}:numericFields.has(key)?{numFmt:"0.0"}:key.toLowerCase().includes("date")||key==="reviewDueDate"?{numFmt:"yyyy-mm-dd"}:{}}));
    sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:mpsDivisionOrderProgressColumns.length}};
    for(const row of rows){
      const values:Record<string,unknown>={};
      for(const [key] of mpsDivisionOrderProgressColumns){
        const value=(row as unknown as Record<string,unknown>)[key];
        if(numericFields.has(key)&&value!=null){const decimal=new Decimal(String(value));const digits=decimal.isZero()?1:decimal.abs().toSignificantDigits().precision(true);values[key]=digits<=15?decimal.toNumber():decimal.toFixed(1);}
        else if((key==="orderDate"||key==="expectedShippingDate"||key==="reviewDueDate")&&value){const date=new Date(`${value}T00:00:00Z`);values[key]=Number.isNaN(date.getTime())?String(value):date;}
        else values[key]=identifierFields.has(key)&&value!=null?String(value):value??"";
      }
      const excelRow=sheet.addRow(values);
      for(const key of ["drawing","materialReady","cutting"]){if((row as unknown as Record<string,unknown>)[key]==="Y"){const cell=excelRow.getCell(mpsDivisionOrderProgressColumns.findIndex(([field])=>field===key)+1);cell.font={color:{argb:"FF237804"},bold:true};}}
      for(const key of ["weldingQuantity","blankQuantity","surfaceTreatmentQuantity","packagingQuantity","inboundQuantity"]){
        const complete=key==="weldingQuantity"?row.weldingComplete:key==="blankQuantity"?row.blankComplete:key==="surfaceTreatmentQuantity"?row.surfaceTreatmentComplete:key==="packagingQuantity"?row.packagingComplete:row.inboundComplete;
        if(complete===true){const cell=excelRow.getCell(mpsDivisionOrderProgressColumns.findIndex(([field])=>field===key)+1);cell.font={color:{argb:"FF237804"}};}
      }
    }
    sheet.getRow(1).font={bold:true,color:{argb:"FF1F1F1F"}};
    const buffer=Buffer.from(await workbook.xlsx.writeBuffer());
    await this.application.recordDivisionOrderProgressExport({rowCount:rows.length,fields:mpsDivisionOrderProgressColumns.map(([key])=>key)},actor);
    return {buffer,filename:`pmc_division_four_production_progress_${new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Shanghai"}).replaceAll("-","")}.xlsx`};
  }
}
