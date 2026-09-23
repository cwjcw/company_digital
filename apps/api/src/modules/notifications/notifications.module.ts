import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, User } from "../../entities";
import { NotificationInternalController } from "./notification.internal.controller";
import { NotificationInternalGuard } from "./notification.internal.guard";
import { NotificationService } from "./notification.service";
import { NotificationAdminController } from "./notification.admin.controller";
import { NotificationAdminService } from "./notification-admin.service";

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, User])],
  controllers: [NotificationInternalController, NotificationAdminController],
  providers: [AuthGuard, NotificationService, NotificationInternalGuard, NotificationAdminService],
  exports: [NotificationService]
})
export class NotificationsModule {}
