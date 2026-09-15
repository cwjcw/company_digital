import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { createKdosDatabase } from "@kdos/database";
import { OrganizationUnit } from "../../entities";
import { PlanGateway } from "../../gateway";
import { KDOS_DATABASE } from "./kdos-database.provider";
import { OrganizationDirectoryService } from "./organization-directory.service";

@Module({
  imports: [TypeOrmModule.forFeature([OrganizationUnit])],
  providers: [OrganizationDirectoryService, PlanGateway, { provide: KDOS_DATABASE, useFactory: () => createKdosDatabase() }],
  exports: [OrganizationDirectoryService, PlanGateway, KDOS_DATABASE]
})
export class OrganizationDirectoryModule {}
