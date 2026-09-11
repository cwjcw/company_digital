import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { SupplyChainApplicationService } from "./supply-chain.application.service";
import { SupplyChainController } from "./supply-chain.controller";
import { SupplyChainQueryService } from "./supply-chain.query.service";

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User])],
  controllers: [SupplyChainController],
  providers: [AuthGuard, SupplyChainApplicationService, SupplyChainQueryService],
  exports: [SupplyChainApplicationService, SupplyChainQueryService]
})
export class SupplyChainModule {}
