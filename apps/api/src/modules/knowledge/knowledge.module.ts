import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApiKey, User } from "../../entities";
import { AuthGuard } from "../../auth";
import { TableFilterModule } from "../../common/filtering/table-filter.module";
import { KnowledgeAuthorizationService } from "./knowledge.scope";
import { KnowledgeApplicationService } from "./knowledge.application.service";
import { KnowledgeQueryService } from "./knowledge.query.service";
import { KnowledgeFilterSourceProvider } from "./knowledge.filter-sources";
import { KnowledgeImportService } from "./knowledge.import.service";
import { KnowledgeExportService } from "./knowledge.export.service";
import { KnowledgeController } from "./knowledge.controller";
@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User]), TableFilterModule],
  controllers: [KnowledgeController],
  providers: [
    AuthGuard,
    KnowledgeAuthorizationService,
    KnowledgeApplicationService,
    KnowledgeQueryService,
    KnowledgeFilterSourceProvider,
    KnowledgeImportService,
    KnowledgeExportService,
  ],
  exports: [KnowledgeQueryService, KnowledgeApplicationService],
})
export class KnowledgeModule {}
