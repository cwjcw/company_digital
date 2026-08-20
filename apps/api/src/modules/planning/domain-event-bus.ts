import { EventEmitter } from "node:events";
import { Injectable } from "@nestjs/common";
import type { PlanEvent } from "./planning.types";

@Injectable()
export class PlanningDomainEventBus {
  private readonly emitter = new EventEmitter();
  publish(event: PlanEvent) { this.emitter.emit("planning", event); }
  subscribe(listener: (event: PlanEvent) => void) {
    this.emitter.on("planning", listener);
    return () => this.emitter.off("planning", listener);
  }
}
