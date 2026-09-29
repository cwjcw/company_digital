import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { TableFilterModule } from "../../common/filtering/table-filter.module";
import { RdApplicationService } from "./rd.application.service";
import { RdController, RdInternalController } from "./rd.controller";
import { RdE10Reader } from "./rd-e10-reader";
import { RdQueryService } from "./rd.query.service";
import { RdFilterSourceProvider } from "./rd.filter-sources";
import { RdHistoryScanService } from "./rd-history-scan.service";

@Module({ imports: [TypeOrmModule.forFeature([ApiKey, User]), TableFilterModule], controllers: [RdController, RdInternalController], providers: [AuthGuard, RdApplicationService, RdHistoryScanService, RdE10Reader, RdQueryService, RdFilterSourceProvider], exports: [RdApplicationService, RdQueryService, RdHistoryScanService] })
export class RdModule {}
