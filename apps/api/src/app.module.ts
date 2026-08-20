import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";
import dataSource from "./data-source";
import { AuthGuard, AuthService } from "./auth";
import {
  AuditController, AuthController, ImportController, MasterDataController,
  PlanController, SystemController, ApiKeyController, AdminController
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
import { StorageModule } from "./storage/storage.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../../.env", ".env"] }),
    TypeOrmModule.forRoot({ ...dataSource.options, autoLoadEntities: true }),
    TypeOrmModule.forFeature(entities),
    JwtModule.register({ global: true }),
    ScheduleModule.forRoot(),
    StorageModule,
    PlanningModule
  ],
  controllers: [
    SystemController, AuthController, PlanController, ImportController,
    MasterDataController, AuditController, ApiKeyController, AdminController,
    TplusOrderSyncController
  ],
  providers: [
    AuthService, AuthGuard, DomainService, PlanService, ImportService,
    MonthlyRolloverService, StorageService, TplusOrderSyncService
  ]
})
export class AppModule {}
