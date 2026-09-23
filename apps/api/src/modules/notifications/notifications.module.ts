import { Module } from "@nestjs/common";
import { NotificationInternalController } from "./notification.internal.controller";
import { NotificationInternalGuard } from "./notification.internal.guard";
import { NotificationService } from "./notification.service";

@Module({
  controllers: [NotificationInternalController],
  providers: [NotificationService, NotificationInternalGuard],
  exports: [NotificationService]
})
export class NotificationsModule {}
