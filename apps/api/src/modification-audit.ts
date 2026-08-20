import { AsyncLocalStorage } from "node:async_hooks";
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { EventSubscriber, EntitySubscriberInterface, InsertEvent, UpdateEvent } from "typeorm";
import { Observable } from "rxjs";

type ModificationContext = { actor: string };

export const modificationContext = new AsyncLocalStorage<ModificationContext>();

export function currentModificationActor() {
  return modificationContext.getStore()?.actor || "system";
}

@Injectable()
export class ModificationContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ user?: { actorName?: string; username?: string } }>();
    const currentActor = request.user?.actorName?.trim() || request.user?.username?.trim() || "system";
    return new Observable((subscriber) => modificationContext.run({ actor: currentActor }, () => next.handle().subscribe(subscriber)));
  }
}

@EventSubscriber()
export class ModificationAuditSubscriber implements EntitySubscriberInterface {
  beforeInsert(event: InsertEvent<Record<string, unknown>>) {
    if (event.entity && event.metadata.findColumnWithPropertyName("updatedBy")) event.entity.updatedBy = currentModificationActor();
  }

  beforeUpdate(event: UpdateEvent<Record<string, unknown>>) {
    if (event.entity && event.metadata.findColumnWithPropertyName("updatedBy")) event.entity.updatedBy = currentModificationActor();
  }
}
