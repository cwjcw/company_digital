import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, ApprovalFlowConfig, Role, User } from "../../entities";
import { ApprovalFlowConfigController } from "./approval-flow-config.controller";
import { ApprovalFlowConfigService } from "./approval-flow-config.service";

@Module({
  imports: [TypeOrmModule.forFeature([ApprovalFlowConfig, Role, ApiKey, User])],
  controllers: [ApprovalFlowConfigController],
  providers: [AuthGuard, ApprovalFlowConfigService],
  exports: [ApprovalFlowConfigService]
})
export class ApprovalFlowConfigModule {}
