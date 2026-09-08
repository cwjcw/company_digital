import { OrderScheduleImportService } from "./order-schedule-import.service";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, OrganizationUnit, User } from "../../entities";
import { PlanningModule } from "../planning/planning.module";
import { DrizzleMarketingRepository } from "./drizzle-marketing.repository";
import { MarketingApplicationService } from "./marketing.application.service";
import { MarketingController } from "./marketing.controller";
import { MarketingDirectoryQueryService } from "./marketing-directory-query.service";
import { MarketingImportService } from "./marketing-import.service";
import { MARKETING_REPOSITORY } from "./marketing.repository";

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User, OrganizationUnit]), PlanningModule],
  controllers: [MarketingController],
  providers: [OrderScheduleImportService, AuthGuard, MarketingApplicationService, MarketingDirectoryQueryService, MarketingImportService, { provide: MARKETING_REPOSITORY, useClass: DrizzleMarketingRepository }]
})
export class MarketingModule {}
