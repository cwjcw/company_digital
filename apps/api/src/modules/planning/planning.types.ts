import type { PlanVersionStatus } from "@kdos/contracts";

export interface PlanningActor {
  tenantCode: string;
  userId: string | null;
  permissions: string[];
  roles: string[];
  requestId: string;
  traceId?: string;
  ip?: string;
  source: "WEB" | "API" | "IMPORT" | "TPLUS" | "SYSTEM" | "AI";
}

export interface PlanPeriodRecord {
  id: string; tenantId: string; year: number; month: number; status: string;
  currentVersionId: string | null; createdAt: Date; updatedAt: Date;
}

export interface PlanVersionRecord {
  id: string; tenantId: string; periodId: string; versionNumber: number; name: string;
  status: PlanVersionStatus; basedOnVersionId: string | null;
  publishedAt: Date | null; lockedAt: Date | null; createdAt: Date; updatedAt: Date;
}

export interface PlanItemRecord {
  id: string; tenantId: string; planVersionId: string; salesOrderLineId: string | null;
  orderNumber: string; itemNumber: string; customerCode: string | null; customerName: string | null;
  itemName: string | null; specification: string | null; orderQuantity: string;
  productionQuantity: string; historicalInboundQuantity: string; currentInboundQuantity: string;
  unitPrice: string; deliveryDate: string | null; responsibleOrgId: string | null;
  ownerUserId: string | null; priority: number; sequence: number; status: string;
  exception: string | null; remark: string | null; imageRefs: string[];
  legacyData: Record<string, unknown>; version: number; createdBy: string | null; createdAt: Date; updatedBy: string | null; updatedAt: Date;
}

export interface ProcessProgressRecord {
  id: string; planItemId: string; processDefinitionId: string; processCode: string; processName: string;
  requiredDays: string | null; plannedDate: string | null; actualDate: string | null;
  plannedQuantity: string | null; completedQuantity: string | null; status: string | null;
  exception: string | null; version: number;
}

export interface PlanItemView extends PlanItemRecord { processes: Record<string, Record<string, unknown>>; }

export interface CreatePlanItemInput {
  orderNumber: string; itemNumber: string; itemName?: string; customerName?: string;
  orderQuantity?: string | number; productionQuantity?: string | number; deliveryDate?: string;
  priority?: number; sequence?: number; responsibleOrgId?: string; ownerUserId?: string; remark?: string;
  legacyData?: Record<string, unknown>;
}

export interface PlanItemPatch { field: string; value: unknown; expectedVersion: number; }

export interface PlanEvent {
  name: "planning.plan_item.updated" | "planning.plan.reordered" | "planning.plan.published" | "planning.plan.locked" | "planning.plan.unlocked" | "planning.plan.imported";
  tenantId: string;
  periodId: string;
  versionId: string;
  entityId?: string;
  version?: number;
  changeType: string;
}
