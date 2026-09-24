import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { TableFilterModule } from "../../common/filtering/table-filter.module";
import { SupervisionApplicationService } from "./supervision.application.service";
import { SupervisionController } from "./supervision.controller";
import { SupervisionFilterSourceProvider } from "./supervision.filter-sources";
import { SupervisionQueryService } from "./supervision.query.service";
import { OrganizationDirectoryModule } from "../organization-directory/organization-directory.module";

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User]), TableFilterModule, OrganizationDirectoryModule],
  controllers: [SupervisionController],
  providers: [AuthGuard, SupervisionApplicationService, SupervisionQueryService, SupervisionFilterSourceProvider],
  exports: [SupervisionApplicationService, SupervisionQueryService]
})
export class SupervisionModule {}
