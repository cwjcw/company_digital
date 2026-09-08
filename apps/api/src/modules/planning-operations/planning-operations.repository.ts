import type { PlanningActor } from "../planning/planning.types";

export const PLANNING_OPERATIONS_REPOSITORY = Symbol("PLANNING_OPERATIONS_REPOSITORY");

export interface WorkReportSyncResult {
  date: string;
  planPeriodId: string;
  planVersionId: string;
  sourceCount: number;
  matched: number;
  created: number;
  updated: number;
  unchanged: number;
  removedStale: number;
  preservedReported: number;
}

export interface OperationsPageInput { page: number; pageSize: number; search?: string; filters?: Record<string, string>; sortField?: string; sortOrder?: "asc" | "desc"; }
export interface OperationsPageResult { rows: unknown[]; total: number; page: number; pageSize: number; }

export interface PlanningOperationsRepository {
  tenantId(code: string): Promise<string>;
  listWeeklyPeriods(tenantId: string, currentDate: string): Promise<unknown[]>;
  listRollingPlanItems(tenantId: string): Promise<Array<Record<string, unknown>>>;
  listWeeklyItems(tenantId: string, periodId: string, input: OperationsPageInput): Promise<OperationsPageResult>;
  updateWeeklyDate(tenantId: string, id: string, field: "customer_due_date" | "review_due_date", value: string | null, expectedVersion: number, actor: PlanningActor): Promise<unknown>;
  listWorkReports(tenantId: string, date: string, input: OperationsPageInput): Promise<OperationsPageResult>;
  syncWorkReports(tenantId: string, date: string, actor: PlanningActor): Promise<WorkReportSyncResult>;
  updateReportedQuantity(tenantId: string, id: string, quantity: string, expectedVersion: number, actor: PlanningActor): Promise<unknown>;
}
