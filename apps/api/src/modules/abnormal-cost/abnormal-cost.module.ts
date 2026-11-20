import { AbnormalOrderReader } from '../../integrations/abnormal-orders/abnormal-order.reader';
import { AbnormalOrderSyncService } from './abnormal-order-sync.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthGuard } from '../../auth';
import { ApiKey, User } from '../../entities';
import { TableFilterModule } from '../../common/filtering/table-filter.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationDirectoryModule } from '../organization-directory/organization-directory.module';
import { AbnormalCostApplicationService } from './abnormal-cost.application.service';
import { AbnormalCostController } from './abnormal-cost.controller';
import { AbnormalCostFilterSources } from './abnormal-cost.filter-sources';
import { AbnormalCostQueryService } from './abnormal-cost.query.service';
import { AbnormalCostGraphSpreadsheetService } from './abnormal-cost.graph-spreadsheet.service';
import { AbnormalCostSpreadsheetService } from './abnormal-cost.spreadsheet.service';
@Module({imports:[TypeOrmModule.forFeature([User,ApiKey]),TableFilterModule,NotificationsModule,OrganizationDirectoryModule],controllers:[AbnormalCostController],providers:[AbnormalOrderReader,AbnormalOrderSyncService,AuthGuard,AbnormalCostApplicationService,AbnormalCostQueryService,AbnormalCostFilterSources,AbnormalCostSpreadsheetService,AbnormalCostGraphSpreadsheetService]})
export class AbnormalCostModule {}
