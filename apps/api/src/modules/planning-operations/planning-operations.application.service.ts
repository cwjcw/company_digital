import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { PlanningActor } from "../planning/planning.types";
import { PLANNING_OPERATIONS_REPOSITORY, type PlanningOperationsRepository } from "./planning-operations.repository";

export function shanghaiDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

@Injectable()
export class PlanningOperationsApplicationService {
  constructor(@Inject(PLANNING_OPERATIONS_REPOSITORY) private readonly repository: PlanningOperationsRepository) {}
  private assert(actor: PlanningActor, resource: "weekly-plan" | "work-report", action: "read" | "update" | "import") { if (!actor.permissions.includes("*") && !actor.permissions.includes(`${resource}:*:${action}`)) throw new ForbiddenException("当前权限组没有此表的操作权限"); }
  private date(value: unknown, label: string) { const date=String(value??"").slice(0,10), parsed=new Date(`${date}T00:00:00Z`); if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date) throw new BadRequestException(`${label}格式无效`); return date; }
  private async tenant(actor: PlanningActor) { return this.repository.tenantId(actor.tenantCode); }
  async weeklyPeriods(actor: PlanningActor) { this.assert(actor,"weekly-plan","read"); return this.repository.listWeeklyPeriods(await this.tenant(actor),shanghaiDate()); }
  async weeklyItems(periodId: string, search: string|undefined, actor: PlanningActor) { this.assert(actor,"weekly-plan","read"); return this.repository.listWeeklyItems(await this.tenant(actor),periodId,search); }
  async syncCurrentWeekly(actor: PlanningActor) { this.assert(actor,"weekly-plan","import"); return this.repository.syncWeeklyItemsForDate(await this.tenant(actor),shanghaiDate(),actor); }
  async updateWeekly(id: string, input: { field: string; value: string|null; expectedVersion: number }, actor: PlanningActor) { this.assert(actor,"weekly-plan","update"); const fields={customerDueDate:"customer_due_date",reviewDueDate:"review_due_date"} as const; const field=fields[input.field as keyof typeof fields]; if(!field) throw new BadRequestException("只能修改客户交期或评审交期"); const value=input.value?this.date(input.value,input.field):null; return this.repository.updateWeeklyDate(await this.tenant(actor),id,field,value,Number(input.expectedVersion),actor); }
  async workReports(date: string, search: string|undefined, actor: PlanningActor) { this.assert(actor,"work-report","read"); return this.repository.listWorkReports(await this.tenant(actor),this.date(date,"日期"),search); }
  async syncWorkReports(date: string, actor: PlanningActor) { this.assert(actor,"work-report","import"); return this.repository.syncWorkReports(await this.tenant(actor),this.date(date,"日期"),actor); }
  async updateReported(id: string, quantity: unknown, expectedVersion: number, actor: PlanningActor) { this.assert(actor,"work-report","update"); const value=String(quantity??"").replaceAll(",","").trim(); if(!/^\d+(\.\d+)?$/.test(value)) throw new BadRequestException("报工数量必须为大于等于 0 的数字"); return this.repository.updateReportedQuantity(await this.tenant(actor),id,value,Number(expectedVersion),actor); }
}
