import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, AuditLog, User } from "../../entities";
import { HrDepartureCheckApplicationService } from "./hr-departure-check.application.service";
import { HrController } from "./hr.controller";

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User, AuditLog])],
  controllers: [HrController],
  providers: [AuthGuard, HrDepartureCheckApplicationService]
})
export class HrModule {}
