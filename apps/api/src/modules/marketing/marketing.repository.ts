import type { BusinessCustomerMappingInput, MappingImportResult, MappingImportSummary, MarketingActor, OrderScheduleInput } from "./marketing.types";

export const MARKETING_REPOSITORY = Symbol("MARKETING_REPOSITORY");

export interface MarketingRepository {
  tenantId(code: string): Promise<string>;
  listMappings(tenantId: string, search?: string): Promise<unknown[]>;
  listSchedules(tenantId: string, search?: string): Promise<unknown[]>;
  saveMapping(tenantId: string, id: string | null, input: BusinessCustomerMappingInput, expectedVersion: number | null, actor: MarketingActor): Promise<unknown>;
  replaceMappings(tenantId: string, rows: BusinessCustomerMappingInput[], fileName: string, fileHash: string, summary: MappingImportSummary, actor: MarketingActor): Promise<MappingImportResult>;
  deleteMapping(tenantId: string, id: string, expectedVersion: number, actor: MarketingActor): Promise<void>;
  saveSchedule(tenantId: string, id: string | null, input: OrderScheduleInput, expectedVersion: number | null, actor: MarketingActor): Promise<unknown>;
  batchUpdateDueDate(tenantId: string, rows: Array<{ id: string; expectedVersion: number }>, customerDueDate: string | null, actor: MarketingActor): Promise<{ updated: number }>;
  syncSchedulesFromPlanning(tenantId: string, actor: MarketingActor): Promise<{ synced: number }>;
  deleteSchedule(tenantId: string, id: string, expectedVersion: number, actor: MarketingActor): Promise<void>;
}
