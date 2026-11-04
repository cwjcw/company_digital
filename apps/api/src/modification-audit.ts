import { AsyncLocalStorage } from "node:async_hooks";
import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from "@nestjs/common";
import { EventSubscriber, EntitySubscriberInterface, InsertEvent, UpdateEvent } from "typeorm";
import { Observable } from "rxjs";

type ModificationContext = { actor: string; actorId: string | null; requestId: string; source: string };

const protectedSystemFields = new Set([
  "createdBy", "createdAt", "updatedBy", "updatedAt", "created_by", "created_at", "updated_by", "updated_at",
  "创建人", "创建时间", "更新人", "更新时间"
]);

const auditColumnWidthsMetadata = "kdos:audit-column-width-preferences";
/** Only preference commands may carry audit field names as numeric column widths. */
export const AuditColumnWidthPreferences = () => SetMetadata(auditColumnWidthsMetadata, true);

function protectedFieldIn(value: unknown, allowColumnWidths = false, path: string[] = []): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const entry of value) { const found = protectedFieldIn(entry, allowColumnWidths, [...path, "[]"]); if (found) return found; }
    return null;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const columnWidth = allowColumnWidths && path.length === 2 && path[0] === "config"
      && ["columnWidths", "widths"].includes(path[1]!) && typeof entry === "number" && Number.isFinite(entry);
    if (protectedSystemFields.has(key) && !columnWidth) return key;
    const found = protectedFieldIn(entry, allowColumnWidths, [...path, key]); if (found) return found;
  }
  return null;
}

function stableUuid(value: unknown) {
  const text = String(value ?? "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

export const modificationContext = new AsyncLocalStorage<ModificationContext>();

export function currentModificationActor() {
  return modificationContext.getStore()?.actor || "system";
}

export function currentModificationActorId() { return modificationContext.getStore()?.actorId ?? null; }

@Injectable()
export class ModificationContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ method?: string; body?: unknown; requestId?: string; user?: { sub?: string; actorName?: string; username?: string; apiKeyId?: string } }>();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(String(request.method ?? "").toUpperCase())) {
      const protectedField = protectedFieldIn(request.body, Reflect.getMetadata(auditColumnWidthsMetadata, context.getHandler()) === true);
      if (protectedField) throw new BadRequestException(`系统审计字段不可由客户端赋值：${protectedField}`);
    }
    const currentActor = request.user?.actorName?.trim() || request.user?.username?.trim() || "system";
    const store: ModificationContext = {
      actor: currentActor,
      actorId: stableUuid(request.user?.sub),
      requestId: String(request.requestId ?? "system"),
      source: request.user?.apiKeyId ? "api" : "web"
    };
    return new Observable((subscriber) => modificationContext.run(store, () => next.handle().subscribe(subscriber)));
  }
}

@EventSubscriber()
export class ModificationAuditSubscriber implements EntitySubscriberInterface {
  beforeInsert(event: InsertEvent<Record<string, unknown>>) {
    const actorId = currentModificationActorId();
    const actorReference = actorId ?? currentModificationActor();
    const createdAt = new Date();
    if (event.entity && event.metadata.findColumnWithPropertyName("updatedBy")) event.entity.updatedBy = actorReference;
    if (event.entity && event.metadata.findColumnWithPropertyName("createdBy")) event.entity.createdBy = actorId;
    if (event.entity && event.metadata.findColumnWithPropertyName("createdAt")) event.entity.createdAt = createdAt;
    if (event.entity && event.metadata.findColumnWithPropertyName("updatedAt")) event.entity.updatedAt = createdAt;
  }

  beforeUpdate(event: UpdateEvent<Record<string, unknown>>) {
    const actorId = currentModificationActorId();
    if (event.entity && event.metadata.findColumnWithPropertyName("updatedBy")) event.entity.updatedBy = actorId ?? currentModificationActor();
  }
}
