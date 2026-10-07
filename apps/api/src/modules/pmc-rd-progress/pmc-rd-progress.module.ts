import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey, User } from '../../entities';
import { AuthGuard } from '../../auth';
import { TableFilterModule } from '../../common/filtering/table-filter.module';
import { PmcRdProgressReader } from '../../integrations/e10/pmc-rd-progress.reader';
import { PmcRdProgressCalculator } from './pmc-rd-progress.calculator';
import { PmcRdProgressApplicationService } from './pmc-rd-progress.application.service';
import { PmcRdProgressQueryService } from './pmc-rd-progress.query.service';
import { PmcRdProgressController, PmcRdProgressInternalController } from './pmc-rd-progress.controller';
import { PmcRdProgressFilterSources } from './pmc-rd-progress.filter-sources';
@Module({imports:[TypeOrmModule.forFeature([ApiKey,User]),TableFilterModule],controllers:[PmcRdProgressController,PmcRdProgressInternalController],providers:[AuthGuard,PmcRdProgressReader,PmcRdProgressCalculator,PmcRdProgressApplicationService,PmcRdProgressQueryService,PmcRdProgressFilterSources]})
export class PmcRdProgressModule {}
