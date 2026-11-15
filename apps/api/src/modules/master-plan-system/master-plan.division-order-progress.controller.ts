import { Controller, Get, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthGuard } from "../../auth";
import { MasterPlanDivisionOrderProgressService } from "./master-plan.division-order-progress.service";
import { MasterPlanDivisionOrderProgressExportService } from "./master-plan.division-order-progress-export.service";
import type { MasterPlanActor } from "./master-plan.types";

@Controller("master-plan-system/division-order-progress")
@UseGuards(AuthGuard)
export class MasterPlanDivisionOrderProgressController {
  constructor(private readonly report:MasterPlanDivisionOrderProgressService,private readonly exporter:MasterPlanDivisionOrderProgressExportService){}
  @Get("fourth/meta") metadata(@Req()req:Request){return this.report.metadata(this.actor(req));}
  @Get("fourth") page(@Query()query:Record<string,unknown>,@Req()req:Request){return this.report.page("fourth",query,this.actor(req));}
  @Get("fourth/export") async export(@Query()query:Record<string,unknown>,@Req()req:Request,@Res()res:Response){
    const file=await this.exporter.export(query,this.actor(req));
    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",`attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  }
  private actor(req:Request):MasterPlanActor {
    const r=req as Request&{user:{sub?:string;username?:string;displayName?:string;permissions?:string[];isSystemAdmin?:boolean;moduleAdminCodes?:string[];tableDataScopes?:MasterPlanActor["tableDataScopes"];apiKeyId?:string};requestId:string};const u=r.user;
    return {tenantId:process.env.KDOS_DEFAULT_TENANT_CODE??"KAINAN",userId:u?.sub??null,username:u?.displayName??u?.username??"unknown",permissions:u?.permissions??[],isSystemAdmin:u?.isSystemAdmin,moduleAdminCodes:u?.moduleAdminCodes,tableDataScopes:u?.tableDataScopes??[],requestId:r.requestId,source:u?.apiKeyId?"system":"web"};
  }
}
