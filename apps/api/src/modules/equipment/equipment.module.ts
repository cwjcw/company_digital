import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { EquipmentController } from "./equipment.controller";
import { EquipmentApplicationService } from "./equipment.application.service";
import { EquipmentExportService } from "./equipment-export.service";
import { EquipmentImportService } from "./equipment-import.service";
import { EquipmentQueryService } from "./equipment.query.service";
import { EquipmentFilterSourceProvider } from "./equipment.filter-sources";
import { TableFilterModule } from "../../common/filtering/table-filter.module";

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User]), TableFilterModule],
  controllers: [EquipmentController],
  providers: [AuthGuard, EquipmentApplicationService, EquipmentQueryService, EquipmentImportService, EquipmentExportService, EquipmentFilterSourceProvider],
  exports: [EquipmentApplicationService, EquipmentQueryService]
})
export class EquipmentModule {}
