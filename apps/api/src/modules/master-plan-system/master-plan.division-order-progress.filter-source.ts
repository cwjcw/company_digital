import { Injectable, type OnModuleInit } from "@nestjs/common";
import { mpsDivisionOrderProgressResource, tablePermissionFieldsFor } from "@kdos/contracts";
import { TableFilterRegistry, type TableFilterActor, type TableFilterSource, type TablePrintRowQuery } from "../../common/filtering/table-filter.registry";
import { MasterPlanDivisionOrderProgressService } from "./master-plan.division-order-progress.service";
import type { MasterPlanActor } from "./master-plan.types";

const allocationColumns = {
  id:"id",customerCode:"customer_code",orderNumber:"order_number",itemCode:"item_code",itemName:"item_name",
  orderDate:"order_date",expectedShippingDate:"expected_shipping_date",orderQuantity:"order_quantity",reviewDueDate:"latest_review_due_date",
  drawing:"drawing",materialReady:"material_ready",cutting:"cutting",weldingQuantity:"welding_quantity",blankQuantity:"blank_quantity",
  surfaceTreatmentQuantity:"surface_treatment_quantity",packagingQuantity:"packaging_quantity",inboundQuantity:"received_quantity"
};

@Injectable()
export class MasterPlanDivisionOrderProgressFilterSource implements OnModuleInit {
  constructor(private readonly registry:TableFilterRegistry,private readonly report:MasterPlanDivisionOrderProgressService){}

  onModuleInit(){
    const fields=tablePermissionFieldsFor(mpsDivisionOrderProgressResource);
    const listRows=async(query:TablePrintRowQuery)=>{
      const actor=this.actor(query.actor);
      const page=await this.report.page("fourth",{
        ...query.context,page:query.page,pageSize:query.pageSize,search:query.search,
        filterGroup:query.filterGroup,sortField:query.sortField,sortOrder:query.sortOrder,ids:query.ids
      },actor,query.action==="export"?"export":"read");
      return {rows:page.rows as Array<Record<string,unknown>>,total:page.total};
    };
    const source:TableFilterSource={
      code:mpsDivisionOrderProgressResource,
      table:"mps_order_allocations",
      columns:allocationColumns,
      fields,
      exportFilename:()=>"pmc_division_four_production_progress.xlsx",
      exportMaxRows:50000,
      exportNullAsBlank:true,
      exportExactNumbers:true,
      searchColumns:["customerCode","orderNumber","itemCode","itemName"],
      authorize:actor=>this.report.assert(this.actor(actor)),
      buildScope:(actor,params,action)=>this.report.filterCandidateScope(actor,params,action==="export"?"export":"read"),
      fieldReadPermission:(actor,key)=>this.report.canReadFilterField(actor,key),
      listRows,
      printRows:listRows
    };
    this.registry.register(source);
  }

  private actor(actor:TableFilterActor):MasterPlanActor{
    return {tenantId:actor.tenantId,userId:actor.userId,username:actor.username??"",permissions:actor.permissions,
      isSystemAdmin:actor.isSystemAdmin,moduleAdminCodes:actor.moduleAdminCodes,tableDataScopes:actor.tableDataScopes??[],requestId:"",source:"system"};
  }
}
