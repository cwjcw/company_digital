import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import Decimal from "decimal.js";
import { DataSource, EntityManager } from "typeorm";
import { columnsFor, fieldsFor, MASTER_PLAN_RESOURCE_MAP, type MasterPlanResource } from "./master-plan.config";
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";
import { STANDARD_PROCESSES } from "./master-plan.domain";
import { MasterPlanSyncService } from "./master-plan.sync.service";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class MasterPlanApplicationService {
  constructor(private readonly dataSource: DataSource, private readonly sync: MasterPlanSyncService) {}

  async create(code: string, body: Record<string, unknown>, actor: MasterPlanActor) {
    const resource = this.resource(code);
    if (!resource.create || !hasMasterPlanPermission(actor, code, "create")) throw new ForbiddenException("当前权限组没有该表新增权限");
    await this.enforceShippingWindow(resource, actor);
    const values = this.writable(resource, body, actor);
    for (const field of resource.requiredOnCreate ?? []) if (values[field] == null || values[field] === "") throw new BadRequestException(`${this.label(resource, field)}不能为空`);
    await this.fillReportSource(resource, values, actor.tenantId);
    const result = await this.translateDatabaseError(() => this.dataSource.transaction(async (manager) => {
      const columns = columnsFor(resource); const entries = Object.entries(values);
      if (!entries.length) throw new BadRequestException("没有可写入的业务字段");
      const params = [actor.tenantId, actor.userId, actor.userId ?? actor.username, ...entries.map(([, value]) => value)];
      const inserted = await manager.query(`INSERT INTO ${resource.table}(tenant_id,created_by,updated_by,${entries.map(([field]) => columns[field]).join(",")}) VALUES($1,$2::uuid,$3,${entries.map((_, index) => `$${index + 4}`).join(",")}) RETURNING *`, params);
      await this.audit(manager, actor, code, inserted[0].id, `${code}.created`, null, inserted[0]);
      return inserted[0];
    }));
    await this.reconcileAfter(resource, actor);
    return result;
  }

  async update(code: string, id: string, body: Record<string, unknown>, actor: MasterPlanActor) {
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "update")) throw new ForbiddenException("当前权限组没有该表修改权限");
    await this.enforceShippingWindow(resource, actor);
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new BadRequestException("expectedVersion 必须是正整数");
    const values = this.writable(resource, body, actor);
    if (!Object.keys(values).length) throw new BadRequestException("没有可修改的业务字段");
    if (resource.code === "mps-system-settings" && !actor.isSystemAdmin) throw new ForbiddenException("只有系统管理员可以修改主计划系统参数");
    const result = await this.translateDatabaseError(() => this.dataSource.transaction(async (manager) => {
      const [current] = await manager.query(`SELECT * FROM ${resource.table} WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE`, [actor.tenantId, id]);
      if (!current) throw new NotFoundException("记录不存在");
      if (!this.recordAllowed(resource, current, actor, "update")) throw new ForbiddenException("当前数据范围不允许修改该记录");
      if (Number(current.version) !== expectedVersion) throw new ConflictException("记录已被其他用户修改，请刷新后重试");
      if (resource.code === "mps-material-reports") this.validateMaterial({ ...current, ...this.toDatabaseRecord(resource, values) });
      const columns = columnsFor(resource); const entries = Object.entries(values); const params: unknown[] = [actor.tenantId, id, expectedVersion, actor.userId ?? actor.username, ...entries.map(([, value]) => value)];
      const updated = await manager.query(`UPDATE ${resource.table} SET ${entries.map(([field], index) => `${columns[field]}=$${index + 5}`).join(",")},updated_at=now(),updated_by=$4,version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND version=$3 RETURNING *`, params);
      // TypeORM/pg returns UPDATE ... RETURNING as [rows, affectedCount], unlike INSERT/SELECT.
      const updatedRow = Array.isArray(updated[0]) ? updated[0][0] : updated[0];
      if (!updatedRow) throw new ConflictException("记录已被其他用户修改，请刷新后重试");
      await this.audit(manager, actor, code, id, `${code}.updated`, current, updatedRow);
      return updatedRow;
    }));
    await this.reconcileAfter(resource, actor);
    return result;
  }

  async remove(code: string, id: string, expectedVersion: unknown, actor: MasterPlanActor) {
    const resource = this.resource(code);
    if (!resource.remove || !hasMasterPlanPermission(actor, code, "delete")) throw new ForbiddenException("当前权限组没有该表删除权限");
    await this.enforceShippingWindow(resource, actor);
    const version = Number(expectedVersion); if (!Number.isInteger(version) || version < 1) throw new BadRequestException("expectedVersion 必须是正整数");
    const result = await this.translateDatabaseError(() => this.dataSource.transaction(async (manager) => {
      const [current] = await manager.query(`SELECT * FROM ${resource.table} WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE`, [actor.tenantId, id]);
      if (!current) throw new NotFoundException("记录不存在");
      if (!this.recordAllowed(resource, current, actor, "delete")) throw new ForbiddenException("当前数据范围不允许删除该记录");
      if (Number(current.version) !== version) throw new ConflictException("记录已被其他用户修改，请刷新后重试");
      await manager.query(`DELETE FROM ${resource.table} WHERE tenant_id=$1 AND id=$2::uuid AND version=$3`, [actor.tenantId, id, version]);
      await this.audit(manager, actor, code, id, `${code}.deleted`, current, null);
      return { id, deleted: true };
    }));
    await this.reconcileAfter(resource, actor);
    return result;
  }

  private resource(code: string) { const resource = MASTER_PLAN_RESOURCE_MAP.get(code as any); if (!resource) throw new NotFoundException("主计划表不存在"); return resource; }
  private label(resource: MasterPlanResource, key: string) { return fieldsFor(resource).find((field) => field.key === key)?.label ?? key; }

  private writable(resource: MasterPlanResource, body: Record<string, unknown>, actor: MasterPlanActor) {
    const allowed = new Map(fieldsFor(resource).filter((field) => field.editable).map((field) => [field.key, field]));
    const output: Record<string, unknown> = {};
    for (const [field, raw] of Object.entries(body)) {
      if (["expectedVersion", "id", "version", "createdBy", "createdAt", "updatedBy", "updatedAt", "tenantId"].includes(field)) continue;
      const definition = allowed.get(field); if (!definition) throw new BadRequestException(`字段 ${field} 不允许写入`);
      if (!hasMasterPlanFieldPermission(actor, resource.code, field, "update")) throw new ForbiddenException(`当前权限组不能编辑字段：${definition.label}`);
      output[field] = this.normalize(definition.type, raw, definition.label);
    }
    return output;
  }

  private normalize(type: string, value: unknown, label: string) {
    if (value === "" || value == null) return null;
    if (type === "boolean") {
      if (typeof value === "boolean") return value;
      if (["true", "1", "是"].includes(String(value))) return true;
      if (["false", "0", "否"].includes(String(value))) return false;
      throw new BadRequestException(`${label}必须为是或否`);
    }
    if (type === "number") {
      try { const number = new Decimal(String(value)); if (!number.isFinite() || number.isNegative()) throw new Error(); return number.toString(); }
      catch { throw new BadRequestException(`${label}必须为非负数字`); }
    }
    if (type === "date") {
      const normalized = String(value).trim(); const parsed = new Date(`${normalized}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) throw new BadRequestException(`${label}日期格式无效`);
      return normalized;
    }
    if (["department", "member"].includes(type)) { const normalized = String(value).trim(); if (!uuidPattern.test(normalized)) throw new BadRequestException(`${label}必须使用系统稳定ID`); return normalized; }
    if (typeof value === "object") return JSON.stringify(value);
    const normalized = String(value).trim(); if (normalized.length > 4000) throw new BadRequestException(`${label}内容过长`); return normalized || null;
  }

  private async fillReportSource(resource: MasterPlanResource, values: Record<string, unknown>, tenantId: string) {
    if (!["mps-material-reports", "mps-process-reports"].includes(resource.code)) return;
    const weeklyPlanId = String(values.weeklyPlanId ?? ""); if (!uuidPattern.test(weeklyPlanId)) throw new BadRequestException("请选择有效的周计划");
    const [weekly] = await this.dataSource.query(`SELECT order_number,item_code,item_name,delivery_number,planned_quantity FROM mps_weekly_plans WHERE tenant_id=$1 AND id=$2::uuid`, [tenantId, weeklyPlanId]);
    if (!weekly) throw new BadRequestException("周计划不存在");
    Object.assign(values, { orderNumber: weekly.order_number, itemCode: weekly.item_code, itemName: weekly.item_name, deliveryNumber: weekly.delivery_number });
    if (resource.code === "mps-process-reports") {
      values.plannedQuantity = weekly.planned_quantity;
      const process = STANDARD_PROCESSES.find(([code]) => code === values.processCode);
      if (!process) throw new BadRequestException("工序必须是系统标准工序");
      values.processName = process[1];
    }
    if (resource.code === "mps-material-reports") this.validateMaterial(this.toDatabaseRecord(resource, values));
  }

  private async translateDatabaseError<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") throw new ConflictException("相同业务唯一键的记录已存在，请修改原记录");
      if (code === "23503") throw new BadRequestException("关联的上游记录不存在或已失效");
      if (code === "23001") throw new ConflictException("该记录已被下游业务引用，不能直接删除");
      if (code === "23514" || code === "23502" || code === "22P02") throw new BadRequestException("字段值不符合业务规则，请检查必填项、数量、日期和选项");
      throw error;
    }
  }

  private toDatabaseRecord(resource: MasterPlanResource, values: Record<string, unknown>) { const columns = columnsFor(resource); return Object.fromEntries(Object.entries(values).map(([key, value]) => [columns[key], value])); }
  private validateMaterial(row: Record<string, unknown>) { if (row.received === true && !row.actual_inbound_date) throw new BadRequestException("标记主材已入库时必须填写实际入库日期"); }

  private recordAllowed(resource: MasterPlanResource, row: Record<string, unknown>, actor: MasterPlanActor, action: string) {
    if (actor.isSystemAdmin || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("planning")) return true;
    const scopes = actor.tableDataScopes.filter((scope) => scope.resource === resource.code && (!scope.actions || scope.actions.includes(action)));
    if (scopes.some((scope) => scope.scope === "ALL")) return true;
    if (actor.userId && scopes.some((scope) => scope.scope === "OWN") && row.created_by === actor.userId) return true;
    const columns = columnsFor(resource);
    return scopes.filter((scope) => scope.scope === "CUSTOM").some((scope) => {
      const values = (scope.rules ?? []).map((rule) => this.matches(row[columns[String(rule.fieldKey ?? "")]], rule.operator, rule.value === "CURRENT_USER" ? actor.userId : rule.value));
      return values.length > 0 && (scope.match === "ANY" ? values.some(Boolean) : values.every(Boolean));
    });
  }

  private matches(current: unknown, operator: unknown, expected: unknown) {
    const left = String(current ?? ""); const right = String(expected ?? "");
    if (operator === "EQ") return left === right; if (operator === "NE") return left !== right;
    if (operator === "IN") return Array.isArray(expected) && expected.map(String).includes(left);
    if (operator === "NOT_IN") return Array.isArray(expected) && !expected.map(String).includes(left);
    if (operator === "CONTAINS") return left.includes(right); if (operator === "NOT_CONTAINS") return !left.includes(right);
    if (operator === "STARTS_WITH") return left.startsWith(right); if (operator === "IS_EMPTY") return !left.trim(); if (operator === "IS_NOT_EMPTY") return Boolean(left.trim());
    return false;
  }

  private async reconcileAfter(resource: MasterPlanResource, actor: MasterPlanActor) {
    const jobs: Partial<Record<string, string[]>> = {
      "mps-customer-divisions": ["plan-projections"], "mps-order-allocations": ["plan-projections"],
      "mps-monthly-plans": ["shipping-to-base", "base-to-weekly"], "mps-shipping-plans": ["shipping-to-base", "base-to-weekly"],
      "mps-base-plans": ["base-to-weekly"], "mps-process-cycles": ["base-to-weekly"],
      "mps-material-reports": ["execution-rollup"], "mps-outsourcing-reports": ["execution-rollup"], "mps-process-reports": ["execution-rollup"]
    };
    for (const syncKey of jobs[resource.code] ?? []) await this.sync.run(actor.tenantId, syncKey, "EVENT", actor.userId, actor.username, `event:${actor.requestId}:${resource.code}:${syncKey}`);
  }

  private async enforceShippingWindow(resource: MasterPlanResource, actor: MasterPlanActor) {
    if (resource.code !== "mps-shipping-plans") return;
    const rows = await this.dataSource.query(`SELECT setting_key,value_json FROM mps_system_settings WHERE tenant_id=$1 AND setting_key IN ('shipping_edit_weekday','shipping_temporary_unlock_until')`, [actor.tenantId]);
    const settings = new Map(rows.map((row: any) => [row.setting_key, row.value_json]));
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.find((part) => part.type === "weekday")?.value ?? "") + 1;
    const unlockUntil = settings.get("shipping_temporary_unlock_until");
    if (unlockUntil && Date.parse(String(unlockUntil)) > Date.now()) return;
    if (weekday !== Number(settings.get("shipping_edit_weekday") ?? 5)) throw new ForbiddenException("出货计划仅在配置的开放星期可编辑；如需临时调整，请由系统管理员设置临时解锁时间");
  }

  private audit(manager: EntityManager, actor: MasterPlanActor, resource: string, recordId: string | null, action: string, before: unknown, after: unknown) {
    return manager.query(`INSERT INTO audit_logs(actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by) VALUES($1::uuid,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$1::uuid,$10)`, [actor.userId, actor.username, resource, recordId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), actor.requestId, actor.source, actor.userId ?? actor.username]);
  }
}
