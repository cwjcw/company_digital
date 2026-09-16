import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { OrderSyncApplicationService } from "./order-sync.application.service";
import { OrderSyncController } from "./order-sync.controller";
import { OrderSyncRepository } from "./order-sync.repository";
import { FormalProjectionRepository } from "./formal-projection.repository";

@Module({ imports:[TypeOrmModule.forFeature([ApiKey,User])],controllers: [OrderSyncController], providers: [AuthGuard,OrderSyncApplicationService,OrderSyncRepository,FormalProjectionRepository], exports: [OrderSyncApplicationService] })
export class OrderSyncModule {}
