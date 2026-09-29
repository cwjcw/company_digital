import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { RdApplicationService } from "./rd.application.service";
import { RdController, RdInternalController } from "./rd.controller";
import { RdE10Reader } from "./rd-e10-reader";
import { RdQueryService } from "./rd.query.service";

@Module({ imports: [TypeOrmModule.forFeature([ApiKey, User])], controllers: [RdController, RdInternalController], providers: [AuthGuard, RdApplicationService, RdE10Reader, RdQueryService], exports: [RdApplicationService, RdQueryService] })
export class RdModule {}
