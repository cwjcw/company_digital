import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Server, Socket } from "socket.io";
import { PlanningDomainEventBus } from "./modules/planning/domain-event-bus";

@WebSocketGateway({
  namespace: "/plans",
  cors: {
    origin: process.env.WEB_ORIGIN?.split(",") ?? ["http://localhost:5173"],
    credentials: true
  }
})
export class PlanGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private unsubscribe?: () => void;
  constructor(private readonly jwt: JwtService, private readonly events: PlanningDomainEventBus) {}

  onModuleInit() {
    this.unsubscribe = this.events.subscribe((event) => {
      // CLI application contexts (imports/maintenance) do not create a WebSocket server.
      // The business transaction must remain successful even when there is no live gateway.
      this.server?.to(`period:${event.periodId}`).emit("plan.changed", {
        entityId: event.entityId, version: event.version, changeType: event.changeType, event: event.name
      });
    });
  }
  onModuleDestroy() { this.unsubscribe?.(); }

  async handleConnection(client: Socket) {
    const token = String(client.handshake.auth?.token ?? "");
    try {
      const claims = await this.jwt.verifyAsync(token, { secret: process.env.JWT_ACCESS_SECRET ?? "change-me-access" });
      if (claims.type && claims.type !== "access") throw new Error("invalid token type");
      client.data.user = claims;
    } catch {
      client.emit("error", { message: "Unauthorized" });
      client.disconnect(true);
      return;
    }
    const period = String(client.handshake.auth?.period ?? "");
    if (period) client.join(`period:${period}`);
    const tenantCode = String(client.handshake.auth?.tenantCode ?? process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN");
    client.join(`tenant:${tenantCode}`);
  }
  broadcast(periodId: string, division: string | null, payload: unknown) {
    if (!this.server) return;
    const room = division ? this.server.to(`period:${periodId}`).to(`division:${division}`) : this.server.to(`period:${periodId}`);
    room.emit("plan.changed", payload);
  }
  broadcastTable(tenantCode: string, resource: string, changeType: "created" | "updated" | "deleted" | "batch") {
    this.server?.to(`tenant:${tenantCode}`).emit("table.changed", { resource, changeType });
  }
}
