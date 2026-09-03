import { PlanningDomainEventBus } from "./modules/planning/domain-event-bus";
import { PlanGateway } from "./gateway";

describe("PlanGateway", () => {
  it("does not turn a committed CLI import into an error when no websocket server exists", () => {
    const events = new PlanningDomainEventBus();
    const gateway = new PlanGateway({} as any, events);
    gateway.onModuleInit();
    expect(() => events.publish({
      name: "planning.plan.imported", tenantId: "tenant", periodId: "period", versionId: "version", changeType: "imported",
    })).not.toThrow();
    expect(() => gateway.broadcast("period", null, {})).not.toThrow();
    gateway.onModuleDestroy();
  });
});
