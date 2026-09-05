import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { planningFieldRegistry } from "@kdos/contracts";
import { fieldAccess, hasPermission } from "@kdos/permissions";
import { PlanningConflictError, PlanningNotFoundError, PlanningStateError, PlanningValidationError } from "./planning.errors";
import { PLANNING_REPOSITORY, type PlanningRepository } from "./planning.repository";
import { PlanningDomainEventBus } from "./domain-event-bus";
import type { CreatePlanItemInput, PlanItemPatch, PlanningActor } from "./planning.types";
import { PlanningOrganizationDirectoryService, type PlanningOrganizationOption } from "./planning-organization-directory.service";

@Injectable()
export class PlanningApplicationService {
  constructor(
    @Inject(PLANNING_REPOSITORY) private readonly repository: PlanningRepository,
    private readonly events: PlanningDomainEventBus,
    private readonly directory: PlanningOrganizationDirectoryService
  ) {}

  private require(actor: PlanningActor, permission: string) {
    if (!hasPermission(actor, permission)) throw new ForbiddenException(`缺少权限：${permission}`);
  }
  private requireField(actor: PlanningActor, fieldCode: string) {
    const field = planningFieldRegistry.find((entry) => entry.code === fieldCode);
    if (!field || fieldAccess(actor, field) !== "EDITABLE") throw new ForbiddenException(`字段不可编辑：${fieldCode}`);
  }
  private async tenant(actor: PlanningActor) { return this.repository.tenantId(actor.tenantCode); }
  private async normalizePatch<T extends PlanItemPatch>(patch: T, organizations?: PlanningOrganizationOption[]): Promise<T> {
    if (patch.field !== "responsibleOrgId" || patch.value == null || patch.value === "") return patch;
    const organization = this.directory.resolve(patch.value, organizations ?? await this.directory.listEnabled());
    return { ...patch, value: organization!.id } as T;
  }
  private async invoke<T>(work: () => Promise<T>) {
    try { return await work(); }
    catch (error) {
      if (error instanceof PlanningNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof PlanningConflictError) throw new ConflictException({ message: error.message, current: error.current });
      if (error instanceof PlanningStateError) throw new ConflictException(error.message);
      if (error instanceof PlanningValidationError) throw new BadRequestException({ message: error.message, details: error.details });
      throw error;
    }
  }

  createPeriod(year: number, month: number, actor: PlanningActor) {
    this.require(actor, "planning.plan.create");
    return this.invoke(async () => this.repository.createPeriod(await this.tenant(actor), year, month, actor));
  }
  createVersion(periodId: string, basedOnVersionId: string | null, actor: PlanningActor) {
    this.require(actor, "planning.plan.create");
    return this.invoke(async () => this.repository.createVersion(await this.tenant(actor), periodId, basedOnVersionId, actor));
  }
  createItem(versionId: string, input: CreatePlanItemInput, actor: PlanningActor) {
    this.require(actor, "planning.plan.create");
    return this.invoke(async () => {
      const organization = input.responsibleOrgId
        ? this.directory.resolve(input.responsibleOrgId, await this.directory.listEnabled())
        : null;
      return this.repository.createItem(await this.tenant(actor), versionId, {
        ...input, responsibleOrgId: organization?.id
      }, actor);
    });
  }
  previewImport(versionId: string, fileName: string, fileHash: string, rows: CreatePlanItemInput[], warnings: string[], actor: PlanningActor) {
    this.require(actor, "planning.plan.import");
    return this.invoke(async () => this.repository.createImportPreview(await this.tenant(actor), versionId, fileName, fileHash, rows, warnings, actor));
  }
  confirmImport(jobId: string, actor: PlanningActor) {
    this.require(actor, "planning.plan.import");
    return this.invoke(async () => {
      const tenantId = await this.tenant(actor); const result = await this.repository.confirmImport(tenantId, jobId, actor);
      const planVersion = await this.repository.getVersion(tenantId, result.versionId);
      this.events.publish({ name: "planning.plan.imported", tenantId, periodId: planVersion!.periodId, versionId: result.versionId, changeType: "imported" });
      return result;
    });
  }
  updateItem(itemId: string, patch: PlanItemPatch, actor: PlanningActor) {
    this.require(actor, "planning.plan.update");
    if (!patch.field || !Number.isInteger(patch.expectedVersion)) throw new BadRequestException("field 和 expectedVersion 必填");
    this.requireField(actor, patch.field);
    return this.invoke(async () => {
      const tenantId = await this.tenant(actor);
      const updated = await this.repository.updateItem(tenantId, itemId, await this.normalizePatch(patch), actor);
      const version = await this.repository.getVersion(tenantId, updated.planVersionId);
      this.events.publish({ name: "planning.plan_item.updated", tenantId, periodId: version!.periodId, versionId: updated.planVersionId, entityId: updated.id, version: updated.version, changeType: "updated" });
      return updated;
    });
  }
  addImage(itemId: string, url: string, expectedVersion: number, actor: PlanningActor) {
    this.require(actor, "planning.plan.update");
    if (!Number.isInteger(expectedVersion)) throw new BadRequestException("expectedVersion 必填");
    return this.invoke(async () => {
      const tenantId = await this.tenant(actor); const current = await this.repository.getItem(tenantId, itemId);
      if (!current) throw new PlanningNotFoundError("计划行不存在");
      if (current.imageRefs.length >= 2) throw new PlanningValidationError("每个品号最多保存 2 张图片");
      const updated = await this.repository.updateItem(tenantId, itemId, { field: "imageRefs", value: [...current.imageRefs, url], expectedVersion }, actor);
      const version = await this.repository.getVersion(tenantId, updated.planVersionId);
      this.events.publish({ name: "planning.plan_item.updated", tenantId, periodId: version!.periodId, versionId: updated.planVersionId, entityId: updated.id, version: updated.version, changeType: "image-added" });
      return updated;
    });
  }
  bulkUpdate(versionId: string, patches: Array<{ id: string } & PlanItemPatch>, actor: PlanningActor) {
    this.require(actor, "planning.plan.update");
    for (const patch of patches) this.requireField(actor, patch.field);
    return this.invoke(async () => {
      const organizations = patches.some((patch) => patch.field === "responsibleOrgId" && patch.value != null && patch.value !== "")
        ? await this.directory.listEnabled() : undefined;
      return this.repository.bulkUpdate(
        await this.tenant(actor), versionId, await Promise.all(patches.map((patch) => this.normalizePatch(patch, organizations))), actor
      );
    });
  }
  reorder(versionId: string, itemIds: string[], actor: PlanningActor) {
    this.require(actor, "planning.plan.move");
    return this.invoke(async () => {
      const tenantId = await this.tenant(actor); const updated = await this.repository.reorder(tenantId, versionId, itemIds, actor);
      const planVersion = await this.repository.getVersion(tenantId, versionId);
      this.events.publish({ name: "planning.plan.reordered", tenantId, periodId: planVersion!.periodId, versionId, changeType: "reordered" });
      return updated;
    });
  }
  publish(periodId: string, versionId: string, actor: PlanningActor) {
    this.require(actor, "planning.plan.publish");
    return this.invoke(async () => {
      const tenantId = await this.tenant(actor); const result = await this.repository.publishVersion(tenantId, periodId, versionId, actor);
      this.events.publish({ name: "planning.plan.published", tenantId, periodId, versionId, changeType: "published" }); return result;
    });
  }
  lock(periodId: string, versionId: string, reason: string, actor: PlanningActor) {
    this.require(actor, "planning.plan.lock");
    return this.invoke(async () => {
      const tenantId = await this.tenant(actor); const result = await this.repository.lockVersion(tenantId, periodId, versionId, reason, actor);
      this.events.publish({ name: "planning.plan.locked", tenantId, periodId, versionId, changeType: "locked" }); return result;
    });
  }
  unlock(periodId: string, versionId: string, reason: string, actor: PlanningActor) {
    this.require(actor, "planning.plan.unlock");
    return this.invoke(async () => {
      const tenantId = await this.tenant(actor); const result = await this.repository.unlockVersion(tenantId, periodId, versionId, reason, actor);
      this.events.publish({ name: "planning.plan.unlocked", tenantId, periodId, versionId, changeType: "unlocked" }); return result;
    });
  }
}
