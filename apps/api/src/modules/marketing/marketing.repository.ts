import type { MappingDepartmentDirectorySyncResult, MappingDepartmentDirectorySyncTarget, MappingImportResult, MappingImportSummary, MarketingActor, OrderScheduleBusinessSyncResult, OrderScheduleInput, ResolvedBusinessCustomerMappingInput } from "./marketing.types";

export const MARKETING_REPOSITORY = Symbol("MARKETING_REPOSITORY");

export interface MarketingRepository {
  tenantId(code: string): Promise<string>;
  listMappings(tenantId: string, search?: string): Promise<unknown[]>;
  listSchedules(tenantId: string, search?: string): Promise<unknown[]>;
  saveMapping(tenantId: string, id: string | null, input: ResolvedBusinessCustomerMappingInput, expectedVersion: number | null, actor: MarketingActor): Promise<unknown>;
  replaceMappings(tenantId: string, rows: ResolvedBusinessCustomerMappingInput[], fileName: string, fileHash: string, summary: MappingImportSummary, actor: MarketingActor): Promise<MappingImportResult>;
  deleteMapping(tenantId: string, id: string, expectedVersion: number, actor: MarketingActor): Promise<void>;
  saveSchedule(tenantId: string, id: string | null, input: OrderScheduleInput, expectedVersion: number | null, actor: MarketingActor): Promise<unknown>;
  batchUpdateDueDate(tenantId: string, rows: Array<{ id: string; expectedVersion: number }>, customerDueDate: string | null, actor: MarketingActor): Promise<{ updated: number }>;
  syncSchedulesFromPlanning(tenantId: string, actor: MarketingActor): Promise<{ synced: number }>;
  syncScheduleBusinessFields(tenantId: string, actor: MarketingActor): Promise<OrderScheduleBusinessSyncResult>;
  syncMappingDepartmentsFromDirectory(tenantId: string, targets: MappingDepartmentDirectorySyncTarget[], skipped: MappingDepartmentDirectorySyncResult["skipped"], actor: MarketingActor): Promise<MappingDepartmentDirectorySyncResult>;
  deleteSchedule(tenantId: string, id: string, expectedVersion: number, actor: MarketingActor): Promise<void>;
}
