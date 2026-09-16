import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { OrganizationDirectoryModule } from "../../modules/organization-directory/organization-directory.module";
import { FieldCandidateService } from "./field-candidate.service";
import { TableFilterBootstrapCheck } from "./table-filter-bootstrap";
import { TableFilterController } from "./table-filter.controller";
import { TableFilterRegistry } from "./table-filter.registry";

/** KN-FILTER-001 平台筛选模块：所有正式业务表统一使用的 candidate/筛选入口。 */
@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User]), OrganizationDirectoryModule],
  controllers: [TableFilterController],
  providers: [AuthGuard, FieldCandidateService, TableFilterRegistry, TableFilterBootstrapCheck],
  exports: [FieldCandidateService, TableFilterRegistry]
})
export class TableFilterModule {}
