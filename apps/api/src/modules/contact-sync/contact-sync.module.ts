import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApiKey, AuditLog, Contact, OrganizationUnit, RefreshToken, Role, RoleOrganizationScope, User, UserRole } from "../../entities";
import { ContactSyncApplicationService } from "./contact-sync.application.service";
import { ContactSyncController } from "./contact-sync.controller";

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, AuditLog, Contact, OrganizationUnit, RefreshToken, Role, RoleOrganizationScope, User, UserRole])],
  controllers: [ContactSyncController],
  providers: [ContactSyncApplicationService],
  exports: [ContactSyncApplicationService]
})
export class ContactSyncModule {}
