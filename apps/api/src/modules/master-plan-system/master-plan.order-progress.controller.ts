import { Controller, Get, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { mpsOrderProgressResource, tablePermissionFieldsFor } from "@kdos/contracts";
import { AuthGuard } from "../../auth";
import { MasterPlanOrderProgressService, type OrderProgressQuery } from "./master-plan.order-progress.service";
import { MasterPlanOrderProgressExportService } from "./master-plan.order-progress-export.service";
import { hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";

@Controller("master-plan-system/order-progress")
@UseGuards(AuthGuard)
export class MasterPlanOrderProgressController {
  constructor(private readonly progress:MasterPlanOrderProgressService,private readonly exports:MasterPlanOrderProgressExportService){}
  @Get("meta") metadata(@Req()req:Request){const actor=this.actor(req);this.progress.assert(actor);return {visibleFields:tablePermissionFieldsFor(mpsOrderProgressResource).filter(f=>this.progress.allowed(actor,f.key)).map(f=>f.key),canExport:hasMasterPlanPermission(actor,mpsOrderProgressResource,"export")};}
  @Get("orders") orders(@Query()q:OrderProgressQuery,@Req()req:Request){return this.progress.page(q,this.actor(req),"orders");}
  @Get("items") items(@Query()q:OrderProgressQuery,@Req()req:Request){return this.progress.page(q,this.actor(req),"items");}
  @Get("candidates") candidates(@Query("field")field:string,@Query("search")search:string,@Query()q:OrderProgressQuery,@Req()req:Request){return this.progress.candidates(field,search,q,this.actor(req));}
  @Get("detail/:resourceCode") detail(@Param("resourceCode")code:string,@Query()q:OrderProgressQuery,@Req()req:Request){return this.progress.detail(code,q,this.actor(req));}
  @Get("export/:key") async export(@Param("key")key:string,@Query()q:OrderProgressQuery,@Req()req:Request,@Res()res:Response){
    const buffer=await this.exports.export(key,q,this.actor(req));res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");res.setHeader("Content-Disposition",`attachment; filename="mps_${key==="orders"?"order":"item"}_progress_${new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Shanghai"}).replaceAll("-","")}.xlsx"`);res.send(buffer);
  }
  private actor(req:Request):MasterPlanActor {
    const r=req as Request&{user:{sub?:string;username?:string;displayName?:string;permissions?:string[];isSystemAdmin?:boolean;moduleAdminCodes?:string[];tableDataScopes?:MasterPlanActor["tableDataScopes"];apiKeyId?:string};requestId:string};const u=r.user;
    return {tenantId:process.env.KDOS_DEFAULT_TENANT_CODE??"KAINAN",userId:u?.sub??null,username:u?.displayName??u?.username??"unknown",permissions:u?.permissions??[],isSystemAdmin:u?.isSystemAdmin,moduleAdminCodes:u?.moduleAdminCodes,tableDataScopes:u?.tableDataScopes??[],requestId:r.requestId,source:u?.apiKeyId?"system":"web"};
  }
}
