import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanController } from "./master-plan.controller";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { MasterPlanSpreadsheetService } from "./master-plan-spreadsheet.service";
import { MasterPlanSyncService } from "./master-plan.sync.service";
import { PlanningModule } from "../planning/planning.module";

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User]), PlanningModule],
  controllers: [MasterPlanController],
  providers: [AuthGuard, MasterPlanApplicationService, MasterPlanQueryService, MasterPlanSyncService, MasterPlanSpreadsheetService],
  exports: [MasterPlanApplicationService, MasterPlanQueryService, MasterPlanSyncService]
})
export class MasterPlanSystemModule {}
