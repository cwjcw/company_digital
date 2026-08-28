import { Controller, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../../auth";
import { HrDepartureCheckApplicationService } from "./hr-departure-check.application.service";

type HrRequest = Request & { user: any; requestId: string };

@ApiTags("人力资源")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("hr")
export class HrController {
  constructor(private readonly application: HrDepartureCheckApplicationService) {}

  @Post("departure-check")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  check(@UploadedFile() file: Express.Multer.File, @Req() request: HrRequest) {
    return this.application.check(file, { userId: request.user?.sub ?? null, username: request.user?.displayName ?? request.user?.username ?? "unknown", permissions: request.user?.permissions ?? [], requestId: request.requestId });
  }
}
