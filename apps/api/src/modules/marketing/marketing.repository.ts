import type { DivisionReviewConfirmResult, DivisionReviewConfirmRow, MappingDepartmentDirectorySyncResult, MappingDepartmentDirectorySyncTarget, MappingImportResult, MappingImportSummary, MarketingActor, OrderScheduleInput, ResolvedBusinessCustomerMappingInput, RollingPlanSyncFailure, RollingPlanSyncResult, RollingPlanSyncRow } from "./marketing.types";

export const MARKETING_REPOSITORY = Symbol("MARKETING_REPOSITORY");

export interface MarketingRepository {
  importSchedules(tenantId: string, rows: import("./marketing.types").ScheduleImportRow[], hash: string, actor: MarketingActor): Promise<{ imported: number; repeated: boolean }>;
  clearSchedules(tenantId: string, actor: MarketingActor): Promise<{ deleted: number }>;
  tenantId(code: string): Promise<string>;
  listMappings(tenantId: string, search?: string): Promise<unknown[]>;
  listSchedules(tenantId: string, search?: string): Promise<unknown[]>;
  listDivisionOrderReviews(tenantId: string, search?: string): Promise<unknown[]>;
  findDivisionOrderReviewsByIds(tenantId: string, ids: string[]): Promise<unknown[]>;
  findSchedulesByIds(tenantId: string, ids: string[]): Promise<unknown[]>;
  findRollingPlanItemsByBusinessKeys(tenantId: string, keys: Array<{ orderNumber: string; itemNumber: string }>): Promise<unknown[]>;
  saveMapping(tenantId: string, id: string | null, input: ResolvedBusinessCustomerMappingInput, expectedVersion: number | null, actor: MarketingActor): Promise<unknown>;
  replaceMappings(tenantId: string, rows: ResolvedBusinessCustomerMappingInput[], fileName: string, fileHash: string, summary: MappingImportSummary, actor: MarketingActor): Promise<MappingImportResult>;
  deleteMapping(tenantId: string, id: string, expectedVersion: number, actor: MarketingActor): Promise<void>;
  saveSchedule(tenantId: string, id: string | null, input: OrderScheduleInput, expectedVersion: number | null, actor: MarketingActor): Promise<unknown>;
  batchUpdateDueDate(tenantId: string, rows: Array<{ id: string; expectedVersion: number }>, customerDueDate: string | null, actor: MarketingActor): Promise<{ updated: number }>;
  batchDeleteSchedules(tenantId: string, rows: Array<{ id: string; expectedVersion: number }>, actor: MarketingActor): Promise<{ deleted: number }>;
  syncSchedulesToRollingPlan(tenantId: string, rows: RollingPlanSyncRow[], selected: number, validationFailures: RollingPlanSyncFailure[], idempotencyKey: string, actor: MarketingActor): Promise<RollingPlanSyncResult>;
  updateDivisionReviewDueDate(tenantId: string, id: string, divisionReviewDueDate: string | null, expectedVersion: number, actor: MarketingActor): Promise<unknown>;
  confirmDivisionOrderReviews(tenantId: string, rows: DivisionReviewConfirmRow[], selected: number, validationFailures: RollingPlanSyncFailure[], idempotencyKey: string, actor: MarketingActor): Promise<DivisionReviewConfirmResult>;
  syncMappingDepartmentsFromDirectory(tenantId: string, targets: MappingDepartmentDirectorySyncTarget[], skipped: MappingDepartmentDirectorySyncResult["skipped"], actor: MarketingActor): Promise<MappingDepartmentDirectorySyncResult>;
  deleteSchedule(tenantId: string, id: string, expectedVersion: number, actor: MarketingActor): Promise<void>;
}
