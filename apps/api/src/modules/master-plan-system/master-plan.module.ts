import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { MasterPlanApplicationService } from "./master-plan.application.service";
import { MasterPlanController } from "./master-plan.controller";
import { MasterPlanQueryService } from "./master-plan.query.service";
import { MasterPlanSpreadsheetService } from "./master-plan-spreadsheet.service";
import { MasterPlanSyncService } from "./master-plan.sync.service";
import { OrganizationDirectoryModule } from "../organization-directory/organization-directory.module";
import { FieldCandidateService } from "../../common/filtering/field-candidate.service";
import { TableFilterModule } from "../../common/filtering/table-filter.module";
import { MasterPlanFilterSourceProvider } from "./master-plan.filter-sources";

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User]), OrganizationDirectoryModule, TableFilterModule],
  controllers: [MasterPlanController],
  providers: [AuthGuard, MasterPlanApplicationService, MasterPlanQueryService, MasterPlanSyncService, MasterPlanSpreadsheetService, FieldCandidateService, MasterPlanFilterSourceProvider],
  exports: [MasterPlanApplicationService, MasterPlanQueryService, MasterPlanSyncService]
})
export class MasterPlanSystemModule {}
