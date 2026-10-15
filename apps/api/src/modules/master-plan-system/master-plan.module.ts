import { MasterPlanDashboardService } from "./master-plan.dashboard.service";
import { MasterPlanDashboardController } from "./master-plan.dashboard.controller";
import { MasterPlanDashboardExportService } from "./master-plan.dashboard-export.service";
import { OrderAllocationConfigService } from "./order-allocation-config.service";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanController } from "./master-plan.controller";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { MasterPlanSpreadsheetService } from "./master-plan-spreadsheet.service";
import { MasterPlanSyncService } from "./master-plan.sync.service";
import { MasterPlanWorkOrderService } from "./master-plan.work-order.service";
import { OrganizationDirectoryModule } from "../organization-directory/organization-directory.module";
import { TableFilterModule } from "../../common/filtering/table-filter.module";
import { MasterPlanFilterSourceProvider } from "./master-plan.filter-sources";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User]), OrganizationDirectoryModule, TableFilterModule, NotificationsModule],
  controllers: [MasterPlanController, MasterPlanDashboardController],
  providers: [MasterPlanDashboardService, MasterPlanDashboardExportService, OrderAllocationConfigService, AuthGuard, MasterPlanApplicationService, MasterPlanQueryService, MasterPlanSyncService, MasterPlanSpreadsheetService, MasterPlanWorkOrderService, MasterPlanFilterSourceProvider],
  exports: [MasterPlanApplicationService, MasterPlanQueryService, MasterPlanSyncService]
})
export class MasterPlanSystemModule {}
