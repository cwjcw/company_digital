import type { PlanningRiskSummary } from "@kdos/contracts";
import type {
  CreatePlanItemInput, PlanItemPatch, PlanItemRecord, PlanItemView,
  PlanPeriodRecord, PlanningActor, PlanVersionRecord, ProcessProgressRecord
} from "./planning.types";

export const PLANNING_REPOSITORY = Symbol("PLANNING_REPOSITORY");

export interface PlanSearchInput {
  versionId: string;
  orderNumber?: string;
  itemNumber?: string;
  status?: string;
  ownerUserId?: string;
  responsibleOrgId?: string;
  responsibleOrgIds?: string[];
  search?: string;
  filters?: Record<string, string>;
  sortField?: string;
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface PlanningRepository {
  tenantId(code: string): Promise<string>;
  listPeriods(tenantId: string): Promise<Array<PlanPeriodRecord & { versions: PlanVersionRecord[] }>>;
  periodByMonth(tenantId: string, year: number, month: number): Promise<(PlanPeriodRecord & { versions: PlanVersionRecord[] }) | null>;
  getPeriod(tenantId: string, periodId: string): Promise<(PlanPeriodRecord & { versions: PlanVersionRecord[] }) | null>;
  getVersion(tenantId: string, versionId: string): Promise<PlanVersionRecord | null>;
  createPeriod(tenantId: string, year: number, month: number, actor: PlanningActor): Promise<PlanPeriodRecord>;
  createVersion(tenantId: string, periodId: string, basedOnVersionId: string | null, actor: PlanningActor): Promise<PlanVersionRecord>;
  searchItems(tenantId: string, input: PlanSearchInput): Promise<PlanItemView[]>;
  countItems(tenantId: string, input: PlanSearchInput): Promise<number>;
  getItem(tenantId: string, itemId: string): Promise<PlanItemView | null>;
  createItem(tenantId: string, versionId: string, input: CreatePlanItemInput, actor: PlanningActor): Promise<PlanItemRecord>;
  createImportPreview(tenantId: string, versionId: string, fileName: string, fileHash: string, rows: CreatePlanItemInput[], warnings: string[], actor: PlanningActor): Promise<{ jobId: string; summary: { total: number; warnings: number }; warnings: string[] }>;
  confirmImport(tenantId: string, jobId: string, actor: PlanningActor): Promise<{ versionId: string; created: number; updated: number; repeated: boolean }>;
  updateItem(tenantId: string, itemId: string, patch: PlanItemPatch, actor: PlanningActor): Promise<PlanItemRecord>;
  bulkUpdate(tenantId: string, versionId: string, patches: Array<{ id: string } & PlanItemPatch>, actor: PlanningActor): Promise<PlanItemRecord[]>;
  reorder(tenantId: string, versionId: string, itemIds: string[], actor: PlanningActor): Promise<PlanItemRecord[]>;
  publishVersion(tenantId: string, periodId: string, versionId: string, actor: PlanningActor): Promise<{ version: PlanVersionRecord; snapshotId: string; snapshotNumber: number }>;
  lockVersion(tenantId: string, periodId: string, versionId: string, reason: string, actor: PlanningActor): Promise<PlanVersionRecord>;
  unlockVersion(tenantId: string, periodId: string, versionId: string, reason: string, actor: PlanningActor): Promise<PlanVersionRecord>;
  listProcessProgress(tenantId: string, versionId: string): Promise<ProcessProgressRecord[]>;
  riskSummary(tenantId: string, versionId: string, dueWithinDays: number, today: string): Promise<PlanningRiskSummary>;
}
