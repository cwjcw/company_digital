import { PlmClient } from "../../integrations/plm/plm.client";
import { PlmSyncService } from "./plm-sync.service";
import { PlmProgressQueryService } from "./plm-progress.query.service";
import { PlmProgressExportService } from "./plm-progress.export.service";
import { PlmProgressController } from "./plm-progress.controller";
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
import { RdOrderBomReader } from "../../integrations/e10/rd-order-bom.reader";
import { RdOrderBomReportQueryService } from "./rd-order-bom-report.query.service";
import { RdBomMasterIndexSyncService } from "./rd-bom-master-index-sync.service";
import { TplusBomSyncService } from "./tplus-bom-sync.service";
import { UnifiedBomQueryService } from "./unified-bom.query.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({ imports: [TypeOrmModule.forFeature([ApiKey, User]), TableFilterModule, NotificationsModule], controllers: [PlmProgressController, RdController, RdInternalController], providers: [PlmClient, PlmSyncService, PlmProgressQueryService, PlmProgressExportService, AuthGuard, RdApplicationService, RdHistoryScanService, RdE10Reader, RdQueryService, RdFilterSourceProvider, RdOrderBomReader, RdBomMasterIndexSyncService, TplusBomSyncService, UnifiedBomQueryService, RdOrderBomReportQueryService], exports: [RdApplicationService, RdQueryService, RdHistoryScanService, RdBomMasterIndexSyncService, TplusBomSyncService, UnifiedBomQueryService, RdOrderBomReportQueryService] })
export class RdModule {}
