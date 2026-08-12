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
import { PlanGateway } from "./gateway";
import { PlanService } from "./plan.service";
import { StorageService } from "./storage.service";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../../.env", ".env"] }),
    TypeOrmModule.forRoot({ ...dataSource.options, autoLoadEntities: true }),
    TypeOrmModule.forFeature(entities),
    JwtModule.register({ global: true }),
    ScheduleModule.forRoot()
  ],
  controllers: [
    SystemController, AuthController, PlanController, ImportController,
    MasterDataController, AuditController, ApiKeyController, AdminController
  ],
  providers: [
    AuthService, AuthGuard, DomainService, PlanService, ImportService,
    PlanGateway, MonthlyRolloverService, StorageService
  ]
})
export class AppModule {}
