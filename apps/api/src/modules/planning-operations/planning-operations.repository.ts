import type { PlanningActor } from "../planning/planning.types";

export const PLANNING_OPERATIONS_REPOSITORY = Symbol("PLANNING_OPERATIONS_REPOSITORY");
export interface PlanningOperationsRepository {
  tenantId(code: string): Promise<string>;
  listWeeklyPeriods(tenantId: string): Promise<unknown[]>;
  listWeeklyItems(tenantId: string, periodId: string, search?: string): Promise<unknown[]>;
  syncWeeklyItems(tenantId: string, periodId: string, actor: PlanningActor): Promise<{ synced: number }>;
  updateWeeklyDate(tenantId: string, id: string, field: "customer_due_date" | "review_due_date", value: string | null, expectedVersion: number, actor: PlanningActor): Promise<unknown>;
  listWorkReports(tenantId: string, date: string, search?: string): Promise<unknown[]>;
  syncWorkReports(tenantId: string, date: string, actor: PlanningActor): Promise<{ synced: number }>;
  updateReportedQuantity(tenantId: string, id: string, quantity: string, expectedVersion: number, actor: PlanningActor): Promise<unknown>;
}
