import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { PlanningModule } from "../planning/planning.module";
import { DrizzleMarketingRepository } from "./drizzle-marketing.repository";
import { MarketingApplicationService } from "./marketing.application.service";
import { MarketingController } from "./marketing.controller";
import { MarketingImportService } from "./marketing-import.service";
import { MARKETING_REPOSITORY } from "./marketing.repository";

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User]), PlanningModule],
  controllers: [MarketingController],
  providers: [AuthGuard, MarketingApplicationService, MarketingImportService, { provide: MARKETING_REPOSITORY, useClass: DrizzleMarketingRepository }]
})
export class MarketingModule {}
