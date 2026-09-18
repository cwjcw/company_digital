import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { DataSource, EntityManager } from "typeorm";
import { columnsFor, fieldsFor, MASTER_PLAN_RESOURCE_MAP, type MasterPlanResource } from "./master-plan.config";
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";
import { shanghaiToday, STANDARD_PROCESSES } from "./master-plan.domain";
import { MASTER_PLAN_SYSTEM_USER_ID, MasterPlanSyncService } from "./master-plan.sync.service";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 写入后需要独立对账的同步任务（单一权威映射，enqueue 与反馈共用）。 */
const RECONCILIATION_JOBS: Partial<Record<string, string[]>> = {
  "mps-customer-divisions": ["plan-projections"], "mps-order-allocations": ["plan-projections"],
  "mps-monthly-plans": ["shipping-to-base", "base-to-weekly"], "mps-shipping-plans": ["shipping-to-base", "base-to-weekly"],
  "mps-base-plans": ["base-to-weekly"], "mps-weekly-plans": ["base-to-weekly"], "mps-process-cycles": ["base-to-weekly"],
  "mps-weekly-process-plans": ["execution-rollup"],
  "mps-material-reports": ["execution-rollup"], "mps-outsourcing-reports": ["execution-rollup"], "mps-process-reports": ["execution-rollup"]
};

/**
 * 需要等待对账真实完成后再反馈前端的资源：报工类记录必须等 execution-rollup 重新汇总，
 * 否则前端刚刷新周计划就会读到旧状态。反馈状态由 outbox 行本身决定，不使用定时器猜测。
 */
const RECONCILIATION_FEEDBACK: Partial<Record<string, { syncKey: string; failure: (error: string) => string; pending: string }>> = {
  "mps-base-plans": { syncKey: "base-to-weekly", failure: (error) => `基础计划已保存，但周计划生成失败：${error}`, pending: "基础计划已保存，周计划正在生成，请稍后刷新查看。" },
  "mps-process-reports": { syncKey: "execution-rollup", failure: (error) => `报工已保存，但执行状态同步失败：${error}`, pending: "报工已保存，执行状态正在同步，请稍后刷新查看。" },
  "mps-weekly-process-plans": { syncKey: "execution-rollup", failure: (error) => `工序任务已保存，但执行状态同步失败：${error}`, pending: "工序任务已保存，执行状态正在同步，请稍后刷新查看。" },
  "mps-material-reports": { syncKey: "execution-rollup", failure: (error) => `主材报工已保存，但执行状态同步失败：${error}`, pending: "主材报工已保存，执行状态正在同步，请稍后刷新查看。" },
  "mps-outsourcing-reports": { syncKey: "execution-rollup", failure: (error) => `外协报工已保存，但执行状态同步失败：${error}`, pending: "外协报工已保存，执行状态正在同步，请稍后刷新查看。" }
};

@Injectable()
export class MasterPlanApplicationService {
  constructor(private readonly dataSource: DataSource, private readonly sync: MasterPlanSyncService) {}

  async create(code: string, body: Record<string, unknown>, actor: MasterPlanActor) {
    const resource = this.resource(code);
    this.assertDirectCreateAllowed(resource);
    if (!resource.create || !hasMasterPlanPermission(actor, code, "create")) throw new ForbiddenException("当前权限组没有该表新增权限");
    await this.enforceShippingWindow(resource, actor);
    const values = this.writable(resource, body, actor, "create");
    this.validateRequiredOnCreate(resource, values);
    await this.fillReportSource(resource, values, actor.tenantId);
    /* 来源快照（例如报工所属事业部）由服务端解析后，必须再经业务数据范围校验，不能依赖前端不传越权 ID。 */
    this.assertCreateScope(resource, this.toDatabaseRecord(resource, values), actor);
    this.validateCrossFields(resource, this.toDatabaseRecord(resource, values));
    const result = await this.translateDatabaseError(() => this.dataSource.transaction(async (manager) => {
      const columns = columnsFor(resource); const entries = Object.entries(values);
      if (!entries.length) throw new BadRequestException("没有可写入的业务字段");
      const actorId = actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID;
      const params = [actor.tenantId, actorId, actorId, ...entries.map(([, value]) => value)];
      const inserted = await manager.query(`INSERT INTO ${resource.table}(tenant_id,created_by,updated_by,${entries.map(([field]) => columns[field]).join(",")}) VALUES($1,$2::uuid,$3,${entries.map((_, index) => `$${index + 4}`).join(",")}) RETURNING *`, params);
      await this.audit(manager, actor, code, inserted[0].id, `${code}.created`, null, inserted[0]);
      await this.enqueueReconciliation(manager, resource, actor, inserted[0].id);
      return inserted[0];
    }));
    const reconciliation = await this.completeReconciliation(resource, result.id, actor);
    return reconciliation ? { ...result, reconciliation } : result;
  }

  async update(code: string, id: string, body: Record<string, unknown>, actor: MasterPlanActor) {
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "update")) throw new ForbiddenException("当前权限组没有该表修改权限");
    await this.enforceShippingWindow(resource, actor);
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new BadRequestException("expectedVersion 必须是正整数");
    const values = this.writable(resource, body, actor);
    if (!Object.keys(values).length) throw new BadRequestException("没有可修改的业务字段");
    const result = await this.translateDatabaseError(() => this.dataSource.transaction(async (manager) => {
      const [current] = await manager.query(`SELECT * FROM ${resource.table} WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE`, [actor.tenantId, id]);
      if (!current) throw new NotFoundException("记录不存在");
      if (!this.recordAllowed(resource, current, actor, "update")) throw new ForbiddenException("当前数据范围不允许修改该记录");
      if (Number(current.version) !== expectedVersion) throw new ConflictException("记录已被其他用户修改，请刷新后重试");
      if (resource.code === "mps-shipping-plans" && ("orderNumber" in values || "itemCode" in values)) {
        const [monthly] = await manager.query(`SELECT id FROM mps_monthly_plans WHERE tenant_id=$1 AND order_number=$2 AND item_code=$3`, [actor.tenantId, values.orderNumber ?? current.order_number, values.itemCode ?? current.item_code]);
        values.monthlyPlanId = monthly?.id ?? null;
      }
      if (["mps-weekly-process-plans", "mps-material-reports", "mps-process-reports"].includes(resource.code) && "weeklyPlanId" in values) await this.fillReportSource(resource, values, actor.tenantId, manager);
      this.validateRequiredOnUpdate(resource, values, current);
      this.validateCrossFields(resource, { ...current, ...this.toDatabaseRecord(resource, values) });
      const columns = columnsFor(resource); const entries = Object.entries(values); const params: unknown[] = [actor.tenantId, id, expectedVersion, actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID, ...entries.map(([, value]) => value)];
      const updated = await manager.query(`UPDATE ${resource.table} SET ${entries.map(([field], index) => `${columns[field]}=$${index + 5}`).join(",")},updated_at=now(),updated_by=$4,version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND version=$3 RETURNING *`, params);
      // TypeORM/pg returns UPDATE ... RETURNING as [rows, affectedCount], unlike INSERT/SELECT.
      const updatedRow = Array.isArray(updated[0]) ? updated[0][0] : updated[0];
      if (!updatedRow) throw new ConflictException("记录已被其他用户修改，请刷新后重试");
      await this.audit(manager, actor, code, id, `${code}.updated`, current, updatedRow);
      await this.enqueueReconciliation(manager, resource, actor, id);
      return {
        id: updatedRow.id,
        version: Number(updatedRow.version),
        values: Object.fromEntries(entries.map(([field]) => [field, updatedRow[columns[field]!]]))
      };
    }));
    const reconciliation = await this.completeReconciliation(resource, id, actor);
    return reconciliation ? { ...result, reconciliation } : result;
  }

  async batchUpdate(code: string, body: Record<string, unknown>, actor: MasterPlanActor) {
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "batch_update")) throw new ForbiddenException("当前权限组没有该表批量修改权限");
    await this.enforceShippingWindow(resource, actor);
    const records = Array.isArray(body.records) ? body.records as Array<{ id?: unknown; expectedVersion?: unknown }> : [];
    if (!records.length) throw new BadRequestException("请至少选择一条记录");
    if (records.length > 50_000) throw new BadRequestException("单次最多修改50000条数据");
    const duplicateIds = records.map((record) => String(record.id ?? "")).filter((id, index, all) => all.indexOf(id) !== index);
    if (duplicateIds.length) throw new BadRequestException("选择记录中存在重复ID");
    const fieldKey = String(body.fieldKey ?? "");
    const field = fieldsFor(resource).find((candidate) => candidate.key === fieldKey && candidate.editable);
    if (!field || ["createdBy", "createdAt", "updatedBy", "updatedAt"].includes(fieldKey)) throw new BadRequestException("所选字段不支持批量修改");
    if (!hasMasterPlanFieldPermission(actor, code, fieldKey, "update")) throw new ForbiddenException(`当前权限组不能编辑字段：${field.label}`);
    const value = this.normalize(field.type, body.value, field.label);
    const allowedValues = field.options?.map((option) => option.value);
    if (value != null && allowedValues && !allowedValues.includes(String(value))) throw new BadRequestException(`${field.label}只能选择：${allowedValues.join("、")}`);
    const idempotencyKey = String(body.idempotencyKey ?? "");
    if (!uuidPattern.test(idempotencyKey)) throw new BadRequestException("idempotencyKey 必须使用UUID");
    const storageKey = `mps-batch:${actor.tenantId}:${code}:${actor.userId ?? "system"}:${idempotencyKey}`;
    const requestHash = createHash("sha256").update(JSON.stringify({ records, fieldKey, value })).digest("hex");
    const result = await this.translateDatabaseError(() => this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [storageKey]);
      const [existing] = await manager.query("SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1", [storageKey]);
      if (existing) {
        if (existing.request_hash !== requestHash) throw new ConflictException("相同幂等键不能用于不同的批量修改请求");
        return { ...existing.response_json, repeated: true };
      }
      const validIds = records.map((record) => String(record.id ?? "")).filter((id) => uuidPattern.test(id));
      const currentRows = validIds.length
        ? await manager.query(`SELECT * FROM ${resource.table} WHERE tenant_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE`, [actor.tenantId, validIds])
        : [];
      const currentById = new Map<string, Record<string, unknown>>(currentRows.map((row: Record<string, unknown>) => [String(row.id), row]));
      const columns = columnsFor(resource); const column = columns[fieldKey]!;
      const items: Array<{ id: string; success: boolean; version?: number; reason?: string }> = [];
      for (const requested of records) {
        const id = String(requested.id ?? ""); const expectedVersion = Number(requested.expectedVersion);
        if (!uuidPattern.test(id)) { items.push({ id, success: false, reason: "记录ID格式无效" }); continue; }
        const current = currentById.get(id);
        if (!current) { items.push({ id, success: false, reason: "记录不存在或已超出当前租户" }); continue; }
        if (!this.recordAllowed(resource, current, actor, "batch_update")) { items.push({ id, success: false, reason: "当前数据范围不允许修改该记录" }); continue; }
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || Number(current.version) !== expectedVersion) { items.push({ id, success: false, reason: "记录版本已变化，请刷新后重试" }); continue; }
        try {
          this.validateRequiredOnUpdate(resource, { [fieldKey]: value }, current);
          this.validateCrossFields(resource, { ...current, [column]: value });
        } catch (error) {
          items.push({ id, success: false, reason: error instanceof Error ? error.message : "字段值不符合业务规则" }); continue;
        }
        const updated = await manager.query(`UPDATE ${resource.table} SET ${column}=$4,updated_at=now(),updated_by=$5::uuid,version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND version=$3 RETURNING *`, [actor.tenantId, id, expectedVersion, value, actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID]);
        const updatedRow = Array.isArray(updated[0]) ? updated[0][0] : updated[0];
        if (!updatedRow) { items.push({ id, success: false, reason: "记录版本已变化，请刷新后重试" }); continue; }
        await this.audit(manager, actor, code, id, `${code}.batch_item_updated`, current, updatedRow);
        items.push({ id, success: true, version: Number(updatedRow.version) });
      }
      const response = { batchId: idempotencyKey, submitted: records.length, succeeded: items.filter((item) => item.success).length, failed: items.filter((item) => !item.success).length, fieldKey, items, repeated: false };
      await this.audit(manager, actor, code, null, `${code}.batch_updated`, null, { ...response, idempotencyKey });
      await manager.query("INSERT INTO idempotency_keys(key,request_hash,response_json,created_by,updated_by) VALUES($1,$2,$3::jsonb,$4::uuid,$5)", [storageKey, requestHash, JSON.stringify(response), actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID, actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID]);
      if (response.succeeded > 0) await this.enqueueReconciliation(manager, resource, actor);
      return response;
    }));
    if (result.repeated || !result.succeeded) { void this.sync.processOutbox().catch(() => undefined); return result; }
    const reconciliation = await this.completeReconciliation(resource, null, actor);
    return reconciliation ? { ...result, reconciliation } : result;
  }

  async importUpdates(code: string, rows: Array<{ id: string | null; expectedVersion: number | null; values: Record<string, unknown> }>, fileHash: string, actor: MasterPlanActor) {
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "import")) throw new ForbiddenException("当前权限组没有该表导入权限");
    await this.enforceShippingWindow(resource, actor);
    if (!rows.length || rows.length > 50_000) throw new BadRequestException("导入数据必须为1至50000行");
    const storageKey = `mps-import:${actor.tenantId}:${code}:${actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID}:${fileHash}`;
    const result = await this.translateDatabaseError(() => this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [storageKey]);
      const [existing] = await manager.query("SELECT response_json FROM idempotency_keys WHERE key=$1", [storageKey]);
      if (existing) return { ...existing.response_json, repeated: true };
      const actorId = actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID;
      const shippingMonthlyPlanIds = await this.shippingMonthlyPlanIds(resource, rows, actor.tenantId, manager);
      let createdCount = 0; let updatedCount = 0;
      for (const input of rows) {
        const creating = input.id == null && input.expectedVersion == null;
        if ((input.id == null) !== (input.expectedVersion == null)) throw new BadRequestException("新增时记录ID和版本都应留空；更新时必须同时填写");
        if (creating) {
          this.assertDirectCreateAllowed(resource);
          if (!resource.create || !hasMasterPlanPermission(actor, code, "create")) throw new ForbiddenException("当前权限组没有该表新增权限，不能导入新增记录");
          const values = this.writable(resource, input.values, actor, "create");
          this.validateRequiredOnCreate(resource, values);
          await this.fillReportSource(resource, values, actor.tenantId, manager, shippingMonthlyPlanIds);
          this.assertCreateScope(resource, this.toDatabaseRecord(resource, values), actor);
          this.validateCrossFields(resource, this.toDatabaseRecord(resource, values));
          const columns = columnsFor(resource); const entries = Object.entries(values);
          if (!entries.length) throw new BadRequestException("新增导入没有可写入的业务字段");
          const params: unknown[] = [actor.tenantId, actorId, ...entries.map(([, value]) => value)];
          const inserted = await manager.query(`INSERT INTO ${resource.table}(tenant_id,created_by,updated_by,${entries.map(([field]) => columns[field]).join(",")}) VALUES($1,$2::uuid,$2::uuid,${entries.map((_, index) => `$${index + 3}`).join(",")}) RETURNING *`, params);
          await this.audit(manager, actor, code, inserted[0].id, `${code}.import_created`, null, inserted[0]);
          createdCount++;
          continue;
        }
        if (!uuidPattern.test(input.id!) || !Number.isInteger(input.expectedVersion) || input.expectedVersion! < 1) throw new BadRequestException("导入文件包含无效的记录ID或版本");
        const [current] = await manager.query(`SELECT * FROM ${resource.table} WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE`, [actor.tenantId, input.id]);
        if (!current) throw new BadRequestException(`记录不存在或已超出当前租户：${input.id}`);
        if (!this.recordAllowed(resource, current, actor, "import")) throw new ForbiddenException(`当前数据范围不允许导入修改记录：${input.id}`);
        if (Number(current.version) !== input.expectedVersion) throw new ConflictException(`记录版本已变化，请重新导出后导入：${input.id}`);
        const values = this.writable(resource, input.values, actor);
        if (["mps-weekly-process-plans", "mps-material-reports", "mps-process-reports"].includes(resource.code) && "weeklyPlanId" in values) await this.fillReportSource(resource, values, actor.tenantId, manager);
        if (resource.code === "mps-shipping-plans" && ("orderNumber" in values || "itemCode" in values)) {
          values.monthlyPlanId = shippingMonthlyPlanIds.get(this.monthlyPlanKey(values.orderNumber ?? current.order_number, values.itemCode ?? current.item_code)) ?? null;
        }
        if (!Object.keys(values).length) continue;
        const columns = columnsFor(resource); const entries = Object.entries(values);
        const databaseValues = this.toDatabaseRecord(resource, values);
        this.validateRequiredOnUpdate(resource, values, current);
        this.validateCrossFields(resource, { ...current, ...databaseValues });
        const params: unknown[] = [actor.tenantId, input.id, input.expectedVersion, actorId, ...entries.map(([, value]) => value)];
        const updated = await manager.query(`UPDATE ${resource.table} SET ${entries.map(([field], index) => `${columns[field]}=$${index + 5}`).join(",")},updated_at=now(),updated_by=$4::uuid,version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND version=$3 RETURNING *`, params);
        const updatedRow = Array.isArray(updated[0]) ? updated[0][0] : updated[0];
        if (!updatedRow) throw new ConflictException(`记录版本已变化，请重新导出后导入：${input.id}`);
        await this.audit(manager, actor, code, input.id, `${code}.import_updated`, current, updatedRow);
        updatedCount++;
      }
      const response = { total: rows.length, created: createdCount, updated: updatedCount, repeated: false };
      await this.audit(manager, actor, code, null, `${code}.import_confirmed`, null, { ...response, fileHash });
      await manager.query("INSERT INTO idempotency_keys(key,request_hash,response_json,created_by,updated_by) VALUES($1,$2,$3::jsonb,$4::uuid,$4::uuid)", [storageKey, fileHash, JSON.stringify(response), actorId]);
      if (createdCount || updatedCount) await this.enqueueReconciliation(manager, resource, actor);
      return response;
    }));
    if (result.repeated || !(result.created + result.updated)) { void this.sync.processOutbox().catch(() => undefined); return result; }
    const reconciliation = await this.completeReconciliation(resource, null, actor);
    return reconciliation ? { ...result, reconciliation } : result;
  }

  async validateImportUpdates(code: string, rows: Array<{ row: number; id: string | null; expectedVersion: number | null; values: Record<string, unknown> }>, actor: MasterPlanActor) {
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "import")) throw new ForbiddenException("当前权限组没有该表导入权限");
    const errors: Array<{ row: number; reason: string }> = [];
    const seen = new Set<string>(); const seenBusinessKeys = new Set<string>();
    for (const input of rows) {
      try {
        const creating = input.id == null && input.expectedVersion == null;
        if ((input.id == null) !== (input.expectedVersion == null)) throw new BadRequestException("新增时记录ID和版本都应留空；更新时必须同时填写");
        if (creating) {
          this.assertDirectCreateAllowed(resource);
          if (!resource.create || !hasMasterPlanPermission(actor, code, "create")) throw new ForbiddenException("当前权限组没有该表新增权限，不能导入新增记录");
          const values = this.writable(resource, input.values, actor, "create");
          this.validateRequiredOnCreate(resource, values);
          await this.fillReportSource(resource, values, actor.tenantId);
          this.assertCreateScope(resource, this.toDatabaseRecord(resource, values), actor);
          this.validateCrossFields(resource, this.toDatabaseRecord(resource, values));
          const businessKey = this.businessKey(resource, values);
          if (businessKey && seenBusinessKeys.has(businessKey)) throw new BadRequestException("文件中存在重复业务记录");
          if (businessKey) {
            seenBusinessKeys.add(businessKey);
            if (await this.businessRecordExists(resource, values, actor.tenantId)) throw new ConflictException("相同业务记录已存在；如需更新，请先导出并保留记录ID和版本");
          }
          continue;
        }
        if (!uuidPattern.test(input.id!)) throw new BadRequestException("记录ID格式无效");
        if (seen.has(input.id!)) throw new BadRequestException("记录ID重复");
        seen.add(input.id!);
        if (!Number.isInteger(input.expectedVersion) || input.expectedVersion! < 1) throw new BadRequestException("版本必须为正整数");
        const [current] = await this.dataSource.query(`SELECT * FROM ${resource.table} WHERE tenant_id=$1 AND id=$2::uuid`, [actor.tenantId, input.id]);
        if (!current) throw new BadRequestException("记录不存在或已超出当前租户");
        if (!this.recordAllowed(resource, current, actor, "import")) throw new ForbiddenException("当前数据范围不允许修改该记录");
        if (Number(current.version) !== input.expectedVersion) throw new ConflictException("记录版本已变化，请重新导出");
        const values = this.writable(resource, input.values, actor);
        if (["mps-weekly-process-plans", "mps-material-reports", "mps-process-reports"].includes(resource.code) && "weeklyPlanId" in values) await this.fillReportSource(resource, values, actor.tenantId);
        this.validateRequiredOnUpdate(resource, values, current);
        const mergedValues = this.completeValues(resource, current, values);
        this.validateCrossFields(resource, { ...current, ...this.toDatabaseRecord(resource, values) });
        if (resource.uniqueKeyFields?.some((field) => field in values) && await this.businessRecordExists(resource, mergedValues, actor.tenantId, this.dataSource.manager, input.id!)) throw new ConflictException("修改后的业务唯一键与现有记录重复");
      } catch (error) { errors.push({ row: input.row, reason: error instanceof Error ? error.message : "数据校验失败" }); }
    }
    return errors;
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
      await this.enqueueReconciliation(manager, resource, actor, id);
      return { id, deleted: true };
    }));
    /* 删除实际报工后同样必须重新汇总，前端依据真实对账状态刷新周计划。 */
    const reconciliation = await this.completeReconciliation(resource, id, actor);
    return reconciliation ? { ...result, reconciliation } : result;
  }

  private resource(code: string) { const resource = MASTER_PLAN_RESOURCE_MAP.get(code as any); if (!resource) throw new NotFoundException("主计划表不存在"); return resource; }
  private assertDirectCreateAllowed(resource: MasterPlanResource) {
    if (resource.code === "mps-weekly-plans") throw new BadRequestException("事业部周计划只能由事业部基础计划生成。");
    /* KN-MPS-WO-001：3天生产工单只能由“从周计划同步”生成，普通新增与 Excel 新增都必须拒绝。 */
    if (resource.code === "mps-three-day-work-orders") throw new BadRequestException("3天生产工单不能通过Excel新增，请先在系统点击“从周计划同步”。");
  }
  private label(resource: MasterPlanResource, key: string) { return fieldsFor(resource).find((field) => field.key === key)?.label ?? key; }

  private writable(resource: MasterPlanResource, body: Record<string, unknown>, actor: MasterPlanActor, action: "create" | "update" = "update") {
    /* 身份字段（createOnlyFields）只在新增时可写，记录生成后不再接受普通修改。 */
    const allowed = new Map(fieldsFor(resource)
      .filter((field) => field.editable || (action === "create" && (field as { createOnly?: boolean }).createOnly))
      .map((field) => [field.key, field]));
    const output: Record<string, unknown> = {};
    for (const [field, raw] of Object.entries(body)) {
      if (["expectedVersion", "id", "version", "createdBy", "createdAt", "updatedBy", "updatedAt", "tenantId"].includes(field)) continue;
      const definition = allowed.get(field); if (!definition) throw new BadRequestException(`字段 ${field} 不允许写入`);
      const canWrite = hasMasterPlanFieldPermission(actor, resource.code, field, "update")
        || (action === "create" && (hasMasterPlanFieldPermission(actor, resource.code, field, "read") || !hasMasterPlanPermission(actor, resource.code, "read")));
      if (!canWrite) throw new ForbiddenException(`当前权限组不能填写字段：${definition.label}`);
      output[field] = this.normalize(definition.type, raw, definition.label);
      const allowedValues = definition.options?.map((option) => option.value);
      if (output[field] != null && allowedValues && !allowedValues.includes(String(output[field]))) throw new BadRequestException(`${definition.label}只能选择：${allowedValues.join("、")}`);
    }
    return output;
  }

  private validateRequiredOnCreate(resource: MasterPlanResource, values: Record<string, unknown>) {
    for (const field of resource.requiredOnCreate ?? []) {
      if (values[field] == null || values[field] === "") throw new BadRequestException(`${this.label(resource, field)}不能为空`);
    }
  }

  private validateRequiredOnUpdate(resource: MasterPlanResource, values: Record<string, unknown>, current: Record<string, unknown>) {
    const columns = columnsFor(resource);
    for (const field of new Set(resource.requiredOnUpdate ?? [...(resource.requiredOnCreate ?? []), ...(resource.requiredAlways ?? [])])) {
      const value = Object.prototype.hasOwnProperty.call(values, field) ? values[field] : current[columns[field]];
      if (value == null || value === "") throw new BadRequestException(`${this.label(resource, field)}不能为空`);
    }
  }

  private completeValues(resource: MasterPlanResource, current: Record<string, unknown>, values: Record<string, unknown>) {
    const columns = columnsFor(resource);
    return Object.fromEntries(fieldsFor(resource).map((field) => [field.key, Object.prototype.hasOwnProperty.call(values, field.key) ? values[field.key] : current[columns[field.key]]]));
  }

  private businessKey(resource: MasterPlanResource, values: Record<string, unknown>) {
    if (!resource.uniqueKeyFields?.length) return null;
    return resource.uniqueKeyFields.map((field) => `${field}:${String(values[field] ?? "")}`).join("\u0000");
  }

  private async businessRecordExists(resource: MasterPlanResource, values: Record<string, unknown>, tenantId: string, manager: Pick<EntityManager, "query"> = this.dataSource.manager, excludeId?: string) {
    if (!resource.uniqueKeyFields?.length) return false;
    const columns = columnsFor(resource);
    const params: unknown[] = [tenantId, ...resource.uniqueKeyFields.map((field) => values[field] ?? null)];
    const predicates = resource.uniqueKeyFields.map((field, index) => `${columns[field]} IS NOT DISTINCT FROM $${index + 2}`);
    if (excludeId) { params.push(excludeId); predicates.push(`id<>$${params.length}::uuid`); }
    const [existing] = await manager.query(`SELECT id FROM ${resource.table} WHERE tenant_id=$1 AND ${predicates.join(" AND ")} LIMIT 1`, params);
    return Boolean(existing);
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

  private monthlyPlanKey(orderNumber: unknown, itemCode: unknown) { return `${String(orderNumber ?? "")}\u0000${String(itemCode ?? "")}`; }

  private async shippingMonthlyPlanIds(resource: MasterPlanResource, rows: Array<{ values: Record<string, unknown> }>, tenantId: string, manager: Pick<EntityManager, "query">) {
    const result = new Map<string, string>();
    if (resource.code !== "mps-shipping-plans") return result;
    const pairs = rows.map((row) => ({ orderNumber: row.values.orderNumber, itemCode: row.values.itemCode }))
      .filter((pair) => pair.orderNumber != null && pair.itemCode != null);
    if (!pairs.length) return result;
    const monthlyRows = await manager.query(`SELECT id,order_number,item_code FROM mps_monthly_plans
      WHERE tenant_id=$1 AND (order_number,item_code) IN (SELECT * FROM unnest($2::text[],$3::text[]))`, [tenantId, pairs.map((pair) => String(pair.orderNumber)), pairs.map((pair) => String(pair.itemCode))]);
    for (const row of monthlyRows) result.set(this.monthlyPlanKey(row.order_number, row.item_code), row.id);
    return result;
  }

  private async fillReportSource(resource: MasterPlanResource, values: Record<string, unknown>, tenantId: string, manager: Pick<EntityManager, "query"> = this.dataSource.manager, shippingMonthlyPlanIds?: Map<string, string>) {
    if (resource.code === "mps-shipping-plans") {
      if (shippingMonthlyPlanIds) values.monthlyPlanId = shippingMonthlyPlanIds.get(this.monthlyPlanKey(values.orderNumber, values.itemCode)) ?? null;
      else {
        const [monthly] = await manager.query(`SELECT id FROM mps_monthly_plans WHERE tenant_id=$1 AND order_number=$2 AND item_code=$3`, [tenantId, values.orderNumber, values.itemCode]);
        values.monthlyPlanId = monthly?.id ?? null;
      }
    }
    if (resource.code === "mps-weekly-plans") values.pendingQuantity = values.plannedQuantity;
    if (!["mps-weekly-process-plans", "mps-material-reports", "mps-process-reports"].includes(resource.code)) return;
    const weeklyPlanId = String(values.weeklyPlanId ?? ""); if (!uuidPattern.test(weeklyPlanId)) throw new BadRequestException("请选择有效的周计划");
    const [weekly] = await manager.query(`SELECT division_id,order_number,item_code,item_name,delivery_number,planned_quantity,manufacturing_method FROM mps_weekly_plans WHERE tenant_id=$1 AND id=$2::uuid`, [tenantId, weeklyPlanId]);
    if (!weekly) throw new BadRequestException("周计划不存在");
    if (["mps-weekly-process-plans", "mps-process-reports"].includes(resource.code) && !["自制", "自制+外协"].includes(weekly.manufacturing_method)) throw new BadRequestException("当前生产方式不允许创建工序任务或工序报工");
    if (resource.code === "mps-weekly-process-plans") {
      const index = STANDARD_PROCESSES.findIndex(([code]) => code === values.processCode);
      if (index < 0) throw new BadRequestException("工序必须是系统标准工序");
      values.processName = STANDARD_PROCESSES[index]![1];
      values.sequence = index + 1;
      values.reportDate ??= shanghaiToday();
      return;
    }
    Object.assign(values, { divisionId: weekly.division_id, orderNumber: weekly.order_number, itemCode: weekly.item_code, itemName: weekly.item_name, deliveryNumber: weekly.delivery_number });
    if (resource.code === "mps-process-reports") {
      values.plannedQuantity = weekly.planned_quantity;
      const process = STANDARD_PROCESSES.find(([code]) => code === values.processCode);
      if (!process) throw new BadRequestException("工序必须是系统标准工序");
      values.processName = process[1];
    }
    this.validateCrossFields(resource, this.toDatabaseRecord(resource, values));
  }

  private async translateDatabaseError<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") throw new ConflictException("相同业务唯一键的记录已存在，请修改原记录");
      if (code === "23503") throw new BadRequestException("关联的上游记录不存在或已失效");
      if (code === "23001") throw new ConflictException("该记录已被下游业务引用，不能直接删除");
      if (code === "23502") throw new BadRequestException(`必填字段${(error as { column?: string }).column ? ` ${(error as { column?: string }).column}` : ""}不能为空`);
      if (code === "23514") throw new BadRequestException("字段值不符合业务约束，请检查数量范围、选项及跨字段条件");
      if (code === "22003") throw new BadRequestException("数值超出数据库允许范围，请检查数字大小或小数格式");
      if (code === "22001") throw new BadRequestException("文本内容超过字段允许长度");
      if (["22P02", "22007", "22008"].includes(String(code))) throw new BadRequestException("字段类型或日期格式无效，请检查输入值");
      throw error;
    }
  }

  private toDatabaseRecord(resource: MasterPlanResource, values: Record<string, unknown>) { const columns = columnsFor(resource); return Object.fromEntries(Object.entries(values).map(([key, value]) => [columns[key], value])); }
  private validateCrossFields(resource: MasterPlanResource, row: Record<string, unknown>) {
    if (resource.code === "mps-material-reports" && row.received === true && !row.actual_inbound_date) throw new BadRequestException("标记主材已入库时必须填写实际入库日期");
    if (resource.code === "mps-outsourcing-reports" && row.received === true && !row.actual_inbound_date) throw new BadRequestException("标记外协已入库时必须填写实际入库日期");
    /*
     * KN-MPS-WO-001：生产日期是两个原子字段组成的日期范围。
     * 允许两者都为空（刚同步还没排产），但必须同时有值或同时为空，且开始不得晚于结束。
     * 只在这里做服务端校验：网页、PATCH、批量修改与 Excel 导入都复用同一规则（不额外增加时长上限）。
     */
    if (resource.code === "mps-three-day-work-orders") {
      const start = this.dateText(row.production_start_date);
      const end = this.dateText(row.production_end_date);
      if ((start == null) !== (end == null)) throw new BadRequestException("生产开始日期和生产结束日期必须同时填写或同时留空");
      if (start && end && start > end) throw new BadRequestException("生产结束日期不能早于生产开始日期");
    }
  }

  /** 只保留 YYYY-MM-DD 日期部分（date 列在 pg 驱动下可能是 Date 或字符串）。 */
  private dateText(value: unknown) {
    if (value == null || value === "") return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const text = String(value).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
  }

  async importBlockedReason(code: string, actor: MasterPlanActor) {
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "import")) throw new ForbiddenException("当前权限组没有该表导入权限");
    try { await this.enforceShippingWindow(resource, actor); return null; }
    catch (error) {
      if (resource.code === "mps-shipping-plans" && error instanceof ForbiddenException) return "数据校验通过，但当前不在出货计划开放修改时间，暂不能确认导入。";
      throw error;
    }
  }

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

  /**
   * 新增时的业务数据范围校验（含服务端解析出的 sourcesnapshot，例如报工所属事业部）：
   * - 未为该表配置任何数据范围：保持既有“可新增”行为；
   * - ALL：全部允许；NONE（例如“仅添加数据”预置组）：按只填报语义允许新增；
   * - OWN：新增记录创建人即当前用户，允许；
   * - CUSTOM：必须按条件命中，否则拒绝，防止伪造 weeklyPlanId 向无权事业部报工。
   */
  private assertCreateScope(resource: MasterPlanResource, row: Record<string, unknown>, actor: MasterPlanActor) {
    if (actor.isSystemAdmin || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("planning")) return;
    const scopes = actor.tableDataScopes.filter((scope) => scope.resource === resource.code && (!scope.actions || scope.actions.includes("create")));
    if (!scopes.length) return;
    if (scopes.some((scope) => scope.scope === "ALL" || scope.scope === "NONE")) return;
    if (actor.userId && scopes.some((scope) => scope.scope === "OWN")) return;
    const columns = columnsFor(resource);
    const permitted = scopes.filter((scope) => scope.scope === "CUSTOM").some((scope) => {
      const matches = (scope.rules ?? []).map((rule) => this.matches(row[columns[String(rule.fieldKey ?? "")]], rule.operator, rule.value === "CURRENT_USER" ? actor.userId : rule.value));
      return matches.length > 0 && (scope.match === "ANY" ? matches.some(Boolean) : matches.every(Boolean));
    });
    if (!permitted) throw new ForbiddenException("当前数据范围不允许在该事业部新增记录");
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

  private async enqueueReconciliation(manager: EntityManager, resource: MasterPlanResource, actor: MasterPlanActor, recordId: string | null = null) {
    const actorId = actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID;
    for (const syncKey of RECONCILIATION_JOBS[resource.code] ?? []) await manager.query(`
      INSERT INTO mps_reconciliation_outbox(tenant_id,resource,record_id,sync_key,idempotency_key,actor_id,actor_name,created_by,updated_by)
      VALUES($1,$2,$3::uuid,$4,$5,$6::uuid,$7,$6::uuid,$6::uuid)
      ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
    [actor.tenantId, resource.code, recordId, syncKey, `outbox:${actor.requestId}:${resource.code}:${syncKey}`, actorId, actor.username]);
  }

  private async completeReconciliation(resource: MasterPlanResource, recordId: string | null, actor: MasterPlanActor) {
    const feedback = RECONCILIATION_FEEDBACK[resource.code];
    if (!feedback) { void this.sync.processOutbox().catch(() => undefined); return undefined; }
    try { await this.sync.processOutbox(); } catch { /* The committed business write remains successful; the outbox will retry. */ }
    const [event] = await this.dataSource.query(`SELECT status,last_error FROM mps_reconciliation_outbox WHERE tenant_id=$1 AND resource=$2 AND record_id IS NOT DISTINCT FROM $3::uuid AND sync_key=$4 AND idempotency_key=$5`,
      [actor.tenantId, resource.code, recordId, feedback.syncKey, `outbox:${actor.requestId}:${resource.code}:${feedback.syncKey}`]);
    if (!event) return undefined;
    if (event.status === "FAILED") return { status: "FAILED", message: feedback.failure(event.last_error || "系统将自动重试") };
    if (event.status === "SUCCESS") return { status: "SUCCESS", message: null };
    /* The write is committed; a pending or in-flight reconciliation must never be reported as success or failure. */
    return { status: String(event.status), message: feedback.pending };
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
    const actorId = actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID;
    return manager.query(`INSERT INTO audit_logs(actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by) VALUES($1::uuid,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$1::uuid,$1::uuid)`, [actorId, actor.username, resource, recordId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), actor.requestId, actor.source]);
  }
}
