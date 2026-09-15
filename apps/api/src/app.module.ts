import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";
import dataSource from "./data-source";
import { AuthGuard, AuthService } from "./auth";
import {
  AuditController, AuthController, MasterDataController,
  PlanController, SystemController, ReferenceDataController, DirectoryController, ApiKeyController, AdminController
} from "./controllers";
import { entities } from "./entities";
import { ImportService } from "./import.service";
import { SalesDashboardService } from "./sales-dashboard.service";
import { TplusOrderSyncController } from "./data-operations/tplus/tplus-order-sync.controller";
import { TplusOrderSyncService } from "./data-operations/tplus/tplus-order-sync.service";
import { DevelopmentRequestModule } from "./modules/development-requests/development-request.module";
import { StorageModule } from "./storage/storage.module";
import { ApprovalFlowConfigModule } from "./modules/approval-flow-configs/approval-flow-config.module";
import { MarketingModule } from "./modules/marketing/marketing.module";
import { AdminQueryService } from "./modules/admin/admin-query.service";
import { AdminApplicationService } from "./modules/admin/admin-application.service";
import { TablePermissionGroupApplicationService } from "./modules/admin/table-permission-group.application.service";
import { ContactSyncModule } from "./modules/contact-sync/contact-sync.module";
import { CustomerImportModule } from "./data-operations/customer-import/customer-import.module";
import { MailService } from "./mail.service";
import { HrModule } from "./modules/hr/hr.module";
import { AdministratorGrantApplicationService } from "./modules/admin/administrator-grant.application.service";
import { OrderSyncModule } from "./data-operations/order-sync/order-sync.module";
import { MasterDataQueryService } from "./modules/master-data/master-data-query.service";
import { EquipmentModule } from "./modules/equipment/equipment.module";
import { AuditQueryService } from "./modules/audit/audit-query.service";
import { SupplyChainModule } from "./modules/supply-chain/supply-chain.module";
import { MasterPlanSystemModule } from "./modules/master-plan-system/master-plan.module";
import { OrganizationDirectoryModule } from "./modules/organization-directory/organization-directory.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../../.env", ".env"] }),
    TypeOrmModule.forRoot({ ...dataSource.options, autoLoadEntities: true }),
    TypeOrmModule.forFeature(entities),
    JwtModule.register({ global: true }),
    ScheduleModule.forRoot(),
    StorageModule,
    ApprovalFlowConfigModule,
    MarketingModule,
    OrganizationDirectoryModule,
    DevelopmentRequestModule,
    ContactSyncModule,
    CustomerImportModule,
    HrModule,
    EquipmentModule,
    OrderSyncModule,
    SupplyChainModule,
    MasterPlanSystemModule
  ],
  controllers: [
    SystemController, ReferenceDataController, DirectoryController, AuthController, PlanController,
    MasterDataController, AuditController, ApiKeyController, AdminController,
    TplusOrderSyncController
  ],
  providers: [
    AuthService, AuthGuard, SalesDashboardService, ImportService,
    TplusOrderSyncService, AdminQueryService, AdminApplicationService,
    TablePermissionGroupApplicationService, AdministratorGrantApplicationService, MailService, MasterDataQueryService, AuditQueryService
  ]
})
export class AppModule {}
