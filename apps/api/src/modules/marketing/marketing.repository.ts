import type { MappingDepartmentDirectorySyncResult, MappingDepartmentDirectorySyncTarget, MappingImportResult, MappingImportSummary, MarketingActor, OrderScheduleInput, ResolvedBusinessCustomerMappingInput } from "./marketing.types";

export const MARKETING_REPOSITORY = Symbol("MARKETING_REPOSITORY");

/** KN-FILTER-001：营销表位于 KDOS 库，服务端分页由调用方给出完整 WHERE（含租户谓词）与顺序。 */
export type MarketingPageQuery = {
  /** 已经包含租户谓词的完整 WHERE 片段，参数从 $1 开始。 */
  whereSql: string;
  params: unknown[];
  orderBy: string;
  page: number;
  pageSize: number;
};

export type MarketingPageResult = { rows: Array<Record<string, unknown>>; total: number; page: number; pageSize: number };

export interface MarketingRepository {
  importSchedules(tenantId: string, rows: import("./marketing.types").ScheduleImportRow[], hash: string, actor: MarketingActor): Promise<{ imported: number; repeated: boolean }>;
  clearSchedules(tenantId: string, actor: MarketingActor): Promise<{ deleted: number }>;
  tenantId(code: string): Promise<string>;
  listMappings(tenantId: string, search?: string): Promise<unknown[]>;
  listSchedules(tenantId: string, search?: string): Promise<unknown[]>;
  pageMappings(tenantId: string, query: MarketingPageQuery): Promise<MarketingPageResult>;
  pageSchedules(tenantId: string, query: MarketingPageQuery): Promise<MarketingPageResult>;
  /** 导出复用同一 WHERE（无分页）。 */
  listMappingsByQuery(tenantId: string, query: Omit<MarketingPageQuery, "page" | "pageSize">): Promise<Array<Record<string, unknown>>>;
  listSchedulesByQuery(tenantId: string, query: Omit<MarketingPageQuery, "page" | "pageSize">): Promise<Array<Record<string, unknown>>>;
  findSchedulesByIds(tenantId: string, ids: string[]): Promise<unknown[]>;
  saveMapping(tenantId: string, id: string | null, input: ResolvedBusinessCustomerMappingInput, expectedVersion: number | null, actor: MarketingActor): Promise<unknown>;
  replaceMappings(tenantId: string, rows: ResolvedBusinessCustomerMappingInput[], fileName: string, fileHash: string, summary: MappingImportSummary, actor: MarketingActor): Promise<MappingImportResult>;
  deleteMapping(tenantId: string, id: string, expectedVersion: number, actor: MarketingActor): Promise<void>;
  saveSchedule(tenantId: string, id: string | null, input: OrderScheduleInput, expectedVersion: number | null, actor: MarketingActor): Promise<unknown>;
  batchUpdateDueDate(tenantId: string, rows: Array<{ id: string; expectedVersion: number }>, customerDueDate: string | null, actor: MarketingActor): Promise<{ updated: number }>;
  batchDeleteSchedules(tenantId: string, rows: Array<{ id: string; expectedVersion: number }>, actor: MarketingActor): Promise<{ deleted: number }>;
  syncMappingDepartmentsFromDirectory(tenantId: string, targets: MappingDepartmentDirectorySyncTarget[], skipped: MappingDepartmentDirectorySyncResult["skipped"], actor: MarketingActor): Promise<MappingDepartmentDirectorySyncResult>;
  deleteSchedule(tenantId: string, id: string, expectedVersion: number, actor: MarketingActor): Promise<void>;
}
