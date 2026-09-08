import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { planningFieldRegistry, tablePermissionFieldsFor, type OnHandSummaryContract } from "@kdos/contracts";
import { fieldAccess } from "@kdos/permissions";
import { PLANNING_REPOSITORY, type PlanSearchInput, type PlanningRepository } from "./planning.repository";
import { PlanningDomainService } from "./planning-domain.service";
import type { PlanItemView, PlanningActor } from "./planning.types";
import { PlanningOrganizationDirectoryService } from "./planning-organization-directory.service";

function shanghaiDate() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

@Injectable()
export class PlanQueryService {
  constructor(
    @Inject(PLANNING_REPOSITORY) private readonly repository: PlanningRepository,
    private readonly domain: PlanningDomainService,
    private readonly directory: PlanningOrganizationDirectoryService
  ) {}

  private tenant(actor: PlanningActor) { return this.repository.tenantId(actor.tenantCode); }
  private requireTableRead(actor: PlanningActor, resource: string) {
    if (!actor.permissions.includes("*") && !actor.permissions.includes(`${resource}:*:read`)) {
      throw new ForbiddenException("当前权限组没有此报表的查看权限");
    }
  }
  private onHandScopes(actor: PlanningActor) {
    return (actor.tableDataScopes ?? []).filter((scope) => scope.resource === "on-hand-summary-dashboard" && (!scope.actions || scope.actions.includes("read")));
  }
  private matchesRule(row: PlanItemView, rule: { fieldKey?: string; operator?: string; value?: unknown }, actor: PlanningActor) {
    const metrics = this.domain.metrics(row);
    const processStatuses = Object.values(row.processes).map((value) => this.domain.processStatus({
      completedQuantity: value.quantity, plannedDate: value.dueDate as string | null, status: value.status as string | null
    }, row.productionQuantity, shanghaiDate()));
    const values: Record<string, unknown> = {
      orderNumber: row.orderNumber, itemNumber: row.itemNumber, itemName: row.itemName, customer: row.customerName,
      customerDueDate: row.deliveryDate, itemStatus: this.domain.itemStatus(metrics.balanceQuantity, processStatuses),
      productionQuantity: row.productionQuantity, historicalInboundQuantity: row.historicalInboundQuantity,
      todayInboundQuantity: row.currentInboundQuantity, inboundQuantity: metrics.inboundQuantity,
      balanceQuantity: metrics.balanceQuantity, responsibleOrgId: row.responsibleOrgId, ownerUserId: row.ownerUserId,
      createdBy: row.createdBy, updatedBy: row.updatedBy
    };
    const actual = values[String(rule.fieldKey ?? "")];
    const expected = rule.value === "CURRENT_USER" ? actor.userId
      : rule.value === "CURRENT_USER_MANAGED_DEPARTMENTS" ? actor.managedOrganizationUnitIds ?? [] : rule.value;
    const operator = String(rule.operator ?? "");
    if (operator === "IS_EMPTY") return actual == null || actual === "";
    if (operator === "IS_NOT_EMPTY") return actual != null && actual !== "";
    const actualText = String(actual ?? "");
    const expectedValues = Array.isArray(expected) ? expected.map(String) : [String(expected ?? "")];
    if (operator === "EQ") return expectedValues.includes(actualText);
    if (operator === "NE") return !expectedValues.includes(actualText);
    if (operator === "IN") return expectedValues.includes(actualText);
    if (operator === "NOT_IN") return !expectedValues.includes(actualText);
    if (operator === "CONTAINS") return expectedValues.some((value) => actualText.includes(value));
    if (operator === "NOT_CONTAINS") return expectedValues.every((value) => !actualText.includes(value));
    if (operator === "STARTS_WITH") return expectedValues.some((value) => actualText.startsWith(value));
    const actualNumber = Number(actual); const expectedNumber = Number(expectedValues[0]);
    if (!Number.isFinite(actualNumber) || !Number.isFinite(expectedNumber)) return false;
    return operator === "GT" ? actualNumber > expectedNumber : operator === "GTE" ? actualNumber >= expectedNumber
      : operator === "LT" ? actualNumber < expectedNumber : operator === "LTE" ? actualNumber <= expectedNumber : false;
  }
  private scopedOnHandRows(rows: PlanItemView[], actor: PlanningActor) {
    if (actor.permissions.includes("*")) return rows;
    const scopes = this.onHandScopes(actor);
    return rows.filter((row) => scopes.some((scope) => {
      if (scope.scope === "ALL") return true;
      if (scope.scope === "OWN") return Boolean(actor.userId && row.createdBy === actor.userId);
      if (scope.scope !== "CUSTOM") return false;
      const rules = scope.rules ?? [];
      if (!rules.length) return false;
      const matches = rules.map((rule) => this.matchesRule(row, rule, actor));
      return scope.match === "ANY" ? matches.some(Boolean) : matches.every(Boolean);
    }));
  }
  private visibleOnHandFields(actor: PlanningActor) {
    const all = tablePermissionFieldsFor("on-hand-summary-dashboard").map((field) => field.key);
    const moduleAdministrator = this.onHandScopes(actor).some((scope) => scope.groupId === "module-admin:planning");
    if (actor.permissions.includes("*") || moduleAdministrator) return all;
    return all.filter((field) => actor.permissions.includes(`on-hand-summary-dashboard:${field}:read`));
  }
  private redactOnHandSummary(summary: Omit<OnHandSummaryContract, "source" | "visibleFields">, visibleFields: string[]) {
    const visible = new Set(visibleFields);
    const pick = <T extends Record<string, unknown>>(value: T, fields: string[]) => Object.fromEntries(
      Object.entries(value).filter(([key]) => fields.includes(key) && visible.has(key))
    );
    const quantityFields = ["itemCount", "orderCount", "customerCount", "productionQuantity", "historicalInboundQuantity", "todayInboundQuantity", "inboundQuantity", "balanceQuantity", "completionRate"];
    return {
      metrics: pick(summary.metrics, quantityFields),
      statusCounts: visible.has("itemStatus") ? summary.statusCounts : {},
      divisionRows: visible.has("responsibleOrgId") ? summary.divisionRows.map((row) => ({
        divisionId: row.divisionId, divisionName: row.divisionName, divisionPath: row.divisionPath,
        ...pick(row, ["itemCount", "orderCount", "productionQuantity", "inboundQuantity", "balanceQuantity", "completionRate"])
      })) : [],
      customerRows: visible.has("customer") ? summary.customerRows.map((row) => pick(row, ["customer", "itemCount", "orderCount", "productionQuantity", "inboundQuantity", "balanceQuantity", "completionRate"])) : [],
      processRows: visible.has("processName") ? summary.processRows.map((row) => pick(row, ["processName", "itemCount", "completedCount", "overdueCount", "exceptionCount", "completionRate"])) : [],
      warningRows: visible.has("orderNumber") || visible.has("itemNumber") ? summary.warningRows.map((row) => ({
        ...pick(row, ["orderNumber", "itemNumber", "itemName", "customer", "customerDueDate", "itemStatus", "balanceQuantity"]),
        ...(visible.has("responsibleOrgId") ? { divisionName: row.divisionName } : {})
      })) : []
    };
  }
  fields(actor: PlanningActor) { return planningFieldRegistry.map((field) => ({ ...field, access: fieldAccess(actor, field) })).filter((field) => field.access !== "HIDDEN"); }
  async organizationOptions(actor: PlanningActor) {
    this.requireTableRead(actor, "monthly-plan");
    return this.directory.listEnabled();
  }
  async listPeriods(actor: PlanningActor) { return this.repository.listPeriods(await this.tenant(actor)); }
  async getPlanPeriod(periodId: string, actor: PlanningActor) { return this.repository.getPeriod(await this.tenant(actor), periodId); }
  async getPeriodByMonth(year: number, month: number, actor: PlanningActor) { return this.repository.periodByMonth(await this.tenant(actor), year, month); }
  async getOnHandSummary(year: number, month: number, actor: PlanningActor): Promise<OnHandSummaryContract> {
    this.requireTableRead(actor, "on-hand-summary-dashboard");
    if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) throw new BadRequestException("计划年月无效");
    const tenantId = await this.tenant(actor);
    const period = await this.repository.periodByMonth(tenantId, year, month);
    const activeVersion = period?.versions.find((entry) => entry.status === "DRAFT")
      ?? period?.versions.find((entry) => entry.id === period.currentVersionId)
      ?? period?.versions[0] ?? null;
    const rows = activeVersion ? await this.repository.searchItems(tenantId, { versionId: activeVersion.id, limit: 10_000 }) : [];
    const visibleFields = this.visibleOnHandFields(actor);
    const organizations = await this.directory.listEnabled();
    const organizationLabels = new Map(organizations.map((organization) => [organization.id, { name: organization.name, pathLabel: organization.pathLabel }]));
    const summary = this.redactOnHandSummary(this.domain.onHandSummary(this.scopedOnHandRows(rows, actor), shanghaiDate(), organizationLabels), visibleFields);
    return {
      source: {
        year, month, periodId: period?.id ?? null, versionId: activeVersion?.id ?? null,
        versionName: activeVersion?.name ?? null, versionStatus: activeVersion?.status ?? null
      },
      visibleFields,
      ...summary
    };
  }
  async getPublishedPlan(periodId: string, actor: PlanningActor) {
    const result = await this.getPlanPeriod(periodId, actor);
    return result?.versions.find((entry) => entry.id === result.currentVersionId && ["PUBLISHED", "LOCKED"].includes(entry.status)) ?? null;
  }
  async getDraftPlan(periodId: string, actor: PlanningActor) { return (await this.getPlanPeriod(periodId, actor))?.versions.find((entry) => entry.status === "DRAFT") ?? null; }
  async getPlanItem(itemId: string, actor: PlanningActor) { return this.repository.getItem(await this.tenant(actor), itemId); }

  async searchPlanItems(input: PlanSearchInput, actor: PlanningActor) {
    const tenantId = await this.tenant(actor);
    const today = shanghaiDate();
    const [rows, organizations] = await Promise.all([this.repository.searchItems(tenantId, input), this.directory.listEnabled()]);
    const organizationLabels = new Map(organizations.map((organization) => [organization.id, organization.pathLabel]));
    const responsibleOrgField = planningFieldRegistry.find((field) => field.code === "responsibleOrgId")!;
    const canSeeResponsibleOrg = fieldAccess(actor, responsibleOrgField) !== "HIDDEN";
    return rows.map((row) => {
      const metrics = this.domain.metrics(row);
      const processes = Object.fromEntries(Object.entries(row.processes).map(([code, value]) => [code, {
        ...value,
        status: this.domain.processStatus({ completedQuantity: value.quantity, plannedDate: value.dueDate as string | null, status: value.status as string | null }, row.productionQuantity, today)
      }]));
      const processStatuses = Object.values(processes).map((entry) => String(entry.status ?? ""));
      return {
        ...row.legacyData,
        id: row.id, version: row.version, planVersionId: row.planVersionId,
        priority: row.priority, planSequence: row.sequence, sequence: row.sequence, planningStatus: row.status,
        ...(canSeeResponsibleOrg ? {
          responsibleOrgId: row.responsibleOrgId,
          responsibleOrgPath: row.responsibleOrgId ? organizationLabels.get(row.responsibleOrgId) ?? row.responsibleOrgId : null
        } : {}),
        ownerUserId: row.ownerUserId,
        orderNumber: row.orderNumber, itemNumber: row.itemNumber, itemName: row.itemName,
        customer: row.customerName, customerDueDate: row.deliveryDate,
        orderQuantity: row.orderQuantity, productionQuantity: row.productionQuantity, historicalInboundQuantity: row.historicalInboundQuantity,
        todayInboundQuantity: row.currentInboundQuantity, unitPrice: row.unitPrice,
        balanceQuantity: metrics.balanceQuantity, inboundAmount: metrics.inboundAmount,
        balanceAmount: metrics.balanceAmount, completionRate: metrics.completionRate,
        itemStatus: this.domain.itemStatus(metrics.balanceQuantity, processStatuses),
        imageRefs: row.imageRefs, remark: row.remark, orderException: row.exception,
        processes, createdBy: row.createdBy, createdAt: row.createdAt, updatedBy: row.updatedBy, updatedAt: row.updatedAt
      };
    });
  }

  async searchPlanItemsPage(input: PlanSearchInput & { page: number; pageSize: number }, actor: PlanningActor) {
    const pageSize = [0, 20, 50, 100, 200].includes(input.pageSize) ? input.pageSize : 50;
    const page = pageSize === 0 ? 1 : Math.max(Number.isInteger(input.page) ? input.page : 1, 1);
    const filters = { ...(input.filters ?? {}) };
    const responsibleOrgFilter = String(filters.responsibleOrgId ?? "").trim().toLocaleLowerCase();
    let responsibleOrgIds: string[] | undefined;
    if (responsibleOrgFilter) {
      const organizations = await this.directory.listEnabled();
      responsibleOrgIds = organizations
        .filter((organization) => `${organization.name} ${organization.pathLabel}`.toLocaleLowerCase().includes(responsibleOrgFilter))
        .map((organization) => organization.id);
      delete filters.responsibleOrgId;
    }
    const query = { ...input, filters, responsibleOrgIds, limit: pageSize, offset: (page - 1) * pageSize };
    const tenantId = await this.tenant(actor);
    const [rows, total] = await Promise.all([
      this.searchPlanItems(query, actor),
      this.repository.countItems(tenantId, query)
    ]);
    if (pageSize === 0) {
      if (!actor.permissions.includes("*") && !actor.permissions.includes("planning.plan.read") && !actor.permissions.includes("monthly-plan:*:read")) throw new ForbiddenException("没有月度计划查看权限");
      const scopes = (actor.tableDataScopes ?? []).filter((scope) => scope.resource === "monthly-plan" && (!scope.actions || scope.actions.includes("read")));
      const allowed = actor.permissions.includes("*") ? rows : rows.filter((row) => scopes.some((scope) => {
        if (scope.scope === "ALL") return true;
        if (scope.scope === "OWN") return Boolean(actor.userId && row.createdBy === actor.userId);
        const rules = scope.rules ?? [];
        if (scope.scope !== "CUSTOM" || !rules.length) return false;
        const matches = rules.map((rule) => {
          const actual = row[rule.fieldKey as keyof typeof row];
          const expected = rule.value === "CURRENT_USER" ? actor.userId : rule.value === "CURRENT_USER_MANAGED_DEPARTMENTS" ? actor.managedOrganizationUnitIds ?? [] : rule.value;
          const values = Array.isArray(expected) ? expected.map(String) : [String(expected ?? "")];
          if (rule.operator === "EQ" || rule.operator === "IN") return values.includes(String(actual ?? ""));
          if (rule.operator === "NE" || rule.operator === "NOT_IN") return !values.includes(String(actual ?? ""));
          if (rule.operator === "CONTAINS") return String(actual ?? "").includes(String(expected ?? ""));
          if (rule.operator === "IS_EMPTY") return actual == null || actual === "";
          if (rule.operator === "IS_NOT_EMPTY") return actual != null && actual !== "";
          return false;
        });
        return scope.match === "ANY" ? matches.some(Boolean) : matches.every(Boolean);
      }));
      const administrator = actor.permissions.includes("*") || scopes.some((scope) => scope.groupId?.startsWith("module-admin:"));
      const visible = administrator ? allowed : allowed.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => ["id", "version", "planVersionId"].includes(key) || actor.permissions.includes(`monthly-plan:${key}:read`) || actor.permissions.includes(`monthly-plan:${key}:update`))));
      return { rows: visible, total: visible.length, page: 1, pageSize: 0 };
    }
    return { rows, total, page, pageSize };
  }

  async getOrderProgress(versionId: string, orderNumber: string, actor: PlanningActor) {
    const rows = await this.searchPlanItems({ versionId, orderNumber }, actor);
    return { orderNumber, items: rows, total: rows.length };
  }
  async getProcessProgress(versionId: string, actor: PlanningActor) { return this.repository.listProcessProgress(await this.tenant(actor), versionId); }
  async getPlanRiskSummary(versionId: string, dueWithinDays: number, actor: PlanningActor) {
    const today = shanghaiDate();
    return this.repository.riskSummary(await this.tenant(actor), versionId, dueWithinDays, today);
  }
  async getOverdueItems(versionId: string, actor: PlanningActor) { return (await this.getPlanRiskSummary(versionId, 7, actor)).overdue; }
}
