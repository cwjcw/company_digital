import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { SupplyChainApplicationService } from "./supply-chain.application.service";
import { SupplyChainController } from "./supply-chain.controller";
import { SupplyChainQueryService } from "./supply-chain.query.service";
import { SupplyChainFilterSourceProvider } from "./supply-chain.filter-sources";
import { TableFilterModule } from "../../common/filtering/table-filter.module";

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User]), TableFilterModule],
  controllers: [SupplyChainController],
  providers: [AuthGuard, SupplyChainApplicationService, SupplyChainQueryService, SupplyChainFilterSourceProvider],
  exports: [SupplyChainApplicationService, SupplyChainQueryService]
})
export class SupplyChainModule {}
