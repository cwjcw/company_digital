import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { planningFieldRegistry } from "@kdos/contracts";
import type { PlanningActor } from "../planning/planning.types";
import { PlanningOrganizationDirectoryService } from "../planning/planning-organization-directory.service";
import { PLANNING_OPERATIONS_REPOSITORY, type OperationsPageInput, type PlanningOperationsRepository } from "./planning-operations.repository";

export function shanghaiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

@Injectable()
export class PlanningOperationsApplicationService {
  constructor(@Inject(PLANNING_OPERATIONS_REPOSITORY) private readonly repository: PlanningOperationsRepository, private readonly directory: PlanningOrganizationDirectoryService) {}
  private assert(actor: PlanningActor, resource: "weekly-plan" | "work-report" | "rolling-plan-table", action: "read" | "update" | "import") { if (!actor.permissions.includes("*") && !actor.permissions.includes(`${resource}:*:${action}`)) throw new ForbiddenException("当前权限组没有此表的操作权限"); }
  private date(value: unknown, label: string) { const date=String(value??"").slice(0,10), parsed=new Date(`${date}T00:00:00Z`); if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date) throw new BadRequestException(`${label}格式无效`); return date; }
  private async tenant(actor: PlanningActor) { return this.repository.tenantId(actor.tenantCode); }
  async weeklyPeriods(actor: PlanningActor) { this.assert(actor,"weekly-plan","read"); return this.repository.listWeeklyPeriods(await this.tenant(actor),shanghaiDate()); }
  rollingFields(actor: PlanningActor) {
    this.assert(actor,"rolling-plan-table","read");
    const allFields = actor.permissions.includes("*") || actor.permissions.includes("rolling-plan-table:*:read");
    return planningFieldRegistry.map((field) => ({ ...field, access: allFields || actor.permissions.includes(`rolling-plan-table:${field.code}:read`) || actor.permissions.includes(`rolling-plan-table:${field.code}:update`) ? "READONLY" as const : "HIDDEN" as const })).filter((field) => field.access !== "HIDDEN");
  }
  async rollingOrganizations(actor: PlanningActor) { this.assert(actor,"rolling-plan-table","read"); return this.directory.listEnabled(); }
  private valueAt(row: Record<string, unknown>, key: string) { return key.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, row); }
  private scopedRows(rows: Array<Record<string, unknown>>, actor: PlanningActor, resource: "rolling-plan-table") {
    if (actor.permissions.includes("*")) return rows;
    const scopes = (actor.tableDataScopes ?? []).filter((scope) => scope.resource === resource && (!scope.actions || scope.actions.includes("read")));
    if (!scopes.length || scopes.some((scope) => scope.scope === "ALL")) return rows;
    const matchesRule = (row: Record<string, unknown>, rule: { fieldKey?: string; operator?: string; value?: unknown }) => {
      const actual = this.valueAt(row, String(rule.fieldKey ?? ""));
      const expected = rule.value === "CURRENT_USER" ? actor.userId : rule.value === "CURRENT_USER_MANAGED_DEPARTMENTS" ? actor.managedOrganizationUnitIds ?? [] : rule.value;
      const values = Array.isArray(expected) ? expected.map(String) : [String(expected ?? "")];
      const actualText = String(actual ?? ""); const operator = String(rule.operator ?? "");
      if (operator === "IS_EMPTY") return actual == null || actual === "";
      if (operator === "IS_NOT_EMPTY") return actual != null && actual !== "";
      if (operator === "EQ" || operator === "IN") return values.includes(actualText);
      if (operator === "NE" || operator === "NOT_IN") return !values.includes(actualText);
      if (operator === "CONTAINS") return values.some((value) => actualText.includes(value));
      if (operator === "NOT_CONTAINS") return values.every((value) => !actualText.includes(value));
      const left = Number(actual); const right = Number(values[0]);
      return Number.isFinite(left) && Number.isFinite(right) && (operator === "GT" ? left > right : operator === "GTE" ? left >= right : operator === "LT" ? left < right : operator === "LTE" ? left <= right : false);
    };
    return rows.filter((row) => scopes.some((scope) => scope.scope === "OWN" ? Boolean(actor.userId && row.createdBy === actor.userId) : scope.scope === "CUSTOM" && (scope.rules?.length ?? 0) > 0 && (scope.match === "ANY" ? scope.rules!.some((rule) => matchesRule(row, rule)) : scope.rules!.every((rule) => matchesRule(row, rule)))));
  }
  async rollingItems(input: Partial<OperationsPageInput>, actor: PlanningActor) {
    this.assert(actor,"rolling-plan-table","read");
    const normalized = this.page(input);
    let rows = this.scopedRows(await this.repository.listRollingPlanItems(await this.tenant(actor)),actor,"rolling-plan-table");
    const search = normalized.search?.toLocaleLowerCase();
    if (search) rows = rows.filter((row) => JSON.stringify(row).toLocaleLowerCase().includes(search));
    rows = rows.filter((row) => Object.entries(normalized.filters ?? {}).every(([key,value]) => !value.trim() || String(this.valueAt(row,key) ?? "").toLocaleLowerCase().includes(value.trim().toLocaleLowerCase())));
    if (normalized.sortField) rows.sort((left,right) => String(this.valueAt(left,normalized.sortField!) ?? "").localeCompare(String(this.valueAt(right,normalized.sortField!) ?? ""),"zh-CN",{numeric:true}) * (normalized.sortOrder === "desc" ? -1 : 1));
    const total = rows.length;
    const pageRows = rows.slice((normalized.page-1)*normalized.pageSize,normalized.page*normalized.pageSize);
    const visible = new Set(this.rollingFields(actor).map((field) => field.code));
    const redacted = pageRows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => ["id","version","sourceOrderScheduleId"].includes(key) || visible.has(key))));
    return {rows:redacted,total,page:normalized.page,pageSize:normalized.pageSize};
  }
  private page(input: Partial<OperationsPageInput>): OperationsPageInput { const pageSize=[20,50,100,200].includes(Number(input.pageSize))?Number(input.pageSize):50; return {page:Math.max(Number(input.page)||1,1),pageSize,search:String(input.search??"").trim(),filters:input.filters??{},sortField:String(input.sortField??"")||undefined,sortOrder:input.sortOrder==="desc"?"desc":"asc"}; }
  async weeklyItems(periodId: string, input: Partial<OperationsPageInput>, actor: PlanningActor) { this.assert(actor,"weekly-plan","read"); return this.repository.listWeeklyItems(await this.tenant(actor),periodId,this.page(input)); }
  async updateWeekly(id: string, input: { field: string; value: string|null; expectedVersion: number }, actor: PlanningActor) { this.assert(actor,"weekly-plan","update"); const fields={customerDueDate:"customer_due_date",reviewDueDate:"review_due_date"} as const; const field=fields[input.field as keyof typeof fields]; if(!field) throw new BadRequestException("只能修改客户交期或评审交期"); const value=input.value?this.date(input.value,input.field):null; return this.repository.updateWeeklyDate(await this.tenant(actor),id,field,value,Number(input.expectedVersion),actor); }
  async workReports(date: string, input: Partial<OperationsPageInput>, actor: PlanningActor) { this.assert(actor,"work-report","read"); return this.repository.listWorkReports(await this.tenant(actor),this.date(date,"日期"),this.page(input)); }
  async syncWorkReports(date: string, actor: PlanningActor) { this.assert(actor,"work-report","import"); return this.repository.syncWorkReports(await this.tenant(actor),this.date(date,"日期"),actor); }
  async updateReported(id: string, quantity: unknown, expectedVersion: number, actor: PlanningActor) { this.assert(actor,"work-report","update"); const value=String(quantity??"").replaceAll(",","").trim(); if(!/^\d+(\.\d+)?$/.test(value)) throw new BadRequestException("报工数量必须为大于等于 0 的数字"); return this.repository.updateReportedQuantity(await this.tenant(actor),id,value,Number(expectedVersion),actor); }
}
