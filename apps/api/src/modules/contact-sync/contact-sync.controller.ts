import { Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AuthGuard } from "../../auth";
import { ContactSyncApplicationService } from "./contact-sync.application.service";
import type { WecomSyncPayload } from "./contact-sync.types";

type SyncRequest = Request & { user: { sub: string; displayName?: string; username: string; permissions?: string[]; apiKeyId?: string }; requestId: string };

function requireScope(request: SyncRequest, action: "read" | "import" | "export") {
  const permissions = request.user.permissions ?? [];
  if (permissions.includes("*") || permissions.includes(`contacts:*:${action}`)) return;
  throw new ForbiddenException(`API Key 缺少 contacts:*:${action} 权限`);
}

@ApiTags("企业微信通讯录同步")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("integrations/wecom/contacts")
export class ContactSyncController {
  constructor(private readonly service: ContactSyncApplicationService) {}

  @Get("snapshot")
  snapshot(@Req() request: SyncRequest) {
    requireScope(request, "export");
    return this.service.snapshot();
  }

  @Post("sync")
  sync(@Body() payload: WecomSyncPayload, @Query("dryRun") dryRun: string | undefined, @Req() request: SyncRequest) {
    requireScope(request, "import");
    return this.service.sync(payload, {
      userId: request.user.sub,
      name: request.user.displayName ?? request.user.username,
      requestId: request.requestId,
      source: request.user.apiKeyId ? "api" : "web"
    }, dryRun === "true");
  }
}
