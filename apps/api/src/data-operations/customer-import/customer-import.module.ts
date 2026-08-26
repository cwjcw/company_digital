import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { PlanningModule } from "../../modules/planning/planning.module";
import { CustomerImportApplicationService } from "./customer-import.application.service";
import { CustomerImportController } from "./customer-import.controller";
import { KdosCustomerImportRepository } from "./kdos-customer-import.repository";
import { LegacyCustomerImportRepository } from "./legacy-customer-import.repository";
import { KDOS_CUSTOMER_IMPORT_REPOSITORY, LEGACY_CUSTOMER_IMPORT_REPOSITORY } from "./customer-import.types";

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User]), PlanningModule],
  controllers: [CustomerImportController],
  providers: [
    AuthGuard, CustomerImportApplicationService,
    { provide: LEGACY_CUSTOMER_IMPORT_REPOSITORY, useClass: LegacyCustomerImportRepository },
    { provide: KDOS_CUSTOMER_IMPORT_REPOSITORY, useClass: KdosCustomerImportRepository }
  ]
})
export class CustomerImportModule {}
