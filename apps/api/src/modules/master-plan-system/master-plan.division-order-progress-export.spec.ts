import ExcelJS from "exceljs";
import { mpsDivisionOrderProgressColumns } from "@kdos/contracts";
import { MasterPlanDivisionOrderProgressExportService } from "./master-plan.division-order-progress-export.service";
import type { MasterPlanActor } from "./master-plan.types";

const actor:MasterPlanActor={tenantId:"SYNTHETIC",userId:"u1",username:"test",permissions:["*"],tableDataScopes:[],requestId:"test",source:"web"};
const row={id:"allocation-id",customerCode:"0001",orderNumber:"0000123",itemCode:"0000456",itemName:"合成品项",orderDate:"2026-11-03",expectedShippingDate:"2026-11-05",orderQuantity:"1200.0000",reviewDueDate:"2026-11-01",drawing:"Y",materialReady:"N",cutting:"N",weldingQuantity:"1199.9600",blankQuantity:"800.0000",surfaceTreatmentQuantity:"1250.0000",packagingQuantity:"0",inboundQuantity:"-1.2500",productionStatus:"未完成",bomStatus:"HAS_BOM",weldingComplete:false,blankComplete:false,surfaceTreatmentComplete:true,packagingComplete:false,inboundComplete:false,inboundVerified:true};

describe("事业部订单生产进度Excel导出",()=>{
  it("exports the exact 17 columns including production status and audits the download",async()=>{
    const report={assert:jest.fn(),page:jest.fn(async()=>({rows:[row,{...row,id:"allocation-no-bom",drawing:"N",bomStatus:"NO_BOM"}],total:2,page:1,pageSize:500}))};
    const application={recordDivisionOrderProgressExport:jest.fn(async()=>undefined)};
    const service=new MasterPlanDivisionOrderProgressExportService(report as never,application as never);
    const file=await service.export({search:"0000123"},actor);
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(file.buffer as never);
    const sheet=workbook.getWorksheet("事业四部生产进度")!;
    expect(sheet.getRow(1).values).toEqual([undefined,...mpsDivisionOrderProgressColumns.map(([,label])=>label)]);
    expect(sheet.getCell("B2").value).toBe("0000123");expect(sheet.getCell("C2").value).toBe("0000456");
    expect((sheet.getCell("E2").value as Date).toISOString()).toBe("2026-11-03T00:00:00.000Z");
    expect((sheet.getCell("F2").value as Date).toISOString()).toBe("2026-11-05T00:00:00.000Z");
    expect(sheet.getCell("G2").numFmt).toBe("0.0");expect(sheet.getCell("L2").value).toBe(1199.96);
    expect(sheet.getCell("N2").font?.color).toMatchObject({argb:"FF237804"});
    expect(sheet.getCell("I2").value).toBe("Y");expect(sheet.getCell("I3").value).toBe("N");
    expect(sheet.getCell("Q2").value).toBe("未完成");
    expect(report.assert).toHaveBeenCalledWith(actor,"export");
    expect(report.page).toHaveBeenCalledWith("fourth",expect.objectContaining({search:"0000123",page:1,pageSize:500}),actor,"export");
    expect(application.recordDivisionOrderProgressExport).toHaveBeenCalledWith({rowCount:2,fields:mpsDivisionOrderProgressColumns.map(([key])=>key)},actor);
  });
});
