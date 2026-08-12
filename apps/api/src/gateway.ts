import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { JwtService } from "@nestjs/jwt";
import { Server, Socket } from "socket.io";

@WebSocketGateway({
  namespace: "/plans",
  cors: {
    origin: process.env.WEB_ORIGIN?.split(",") ?? ["http://localhost:5173"],
    credentials: true
  }
})
export class PlanGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  constructor(private readonly jwt: JwtService) {}

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
  }
  broadcast(periodId: string, division: string | null, payload: unknown) {
    const room = division ? this.server.to(`period:${periodId}`).to(`division:${division}`) : this.server.to(`period:${periodId}`);
    room.emit("plan.changed", payload);
  }
}
