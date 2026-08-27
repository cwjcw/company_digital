import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";
import dataSource from "./data-source";
import { AuthGuard, AuthService } from "./auth";
import {
  AuditController, AuthController, ImportController, MasterDataController,
  PlanController, SystemController, ReferenceDataController, DirectoryController, ApiKeyController, AdminController
} from "./controllers";
import { DomainService } from "./domain.service";
import { entities } from "./entities";
import { ImportService } from "./import.service";
import { MonthlyRolloverService } from "./monthly-rollover.service";
import { PlanService } from "./plan.service";
import { StorageService } from "./storage.service";
import { TplusOrderSyncController } from "./data-operations/tplus/tplus-order-sync.controller";
import { TplusOrderSyncService } from "./data-operations/tplus/tplus-order-sync.service";
import { PlanningModule } from "./modules/planning/planning.module";
import { DevelopmentRequestModule } from "./modules/development-requests/development-request.module";
import { StorageModule } from "./storage/storage.module";
import { ApprovalFlowConfigModule } from "./modules/approval-flow-configs/approval-flow-config.module";
import { MarketingModule } from "./modules/marketing/marketing.module";
import { AdminQueryService } from "./modules/admin/admin-query.service";
import { AdminApplicationService } from "./modules/admin/admin-application.service";
import { TablePermissionGroupApplicationService } from "./modules/admin/table-permission-group.application.service";
import { PlanningOperationsModule } from "./modules/planning-operations/planning-operations.module";
import { ContactSyncModule } from "./modules/contact-sync/contact-sync.module";
import { CustomerImportModule } from "./data-operations/customer-import/customer-import.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../../.env", ".env"] }),
    TypeOrmModule.forRoot({ ...dataSource.options, autoLoadEntities: true }),
    TypeOrmModule.forFeature(entities),
    JwtModule.register({ global: true }),
    ScheduleModule.forRoot(),
    StorageModule,
    ApprovalFlowConfigModule,
    PlanningModule,
    MarketingModule,
    PlanningOperationsModule,
    DevelopmentRequestModule,
    ContactSyncModule,
    CustomerImportModule
  ],
  controllers: [
    SystemController, ReferenceDataController, DirectoryController, AuthController, PlanController, ImportController,
    MasterDataController, AuditController, ApiKeyController, AdminController,
    TplusOrderSyncController
  ],
  providers: [
    AuthService, AuthGuard, DomainService, PlanService, ImportService,
    MonthlyRolloverService, StorageService, TplusOrderSyncService, AdminQueryService, AdminApplicationService,
    TablePermissionGroupApplicationService
  ]
})
export class AppModule {}
