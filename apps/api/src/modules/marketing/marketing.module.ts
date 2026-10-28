import { LogisticsQueryService } from "./logistics.query.service";
import { LogisticsController } from './logistics.controller';
import { LogisticsApplicationService } from './logistics.application.service';
import { LogisticsImportService } from './logistics-import.service';
import { LogisticsDirectoryQueryService } from './logistics-directory.query.service';
import { LogisticsFilterSourceProvider } from './logistics.filter-sources';
import { LOGISTICS_REPOSITORY } from './logistics.repository';
import { DrizzleLogisticsRepository } from './drizzle-logistics.repository';
import { OrderScheduleImportService } from "./order-schedule-import.service";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, OrganizationUnit, User } from "../../entities";
import { OrganizationDirectoryModule } from "../organization-directory/organization-directory.module";
import { DrizzleMarketingRepository } from "./drizzle-marketing.repository";
import { MarketingApplicationService } from "./marketing.application.service";
import { MarketingController } from "./marketing.controller";
import { MarketingDirectoryQueryService } from "./marketing-directory-query.service";
import { MarketingImportService } from "./marketing-import.service";
import { MARKETING_REPOSITORY } from "./marketing.repository";
import { MarketingFilterSourceProvider } from "./marketing.filter-sources";
import { TableFilterModule } from "../../common/filtering/table-filter.module";

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User, OrganizationUnit]), OrganizationDirectoryModule, TableFilterModule],
  controllers: [MarketingController, LogisticsController],
  providers: [LogisticsQueryService, LogisticsApplicationService, LogisticsImportService, LogisticsDirectoryQueryService, LogisticsFilterSourceProvider, { provide: LOGISTICS_REPOSITORY, useClass: DrizzleLogisticsRepository }, OrderScheduleImportService, AuthGuard, MarketingApplicationService, MarketingDirectoryQueryService, MarketingImportService, MarketingFilterSourceProvider, { provide: MARKETING_REPOSITORY, useClass: DrizzleMarketingRepository }]
})
export class MarketingModule {}
