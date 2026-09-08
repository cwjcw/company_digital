import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { createKdosDatabase } from "@kdos/database";
import { AuthGuard } from "../../auth";
import { ApiKey, OrganizationUnit, User } from "../../entities";
import { PlanGateway } from "../../gateway";
import { PlanningDomainEventBus } from "./domain-event-bus";
import { DrizzlePlanningRepository, KDOS_DATABASE } from "./drizzle-planning.repository";
import { PlanningApplicationService } from "./planning.application.service";
import { PlanningController } from "./planning.controller";
import { PlanningDomainService } from "./planning-domain.service";
import { PlanQueryService } from "./planning.query.service";
import { PLANNING_REPOSITORY } from "./planning.repository";
import { PlanningImportService } from "./planning-import.service";
import { PlanningExportService } from "./planning-export.service";
import { PlanningImageService } from "./planning-image.service";
import { PlanningOrganizationDirectoryService } from "./planning-organization-directory.service";

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User, OrganizationUnit])],
  controllers: [PlanningController],
  providers: [
    AuthGuard, PlanningDomainEventBus, PlanningDomainService, PlanningApplicationService, PlanQueryService, PlanningImportService, PlanningExportService, PlanningImageService, PlanningOrganizationDirectoryService, PlanGateway,
    { provide: KDOS_DATABASE, useFactory: () => createKdosDatabase() },
    { provide: PLANNING_REPOSITORY, useClass: DrizzlePlanningRepository }
  ],
  exports: [PlanningApplicationService, PlanQueryService, PlanningOrganizationDirectoryService, PlanGateway, PlanningDomainEventBus, KDOS_DATABASE]
})
export class PlanningModule {}
