import { FinanceOrderReader } from '../../integrations/e10/finance-order.reader';
import { FinanceOrdersApplicationService } from './finance-orders.application.service';
import { FinanceOrdersQueryService } from './finance-orders.query.service';
import { FinanceOrdersController } from './finance-orders.controller';
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { TableFilterModule } from "../../common/filtering/table-filter.module";
import { FinanceRepository } from "./finance.repository";
import { FinanceApplicationService } from "./finance.application.service";
import { FinanceQueryService } from "./finance.query.service";
import { FinanceFilterSourceProvider } from "./finance.filter-sources";
import { FinanceController } from "./finance.controller";
@Module({ imports: [TypeOrmModule.forFeature([ApiKey, User]), TableFilterModule], controllers: [FinanceController, FinanceOrdersController], providers: [FinanceOrderReader,FinanceOrdersApplicationService,FinanceOrdersQueryService,AuthGuard, FinanceRepository, FinanceApplicationService, FinanceQueryService, FinanceFilterSourceProvider] })
export class FinanceModule {
}
