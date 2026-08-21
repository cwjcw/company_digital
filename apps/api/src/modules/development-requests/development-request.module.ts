import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthGuard } from "../../auth";
import { ApiKey, Contact, DevelopmentRequest, DevelopmentRequestEvent, User } from "../../entities";
import { DevelopmentRequestController } from "./development-request.controller";
import { DevelopmentRequestService } from "./development-request.service";

@Module({
  imports: [TypeOrmModule.forFeature([DevelopmentRequest, DevelopmentRequestEvent, User, Contact, ApiKey])],
  controllers: [DevelopmentRequestController],
  providers: [AuthGuard, DevelopmentRequestService]
})
export class DevelopmentRequestModule {}
