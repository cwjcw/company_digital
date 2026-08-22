import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { PlanningModule } from "../planning/planning.module";
import { DrizzlePlanningOperationsRepository } from "./drizzle-planning-operations.repository";
import { PlanningOperationsApplicationService } from "./planning-operations.application.service";
import { PlanningOperationsController } from "./planning-operations.controller";
import { PLANNING_OPERATIONS_REPOSITORY } from "./planning-operations.repository";
@Module({imports:[TypeOrmModule.forFeature([ApiKey,User]),PlanningModule],controllers:[PlanningOperationsController],providers:[AuthGuard,PlanningOperationsApplicationService,{provide:PLANNING_OPERATIONS_REPOSITORY,useClass:DrizzlePlanningOperationsRepository}]})
export class PlanningOperationsModule {}
