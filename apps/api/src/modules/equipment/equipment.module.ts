import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { EquipmentController } from "./equipment.controller";
import { EquipmentApplicationService } from "./equipment.application.service";
import { EquipmentExportService } from "./equipment-export.service";
import { EquipmentImportService } from "./equipment-import.service";
import { EquipmentQueryService } from "./equipment.query.service";

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User])],
  controllers: [EquipmentController],
  providers: [AuthGuard, EquipmentApplicationService, EquipmentQueryService, EquipmentImportService, EquipmentExportService],
  exports: [EquipmentApplicationService, EquipmentQueryService]
})
export class EquipmentModule {}
