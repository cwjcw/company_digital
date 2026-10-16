import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import { mpsOrderProgressExportKeys, mpsOrderProgressOrderColumns, mpsOrderProgressItemExportColumns, type MpsOrderProgressExportKey } from "@kdos/contracts";
import { MasterPlanOrderProgressService, type OrderProgressQuery } from "./master-plan.order-progress.service";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import type { MasterPlanActor } from "./master-plan.types";

@Injectable()
export class MasterPlanOrderProgressExportService {
  constructor(private readonly progress:MasterPlanOrderProgressService,private readonly application:MasterPlanApplicationService){}
  async export(key:string,input:OrderProgressQuery,actor:MasterPlanActor) {
    this.progress.assert(actor);this.progress.assert(actor,"export");
    if(!mpsOrderProgressExportKeys.includes(key as MpsOrderProgressExportKey))throw new BadRequestException("导出类型无效");
    // Expansion IDs and pagination must never accidentally narrow a full filtered export.
    const {orderId:_order,itemId:_item,page:_page,pageSize:_size,...filters}=input;void _order;void _item;void _page;void _size;
    const data=await this.progress.page(filters,actor,key as MpsOrderProgressExportKey,"export",true);
    const definitions=key==="orders"?mpsOrderProgressOrderColumns:mpsOrderProgressItemExportColumns;
    const columns=definitions.filter(([k])=>data.visibleFields.includes(k));if(!columns.length)throw new ForbiddenException("没有可导出的字段");
    const book=new ExcelJS.Workbook(),sheet=book.addWorksheet(key==="orders"?"订单进度汇总":"品号生产进度明细");
    sheet.columns=columns.map(([key,header])=>({key,header,width:key==="exceptionSummary"?48:22}));sheet.views=[{state:"frozen",ySplit:1}];sheet.getRow(1).font={bold:true};sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:columns.length}};
    for(const [key]of columns)if(/Quantity$|Rate$|Progress$|Count$/.test(key))sheet.getColumn(key).numFmt=/Rate$|Progress$/.test(key)?"0.0%":"0.####";
    for(const row of data.rows)sheet.addRow(Object.fromEntries(columns.map(([k])=>{
      const value=k==="divisionId"?row.divisionName:row[k];if(value==null)return[k,null];
      if(!/Quantity$|Rate$|Progress$|Count$/.test(k))return[k,String(value)];
      const d=new Decimal(value);return[k,d.sd()<=15?d.toNumber():d.toFixed()];
    })));
    const buffer=Buffer.from(await book.xlsx.writeBuffer());
    await this.application.recordOrderProgressExport({tableKey:key,rowCount:data.rows.length,fields:columns.map(([k])=>k)},actor);
    return buffer;
  }
}
