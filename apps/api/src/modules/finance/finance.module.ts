import { FinanceMovementReader } from '../../integrations/e10/finance-movement.reader';
import { FinanceMovementsApplicationService } from './finance-movements.application.service';
import { FinanceMovementsQueryService } from './finance-movements.query.service';
import { FinanceMovementsController } from './finance-movements.controller';
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
import { NotificationsModule } from '../notifications/notifications.module';
import { FinanceMonthlyNotificationService } from './finance-monthly-notification.service';
@Module({ imports: [TypeOrmModule.forFeature([ApiKey, User]), TableFilterModule, NotificationsModule], controllers: [FinanceMovementsController,FinanceController, FinanceOrdersController], providers: [FinanceMonthlyNotificationService,FinanceMovementReader,FinanceMovementsApplicationService,FinanceMovementsQueryService,FinanceOrderReader,FinanceOrdersApplicationService,FinanceOrdersQueryService,AuthGuard, FinanceRepository, FinanceApplicationService, FinanceQueryService, FinanceFilterSourceProvider] })
export class FinanceModule {
}
