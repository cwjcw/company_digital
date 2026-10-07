import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApiKey, User } from "../../entities";
import { AuthGuard } from "../../auth";
import { TableFilterModule } from "../../common/filtering/table-filter.module";
import { KnowledgeAccessService } from "./knowledge.scope";
import { KnowledgeApplicationService } from "./knowledge.application.service";
import { KnowledgeQueryService } from "./knowledge.query.service";
import { KnowledgeFilterSourceProvider } from "./knowledge.filter-sources";
import { KnowledgeController } from "./knowledge.controller";
@Module({ imports: [TypeOrmModule.forFeature([ApiKey, User]), TableFilterModule], controllers: [KnowledgeController], providers: [AuthGuard, KnowledgeAccessService, KnowledgeApplicationService, KnowledgeQueryService, KnowledgeFilterSourceProvider], exports: [KnowledgeQueryService, KnowledgeApplicationService] })
export class KnowledgeModule {}
