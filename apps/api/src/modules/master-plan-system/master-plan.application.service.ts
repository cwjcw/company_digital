import { mpsQuantityBatchFields } from '@kdos/contracts';
import { demandLinksReady, linkNewDemandRecord } from "./master-plan.demand-links";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { allocationChange, allocationSnapshot, allocationColumn, ALLOCATION_FIELDS, allocationVendorRequiredDivisionName, allocationVendorTargetError, type AllocationChange } from "./order-allocation.domain";
import { ALLOCATION_EVENT, ALLOCATION_RULE_KEY } from "./order-allocation-config.service";
import Decimal from "decimal.js";
import { DataSource, EntityManager } from "typeorm";
import { columnsFor, fieldsFor, MASTER_PLAN_RESOURCE_MAP, type MasterPlanResource } from "./master-plan.config";
import { hasMasterPlanFieldPermission, hasMasterPlanPermission, type MasterPlanActor } from "./master-plan.types";
import { shanghaiToday, shouldEnableProcess, STANDARD_PROCESSES } from "./master-plan.domain";
import { assertShippingEditAllowed, normalizeShippingEditWeekday } from "./master-plan.shipping-window";
import { MASTER_PLAN_SYSTEM_USER_ID, MasterPlanSyncService } from "./master-plan.sync.service";
import { NotificationService } from "../notifications/notification.service";
import { nextMasterPlanDeliveryCode } from "./master-plan.delivery-code";
import { reconcileAllocationPlans, ensureNewAllocationDemand, allocationProjectionCandidatesSql } from "./master-plan.allocation-projection";
import { reconcileMonthlyBasePlans } from "./master-plan.monthly-base";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESIDUAL_TARGET_DIVISION_ID = "6eec4f66-aab5-46ec-9245-b1d490d6812d";
type ResidualAllocationChange = { id: string; expectedVersion: number; action: "UPDATE" | "ARCHIVE" | "RESTORE"; divisionId?: string; allocatedQuantity?: string | number; archiveBatchId?: string };
type ResidualMonthlyChange = { id: string; expectedVersion: number; divisionId?: string; requiredQuantity?: string | number };
type ResidualBaseChange = { id: string; expectedVersion: number; divisionId?: string; plannedQuantity?: string | number };
type ResidualZeroBaseKey = { orderNumber: string; itemCode: string; divisionId: string };

/** 写入后需要独立对账的同步任务（单一权威映射，enqueue 与反馈共用）。 */
const RECONCILIATION_JOBS: Partial<Record<string, string[]>> = {
  "mps-customer-divisions": ["plan-projections"], "mps-order-allocations": ["plan-projections"],
  "mps-monthly-plans": ["shipping-to-base", "base-to-weekly"], "mps-shipping-plans": [],
  "mps-base-plans": ["base-to-weekly"], "mps-weekly-plans": ["base-to-weekly"], "mps-process-cycles": ["base-to-weekly"],
  "mps-weekly-process-plans": ["execution-rollup"],
  "mps-material-reports": ["execution-rollup"], "mps-outsourcing-reports": ["execution-rollup"], "mps-process-reports": ["execution-rollup"]
};

/**
 * 需要等待对账真实完成后再反馈前端的资源：报工类记录必须等 execution-rollup 重新汇总，
 * 否则前端刚刷新周计划就会读到旧状态。反馈状态由 outbox 行本身决定，不使用定时器猜测。
 */
const RECONCILIATION_FEEDBACK: Partial<Record<string, { syncKey: string; failure: (error: string) => string; pending: string }>> = {
  "mps-order-allocations": { syncKey: "plan-projections", failure: (error) => `订单分配已保存，但计划生成失败：${error}`, pending: "订单分配已保存，集团/月度计划正在生成，请稍后刷新查看。" },
  "mps-base-plans": { syncKey: "base-to-weekly", failure: (error) => `基础计划已保存，但周计划生成失败：${error}`, pending: "基础计划已保存；符合准入条件的记录正在同步。缺少项可查看“周计划缺失字段”，补齐后自动生成。" },
  "mps-process-reports": { syncKey: "execution-rollup", failure: (error) => `报工已保存，但执行状态同步失败：${error}`, pending: "报工已保存，执行状态正在同步，请稍后刷新查看。" },
  "mps-weekly-process-plans": { syncKey: "execution-rollup", failure: (error) => `工序任务已保存，但执行状态同步失败：${error}`, pending: "工序任务已保存，执行状态正在同步，请稍后刷新查看。" },
  "mps-material-reports": { syncKey: "execution-rollup", failure: (error) => `主材报工已保存，但执行状态同步失败：${error}`, pending: "主材报工已保存，执行状态正在同步，请稍后刷新查看。" },
  "mps-outsourcing-reports": { syncKey: "execution-rollup", failure: (error) => `外协报工已保存，但执行状态同步失败：${error}`, pending: "外协报工已保存，执行状态正在同步，请稍后刷新查看。" }
};

/** 改动这些周计划字段会改变工序/外协任务准入、排期或计划上下文；备注等无关字段不触发重算。 */
const WEEKLY_EXECUTION_REFRESH_FIELDS = new Set([
  "divisionId", "orderNumber", "itemCode", "itemName", "deliveryNumber",
  "latestReviewDueDate", "plannedQuantity", "manufacturingMethod"
]);

const SHIPPING_PLAN_KEY_FIELDS = [
  { key: "orderNumber", column: "order_number", label: "订单编号", kind: "text" },
  { key: "itemCode", column: "item_code", label: "品项编码", kind: "text" },
  { key: "latestCustomerDueDate", column: "latest_customer_due_date", label: "最迟客户交期", kind: "date" },
  { key: "plannedQuantity", column: "planned_quantity", label: "计划数量", kind: "number" },
  { key: "divisionId", column: "division_id", label: "承接事业部", kind: "division" }
] as const;
const SHIPPING_PLAN_KEY_FIELDS_CHANGED_EVENT = "shipping_plan.key_fields_changed";

@Injectable()
export class MasterPlanApplicationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sync: MasterPlanSyncService,
    @Optional() private readonly notifications?: NotificationService
  ) {}

  /** Quantity allocation uses the same field permissions, types and dictionaries as ordinary creation. */
  quantityBatchContext(body: Record<string, unknown>, actor: MasterPlanActor) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !(mpsQuantityBatchFields as readonly string[]).includes(k))) throw new BadRequestException('新批次属性仅允许指定获权的计划日期和生产属性');
    const def = MASTER_PLAN_RESOURCE_MAP.get('mps-base-plans')!;
    return this.toDatabaseRecord(def, this.writable(def, body, actor, 'create'));
  }

  /** Dashboard export writes only its audit record, through the existing Application boundary. */
  async recordDashboardExport(summary: { tableKey: string; rowCount: number; fields: string[] }, actor: MasterPlanActor) {
    const resource = "mps-overview-dashboard";
    if (!["read", "export"].every(action => hasMasterPlanPermission(actor, resource, action))) throw new ForbiddenException("当前权限组没有主计划综合大屏导出权限");
    return this.dataSource.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      await this.audit(manager, actor, resource, null, `${resource}.exported`, null, summary);
    });
  }

  /** Read-only order-progress exports record their audit through an Application command. */
  async recordOrderProgressExport(summary: { tableKey: string; rowCount: number; fields: string[] }, actor: MasterPlanActor) {
    const resource = "mps-order-progress-dashboard";
    if (!["read", "export"].every(action => hasMasterPlanPermission(actor, resource, action))) throw new ForbiddenException("没有在制订单进度导出权限");
    return this.dataSource.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      await this.audit(manager, actor, resource, null, `${resource}.exported`, null, summary);
    });
  }

  /** One-off administrator command; no employee UI/delete permission is introduced. */
  async archiveAllocations(records: Array<{ id: string; expectedVersion: number }>, idempotencyKey: string, actor: MasterPlanActor) {
    if (actor.isSystemAdmin !== true || !actor.userId || !actor.tenantId) throw new ForbiddenException("仅系统管理员可以归档清空订单分配表");
    if (!uuidPattern.test(idempotencyKey) || !Array.isArray(records) || records.length > 50_000
      || records.some((row) => !uuidPattern.test(row.id) || !Number.isInteger(row.expectedVersion) || row.expectedVersion < 1)
      || new Set(records.map((row) => row.id)).size !== records.length) throw new BadRequestException("归档快照或幂等键无效");
    const ordered = [...records].sort((a, b) => a.id.localeCompare(b.id));
    const requestHash = createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
    const storageKey = `mps-archive:${actor.tenantId}:${idempotencyKey}`;
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [storageKey]);
      const [existing] = await manager.query("SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1", [storageKey]);
      if (existing) {
        if (existing.request_hash !== requestHash) throw new ConflictException("相同幂等键不能用于不同归档快照");
        return { ...existing.response_json, repeated: true };
      }
      // Preview confirmations lock previews before writing allocations; retain the same lock order.
      await manager.query("SET LOCAL lock_timeout='10s'");
      await manager.query("LOCK TABLE mps_import_previews,mps_order_allocations IN SHARE ROW EXCLUSIVE MODE");
      const current = await manager.query("SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND archived_at IS NULL ORDER BY id FOR UPDATE", [actor.tenantId]);
      const versions = new Map(ordered.map((row) => [row.id, row.expectedVersion]));
      if (current.length !== ordered.length || current.some((row: Record<string, unknown>) => versions.get(String(row.id)) !== Number(row.version))) {
        throw new ConflictException("订单分配记录已变化，请重新核实归档快照");
      }
      const [clock] = await manager.query("SELECT now() AS archived_at");
      if (current.length) await manager.query(`UPDATE mps_order_allocations SET archived_at=$2,updated_at=$2,updated_by=$3::uuid,version=version+1
        WHERE tenant_id=$1 AND archived_at IS NULL`, [actor.tenantId, clock.archived_at, actor.userId]);
      const expired = await manager.query(`UPDATE mps_import_previews SET expires_at=now(),updated_at=now(),updated_by=$2::uuid,version=version+1
        WHERE tenant_id=$1 AND resource='mps-order-allocations' AND confirmed_at IS NULL AND expires_at>now() RETURNING id`, [actor.tenantId, actor.userId]);
      for (const row of current) await this.audit(manager, actor, "mps-order-allocations", row.id, "mps-order-allocations.archived", row,
        { archived: true, archiveBatchId: idempotencyKey, archivedAt: clock.archived_at, version: Number(row.version) + 1 });
      const response = { archived: current.length, expiredPreviews: Array.isArray(expired[0]) ? expired[0].length : expired.length,
        archiveBatchId: idempotencyKey, archivedAt: clock.archived_at, repeated: false };
      await this.audit(manager, actor, "mps-order-allocations", null, "mps-order-allocations.archive_completed", null, response);
      await manager.query("INSERT INTO idempotency_keys(key,request_hash,response_json,created_by,updated_by) VALUES($1,$2,$3::jsonb,$4::uuid,$4::uuid)",
        [storageKey, requestHash, JSON.stringify(response), actor.userId]);
      // Archival preserves plan references and deliberately emits neither allocation messages nor reconciliation.
      return response;
    });
  }

  /**
   * Audited, atomic close-out command for the confirmed 2026-11-03 Division 3 source workbook.
   * It deliberately accepts only Division 3 as the destination, checks all row versions,
   * protects stock/shipping/execution facts, and runs the existing projection services in
   * the same transaction. This is not a general-purpose bulk editor.
   */
  async finalizeDivisionThreeResidual(input: {
    idempotencyKey: string;
    allocationChanges: ResidualAllocationChange[];
    monthlyChanges: ResidualMonthlyChange[];
    baseChanges: ResidualBaseChange[];
    zeroQuantityBaseKeys: ResidualZeroBaseKey[];
    groupPlanAliases?: Array<{sourceOrderNumber:string;targetOrderNumber:string}>;
    resolveStaleDemandExceptionIds?: string[];
  }, actor: MasterPlanActor) {
    if (actor.isSystemAdmin !== true || !actor.userId || !actor.tenantId) throw new ForbiddenException("仅系统管理员可以执行事业三部收尾命令");
    const actorId=actor.userId;
    if (!input || !Array.isArray(input.allocationChanges) || !Array.isArray(input.monthlyChanges)
      || !Array.isArray(input.baseChanges) || !Array.isArray(input.zeroQuantityBaseKeys)
      || (input.groupPlanAliases !== undefined && !Array.isArray(input.groupPlanAliases))
      || (input.resolveStaleDemandExceptionIds !== undefined && !Array.isArray(input.resolveStaleDemandExceptionIds))) throw new BadRequestException("收尾命令参数格式无效");
    const allocations = input.allocationChanges, monthly = input.monthlyChanges, bases = input.baseChanges, zeroKeys = input.zeroQuantityBaseKeys;
    const requestedAliases = input.groupPlanAliases ?? [];
    const staleDemandExceptionIds = input.resolveStaleDemandExceptionIds ?? [];
    const rows = [...allocations, ...monthly, ...bases];
    if (!input || !uuidPattern.test(input.idempotencyKey) || rows.length === 0 || rows.length > 200 || zeroKeys.length > 20
      || allocations.length > 100 || monthly.length > 100 || bases.length > 100 || requestedAliases.length > 10 || staleDemandExceptionIds.length > 20
      || allocations.some(row => !uuidPattern.test(row.id) || !Number.isInteger(row.expectedVersion) || row.expectedVersion < 1
        || !["UPDATE", "ARCHIVE", "RESTORE"].includes(row.action)
        || (row.divisionId !== undefined && row.divisionId !== RESIDUAL_TARGET_DIVISION_ID)
        || (row.allocatedQuantity !== undefined && (!Number.isFinite(Number(row.allocatedQuantity)) || Number(row.allocatedQuantity) < 0))
        || (row.action === "RESTORE" && (!row.archiveBatchId || row.divisionId !== undefined || row.allocatedQuantity !== undefined))
        || (row.action === "ARCHIVE" && (row.divisionId !== undefined || row.allocatedQuantity !== undefined))
        || (row.action === "UPDATE" && row.divisionId === undefined && row.allocatedQuantity === undefined))
      || monthly.some(row => !uuidPattern.test(row.id) || !Number.isInteger(row.expectedVersion) || row.expectedVersion < 1
        || (row.divisionId !== undefined && row.divisionId !== RESIDUAL_TARGET_DIVISION_ID)
        || (row.requiredQuantity !== undefined && (!Number.isFinite(Number(row.requiredQuantity)) || Number(row.requiredQuantity) < 0))
        || (row.divisionId === undefined && row.requiredQuantity === undefined))
      || bases.some(row => !uuidPattern.test(row.id) || !Number.isInteger(row.expectedVersion) || row.expectedVersion < 1
        || (row.divisionId !== undefined && row.divisionId !== RESIDUAL_TARGET_DIVISION_ID)
        || (row.plannedQuantity !== undefined && (!Number.isFinite(Number(row.plannedQuantity)) || Number(row.plannedQuantity) < 0))
        || (row.divisionId === undefined && row.plannedQuantity === undefined))
      || zeroKeys.some(row => !row.orderNumber?.trim() || !row.itemCode?.trim() || row.divisionId !== RESIDUAL_TARGET_DIVISION_ID)
      || requestedAliases.some(row => typeof row.sourceOrderNumber !== "string" || !row.sourceOrderNumber.trim()
        || row.sourceOrderNumber.length > 100 || typeof row.targetOrderNumber !== "string" || !row.targetOrderNumber.trim()
        || row.targetOrderNumber.length > 100 || row.sourceOrderNumber === row.targetOrderNumber)
      || new Set(requestedAliases.map(row=>row.sourceOrderNumber)).size!==requestedAliases.length
      || staleDemandExceptionIds.some(id=>!uuidPattern.test(id))
      || new Set(staleDemandExceptionIds).size!==staleDemandExceptionIds.length
      || new Set(rows.map(row => row.id)).size !== rows.length
      || new Set(zeroKeys.map(row => `${row.orderNumber}\u0000${row.itemCode}`)).size !== zeroKeys.length) {
      throw new BadRequestException("收尾命令参数、版本或业务范围无效");
    }
    const normalized = {
      allocations: [...allocations].sort((a,b)=>a.id.localeCompare(b.id)),
      monthly: [...monthly].sort((a,b)=>a.id.localeCompare(b.id)),
      bases: [...bases].sort((a,b)=>a.id.localeCompare(b.id)),
      zeroKeys: [...zeroKeys].sort((a,b)=>`${a.orderNumber}/${a.itemCode}`.localeCompare(`${b.orderNumber}/${b.itemCode}`)),
      groupPlanAliases: [...requestedAliases].sort((a,b)=>a.sourceOrderNumber.localeCompare(b.sourceOrderNumber)),
      resolveStaleDemandExceptionIds: [...staleDemandExceptionIds].sort()
    };
    const requestHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    const storageKey = `mps-d3-residual:${actor.tenantId}:${input.idempotencyKey}`;
    const result = await this.dataSource.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [storageKey]);
      const [prior] = await manager.query("SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1", [storageKey]);
      if (prior) {
        if (prior.request_hash !== requestHash) throw new ConflictException("相同幂等键不能用于不同收尾数据");
        return { ...prior.response_json, repeated: true };
      }
      await manager.query("SET LOCAL lock_timeout='10s'");
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${actor.tenantId}:mps-allocation-projection`]);
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${actor.tenantId}:mps-monthly-base`]);
      const divisions=await manager.query("SELECT id FROM organization_units WHERE id=$1::uuid AND enabled=true",[RESIDUAL_TARGET_DIVISION_ID]);
      if(!divisions.length)throw new ConflictException("事业三部当前未启用，拒绝执行计划更正");
      const allocationMap = new Map<string, Record<string, any>>();
      if (allocations.length) {
        const current = await manager.query("SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE", [actor.tenantId, allocations.map(row=>row.id)]);
        if (current.length !== allocations.length) throw new ConflictException("订单分配快照已变化或记录不存在");
        for (const row of current) allocationMap.set(String(row.id),row);
      }
      const monthlyMap = new Map<string, Record<string, any>>();
      if (monthly.length) {
        const current = await manager.query("SELECT * FROM mps_monthly_plans WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE", [actor.tenantId, monthly.map(row=>row.id)]);
        if (current.length !== monthly.length) throw new ConflictException("月度计划快照已变化或记录不存在");
        for (const row of current) monthlyMap.set(String(row.id),row);
      }
      const baseMap = new Map<string, Record<string, any>>();
      if (bases.length) {
        const current = await manager.query("SELECT * FROM mps_base_plans WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE", [actor.tenantId, bases.map(row=>row.id)]);
        if (current.length !== bases.length) throw new ConflictException("基础计划快照已变化或记录不存在");
        for (const row of current) baseMap.set(String(row.id),row);
      }
      const affectedKeys = new Set<string>();
      const normOrder = (value: unknown) => String(value ?? "").replace(/^23[0-9]{2}-/,"").replace(/-1$/,"");
      for (const change of allocations) {
        const current = allocationMap.get(change.id)!;
        if (Number(current.version) !== change.expectedVersion) throw new ConflictException("订单分配版本已变化，请重新核对");
        if (change.action === "RESTORE") {
          if (current.archived_at == null || current.division_id !== RESIDUAL_TARGET_DIVISION_ID) throw new ConflictException("只能恢复事业三部的已归档分配");
          const [archive] = await manager.query(`SELECT 1 FROM audit_logs WHERE tenant_id=$1 AND resource='mps-order-allocations'
            AND record_id=$2 AND action='mps-order-allocations.archived' AND after_json->>'archiveBatchId'=$3 LIMIT 1`,
          [actor.tenantId,change.id,change.archiveBatchId]);
          if (!archive) throw new ConflictException("归档批次审计不匹配，拒绝恢复");
          const duplicate = await manager.query(`SELECT id FROM mps_order_allocations WHERE tenant_id=$1 AND order_number=$2 AND item_code=$3
            AND division_id=$4::uuid AND order_status='已审核' AND archived_at IS NULL AND id<>$5::uuid LIMIT 1`,
          [actor.tenantId,current.order_number,current.item_code,current.division_id,current.id]);
          if (duplicate.length) throw new ConflictException("该事业部已有有效分配，拒绝重复恢复");
        } else {
          if (current.archived_at != null || current.order_status !== "已审核") throw new ConflictException("更正仅允许当前已审核有效分配");
          const facts = await this.residualExecutionFacts(manager,actor.tenantId,current.order_number,current.item_code);
          if (facts.shipping || facts.weekly || facts.reports || facts.inbound) throw new ConflictException(`存在出货、周计划、报工或入库事实，拒绝更正：${current.order_number}/${current.item_code}`);
        }
        affectedKeys.add(`${normOrder(current.order_number)}\u0000${current.item_code}`);
      }
      for (const change of monthly) {
        const row=monthlyMap.get(change.id)!;
        if(Number(row.version)!==change.expectedVersion)throw new ConflictException("月度计划版本已变化，请重新核对");
        if(!affectedKeys.has(`${normOrder(row.order_number)}\u0000${row.item_code}`))throw new BadRequestException("月度计划不属于本次分配业务键");
      }
      for (const change of bases) {
        const row=baseMap.get(change.id)!;
        if(Number(row.version)!==change.expectedVersion)throw new ConflictException("基础计划版本已变化，请重新核对");
        if(!affectedKeys.has(`${normOrder(row.order_number)}\u0000${row.item_code}`))throw new BadRequestException("基础计划不属于本次分配业务键");
        const facts=await this.residualExecutionFacts(manager,actor.tenantId,row.order_number,row.item_code);
        if(facts.shipping||facts.weekly||facts.reports||facts.inbound)throw new ConflictException(`存在出货、周计划、报工或入库事实，拒绝更正：${row.order_number}/${row.item_code}`);
      }
      let restored=0,archived=0,allocationUpdated=0,monthlyUpdated=0,baseUpdated=0;
      for(const change of allocations){
        const before=allocationMap.get(change.id)!; const sets:string[]=[];const params:unknown[]=[actor.tenantId,change.id,change.expectedVersion,actor.userId];
        if(change.action==="RESTORE"){sets.push("archived_at=NULL");restored++;}
        if(change.action==="ARCHIVE"){sets.push("archived_at=now()");archived++;}
        if(change.divisionId!==undefined){params.push(change.divisionId);sets.push(`division_id=$${params.length}::uuid`);}
        if(change.allocatedQuantity!==undefined){params.push(change.allocatedQuantity);sets.push(`allocated_quantity=$${params.length}::numeric`);}
        if(!sets.length)throw new BadRequestException("没有分配更正字段");
        sets.push("updated_at=now()","updated_by=$4::uuid","version=version+1");
        const [after]=await manager.query(`UPDATE mps_order_allocations SET ${sets.join(",")} WHERE tenant_id=$1 AND id=$2::uuid AND version=$3 RETURNING *`,params);
        if(!after)throw new ConflictException("订单分配并发变化，已回滚");
        await this.audit(manager,actor,"mps-order-allocations",change.id,`mps-order-allocations.residual_${change.action.toLowerCase()}`,before,
          change.action==="RESTORE" ? {...after,restoredFromArchiveBatchId:change.archiveBatchId}
            : change.action==="ARCHIVE" ? {...after,residualIdempotencyKey:input.idempotencyKey} : after);
        if(change.action==="UPDATE")allocationUpdated++;
      }
      for(const change of monthly){
        const before=monthlyMap.get(change.id)!; const quantity=change.requiredQuantity===undefined?undefined:String(change.requiredQuantity);
        const sets:string[]=[];const params:unknown[]=[actor.tenantId,change.id,change.expectedVersion,actor.userId];
        if(change.divisionId!==undefined){params.push(change.divisionId);sets.push(`division_id=$${params.length}::uuid`);}
        if(quantity!==undefined){params.push(quantity);const ix=params.length;sets.push(`required_quantity=$${ix}::numeric`,`pending_quantity=greatest($${ix}::numeric-cumulative_inbound_quantity,0)`,`completion_rate=CASE WHEN $${ix}::numeric<=0 THEN 0 ELSE round(least(greatest(cumulative_inbound_quantity,0)/$${ix}::numeric,1),4) END`);}
        sets.push("updated_at=now()","updated_by=$4::uuid","version=version+1");
        const [after]=await manager.query(`UPDATE mps_monthly_plans SET ${sets.join(",")} WHERE tenant_id=$1 AND id=$2::uuid AND version=$3 RETURNING *`,params);
        if(!after)throw new ConflictException("月度计划并发变化，已回滚");
        await this.audit(manager,actor,"mps-monthly-plans",change.id,"mps-monthly-plans.residual_corrected",before,after);monthlyUpdated++;
      }
      for(const change of bases){
        const before=baseMap.get(change.id)!;const sets:string[]=[];const params:unknown[]=[actor.tenantId,change.id,change.expectedVersion,actor.userId];
        if(change.divisionId!==undefined){params.push(change.divisionId);sets.push(`division_id=$${params.length}::uuid`);}
        if(change.plannedQuantity!==undefined){params.push(String(change.plannedQuantity));sets.push(`planned_quantity=$${params.length}::numeric`);}
        sets.push("updated_at=now()","updated_by=$4::uuid","version=version+1");
        const [after]=await manager.query(`UPDATE mps_base_plans SET ${sets.join(",")} WHERE tenant_id=$1 AND id=$2::uuid AND version=$3 RETURNING *`,params);
        if(!after)throw new ConflictException("基础计划并发变化，已回滚");
        await this.audit(manager,actor,"mps-base-plans",change.id,"mps-base-plans.residual_corrected",before,after);baseUpdated++;
      }
      const groupPlanAliases: Array<{sourceOrderNumber:string;targetOrderNumber:string}> = [];
      const duplicateGroupPlanIds = new Set<string>();
      const explicitAliasMap=new Map(requestedAliases.map(row=>[row.sourceOrderNumber,row.targetOrderNumber]));
      for (const sourceOrderNumber of new Set([...allocations
        .map(row=>String(allocationMap.get(row.id)!.order_number)),...requestedAliases.map(row=>row.sourceOrderNumber)])) {
        const normalizedOrder=normOrder(sourceOrderNumber);
        const groupPlans: Array<{id:string;order_number:string;created_at:string}> = await manager.query(`SELECT id,order_number,created_at FROM mps_group_plans
          WHERE tenant_id=$1 AND regexp_replace(regexp_replace(order_number,'^23[0-9]{2}-',''),'-1$','')=$2
          ORDER BY created_at,id FOR UPDATE`,[actor.tenantId,normalizedOrder]);
        const preferred=explicitAliasMap.get(sourceOrderNumber);
        if(groupPlans.length>1&&!preferred)throw new ConflictException(`集团计划存在多个候选，必须明确指定并确认目标：${sourceOrderNumber}`);
        const target=groupPlans.find(row=>row.order_number===preferred)?.order_number ?? groupPlans[0]?.order_number ?? null;
        if(preferred && target!==preferred)throw new ConflictException(`指定集团计划别名不存在：${sourceOrderNumber} → ${preferred}`);
        for (const row of groupPlans) if(row.order_number!==target) duplicateGroupPlanIds.add(String(row.id));
        if (target && target!==sourceOrderNumber) groupPlanAliases.push({sourceOrderNumber,targetOrderNumber:target});
      }
      const projection=await reconcileAllocationPlans(manager,actor.tenantId,actorId,actor.username,groupPlanAliases);
      let groupPlansConsolidated=0;
      if (duplicateGroupPlanIds.size) {
        const duplicates: Array<Record<string,any>> = await manager.query("SELECT * FROM mps_group_plans WHERE tenant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",[actor.tenantId,[...duplicateGroupPlanIds]]);
        for (const before of duplicates) {
          if (Number(before.required_quantity)===0 && Number(before.completed_quantity)===0 && Number(before.pending_quantity)===0
            && Number(before.completion_rate)===0) continue;
          const [after]=await manager.query(`UPDATE mps_group_plans SET required_quantity=0,completed_quantity=0,pending_quantity=0,completion_rate=0,
            updated_at=now(),updated_by=$3::uuid,version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND version=$4 RETURNING *`,
          [actor.tenantId,before.id,actorId,before.version]);
          if(!after)throw new ConflictException("重复集团计划汇总并发变化，事务已回滚");
          await this.audit(manager,actor,"mps-group-plans",String(before.id),"mps-group-plans.residual_alias_consolidated",before,after);
          groupPlansConsolidated++;
        }
      }
      if(staleDemandExceptionIds.length){
        const stale: Array<Record<string,any>> = await manager.query(`SELECT e.* FROM mps_data_exceptions e
          JOIN mps_monthly_plans p ON p.tenant_id=e.tenant_id AND p.id=e.record_id
          WHERE e.tenant_id=$1 AND e.id=ANY($2::uuid[]) AND e.active=true AND e.exception_type='NON_POSITIVE_DEMAND' AND p.required_quantity>0
          ORDER BY e.id FOR UPDATE OF e,p`,[actor.tenantId,staleDemandExceptionIds]);
        if(stale.length!==staleDemandExceptionIds.length)throw new ConflictException("指定的非正需求异常仍未满足关闭条件，事务已回滚");
        for(const before of stale){
          const [after]=await manager.query(`UPDATE mps_data_exceptions SET active=false,resolved_at=now(),updated_at=now(),updated_by=$3::uuid,version=version+1
            WHERE tenant_id=$1 AND id=$2::uuid AND version=$4 RETURNING *`,[actor.tenantId,before.id,actorId,before.version]);
          if(!after)throw new ConflictException("异常记录并发变化，事务已回滚");
          await this.audit(manager,actor,"mps-data-exceptions",String(before.id),"mps-data-exceptions.residual_stale_demand_resolved",before,after);
        }
      }
      const zeroRows: Array<Record<string,any>> = [];
      for(const key of zeroKeys){
        const matches=await manager.query(`SELECT id FROM mps_monthly_plans WHERE tenant_id=$1 AND order_number=$2 AND item_code=$3 AND division_id=$4::uuid AND required_quantity=0 FOR UPDATE`,[actor.tenantId,key.orderNumber,key.itemCode,key.divisionId]);
        if(matches.length!==1)throw new ConflictException(`零数量月度计划不唯一或不存在：${key.orderNumber}/${key.itemCode}`);
        zeroRows.push(matches[0]);
      }
      const allocationMonthlyRows: Array<Record<string,any>> = allocations.length
        ? await manager.query("SELECT id FROM mps_monthly_plans WHERE tenant_id=$1 AND allocation_id=ANY($2::uuid[])",[actor.tenantId,allocations.map(row=>row.id)]) : [];
      const monthlyIds=[...new Set([...monthly.map(row=>row.id),...allocationMonthlyRows.map(row=>String(row.id)),...zeroRows.map(row=>String(row.id))])];
      const baseProjection=await reconcileMonthlyBasePlans(manager,actor.tenantId,actorId,actor.username,monthlyIds,zeroRows.map(row=>String(row.id)),false);
      const response={restored,archived,allocationUpdated,monthlyUpdated,baseUpdated,groupPlansConsolidated,projection:projection.metrics,baseProjection:baseProjection.metrics,repeated:false};
      await this.audit(manager,actor,"mps-order-allocations",null,"mps-order-allocations.residual_finalized",null,{...response,idempotencyKey:input.idempotencyKey});
      await manager.query("INSERT INTO idempotency_keys(key,request_hash,response_json,created_by,updated_by) VALUES($1,$2,$3::jsonb,$4::uuid,$4::uuid)",[storageKey,requestHash,JSON.stringify(response),actor.userId]);
      return response;
    });
    void this.sync.processOutbox().catch(() => undefined);
    return result;
  }

  private async residualExecutionFacts(manager: EntityManager, tenantId: string, orderNumber: string, itemCode: string) {
    const [row]=await manager.query(`SELECT
      EXISTS(SELECT 1 FROM mps_shipping_plans s WHERE s.tenant_id=$1 AND regexp_replace(regexp_replace(s.order_number,'^23[0-9]{2}-',''),'-1$','')=regexp_replace(regexp_replace($2,'^23[0-9]{2}-',''),'-1$','') AND s.item_code=$3) shipping,
      EXISTS(SELECT 1 FROM mps_weekly_plans w JOIN mps_base_plans b ON b.tenant_id=w.tenant_id AND b.id=w.base_plan_id WHERE b.tenant_id=$1 AND regexp_replace(regexp_replace(b.order_number,'^23[0-9]{2}-',''),'-1$','')=regexp_replace(regexp_replace($2,'^23[0-9]{2}-',''),'-1$','') AND b.item_code=$3) weekly,
      EXISTS(SELECT 1 FROM mps_process_reports r JOIN mps_weekly_plans w ON w.tenant_id=r.tenant_id AND w.id=r.weekly_plan_id JOIN mps_base_plans b ON b.tenant_id=w.tenant_id AND b.id=w.base_plan_id WHERE b.tenant_id=$1 AND regexp_replace(regexp_replace(b.order_number,'^23[0-9]{2}-',''),'-1$','')=regexp_replace(regexp_replace($2,'^23[0-9]{2}-',''),'-1$','') AND b.item_code=$3) reports,
      EXISTS(SELECT 1 FROM finished_goods_inbound f WHERE regexp_replace(regexp_replace(f.sales_order_number,'^23[0-9]{2}-',''),'-1$','')=regexp_replace(regexp_replace($2,'^23[0-9]{2}-',''),'-1$','') AND f.inventory_code=$3 AND f.received_quantity<>0) inbound`,[tenantId,orderNumber,itemCode]);
    return {shipping:Boolean(row.shipping),weekly:Boolean(row.weekly),reports:Boolean(row.reports),inbound:Boolean(row.inbound)};
  }

  private async assertAllocationVendorTarget(manager:EntityManager,supplierName:unknown,divisionId:unknown) {
    if(!divisionId){const expected=allocationVendorRequiredDivisionName(supplierName);if(expected)throw new BadRequestException(`供应商必须映射${expected}，承接组织ID不能为空`);return;}
    const units=await manager.query("SELECT id,name,enabled FROM organization_units");
    const target=units.find((unit:Record<string,any>)=>String(unit.id)===String(divisionId));
    if(!target)throw new BadRequestException("承接组织不存在，不能保存供应商映射");
    const error=allocationVendorTargetError(supplierName,target,units);
    if(error)throw new BadRequestException(error);
  }

  async create(code: string, body: Record<string, unknown>, actor: MasterPlanActor) {
    const resource = this.resource(code);
    this.assertDirectCreateAllowed(resource);
    if (!resource.create || !hasMasterPlanPermission(actor, code, "create")) throw new ForbiddenException("当前权限组没有该表新增权限");
    await this.enforceShippingWindow(resource, actor);
    const values = this.writable(resource, body, actor, "create");
    this.validateRequiredOnCreate(resource, values);
    if (resource.code !== "mps-process-reports") await this.fillReportSource(resource, values, actor.tenantId);
    /* 报工来源与工序任务在同一写事务中锁定、解析并校验，避免确认路线期间发生竞争。 */
    if (resource.code !== "mps-process-reports") {
      this.assertCreateScope(resource, this.toDatabaseRecord(resource, values), actor);
      this.validateCrossFields(resource, this.toDatabaseRecord(resource, values));
    }
    const result = await this.translateDatabaseError(() => this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      if(code==="mps-order-allocations")await this.assertAllocationVendorTarget(manager,values.supplierName,values.divisionId);
      const columns = columnsFor(resource);
      await this.assignDeliveryCode(resource, values, actor.tenantId, manager, actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID);
      const actorId = actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID;
      if (resource.code === "mps-process-reports") {
        await this.fillReportSource(resource, values, actor.tenantId, manager);
        this.assertCreateScope(resource, this.toDatabaseRecord(resource, values), actor);
        this.validateCrossFields(resource, this.toDatabaseRecord(resource, values));
      }
      /* 报工字段由周计划在事务内补齐，必须在来源解析后生成最终 INSERT 字段和值。 */
      const generatedEntries = Object.entries(values);
      if (!generatedEntries.length) throw new BadRequestException("没有可写入的业务字段");
      const params = [actor.tenantId, actorId, actorId, ...generatedEntries.map(([, value]) => value)];
      const inserted = await manager.query(`INSERT INTO ${resource.table}(tenant_id,created_by,updated_by,${generatedEntries.map(([field]) => columns[field]).join(",")}${code==="mps-order-allocations"?",manually_maintained":""}) VALUES($1,$2::uuid,$3,${generatedEntries.map((_, index) => `$${index + 4}`).join(",")}${code==="mps-order-allocations"?",true":""}) RETURNING *`, params);
      if (["mps-order-allocations","mps-base-plans"].includes(code) && await demandLinksReady(manager)) {
        // Only this new row is eligible for automatic linking; existing historical NULLs stay untouched.
        if (code === "mps-order-allocations") await ensureNewAllocationDemand(manager,inserted[0],actorId,actor.username,actor.requestId);
        inserted[0] = await linkNewDemandRecord(manager,code as "mps-order-allocations"|"mps-base-plans",inserted[0],actorId,actor.username,actor.requestId);
      }
      await this.allocationEvent(manager, code, actor, [{ before: null, after: inserted[0] }]);
      await this.audit(manager, actor, code, inserted[0].id, `${code}.created`, null, inserted[0]);
      await this.enqueueReconciliation(manager, resource, actor, inserted[0].id, inserted[0]);
      return inserted[0];
    }));
    const reconciliation = await this.completeReconciliation(resource);
    return reconciliation ? { ...result, reconciliation } : result;
  }

  async correctHistoricalReport(id:string,body:Record<string,unknown>,actor:MasterPlanActor) {
    if (!hasMasterPlanPermission(actor,'mps-plan-correct-facts','update') || typeof body.correctionReason!=='string' || !body.correctionReason.trim() || body.correctionReason.length>1000) throw new ForbiddenException('历史纠错需要独立权限及明确原因');
    return this.update('mps-process-reports',id,body,actor);
  }

  /** Explicitly reviewed, single-allocation recovery; never reuses or edits a failed historical event. */
  async recoverArchivedAllocationSource(id:string,body:{expectedVersion?:number;reason?:string},actor:MasterPlanActor){
    const resource=this.resource('mps-order-allocations');
    if(!hasMasterPlanPermission(actor,resource.code,'update'))throw new ForbiddenException('没有订单分配计划修复权限');
    if(!uuidPattern.test(id)||!Number.isInteger(body?.expectedVersion)||Number(body.expectedVersion)<1
      ||typeof body.reason!=='string'||!body.reason.trim()||String(body.reason).length>1000)throw new BadRequestException('恢复请求版本或原因无效');
    const recoveryReason=String(body.reason).trim();
    const result=await this.dataSource.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      const [allocation]=await manager.query(`SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid AND archived_at IS NULL FOR UPDATE`,[actor.tenantId,id]);
      if(!allocation||!this.recordAllowed(resource,allocation,actor,'update'))throw new NotFoundException('未找到可恢复的有效订单分配');
      if(Number(allocation.version)!==Number(body.expectedVersion))throw new ConflictException('订单分配版本已变化，请重新核对');
      const candidates:Array<Record<string,any>>=await manager.query(`${allocationProjectionCandidatesSql} WHERE allocation_id=$2::uuid`,[actor.tenantId,id]);
      if(candidates.length!==1||!candidates[0]?.recover_archived_source){
        const reason=String(candidates[0]?.skip_reason??'业务键不存在、存在多个有效来源或归属不明确');
        throw new ConflictException(`不满足自动恢复条件：${reason}`);
      }
      const scope={allocation:{id,expectedVersion:Number(allocation.version),orderNumber:String(allocation.order_number),
        itemCode:String(allocation.item_code),divisionId:String(allocation.division_id)}};
      const key=`outbox:${actor.requestId}:mps-order-allocations:plan-projections:archived-source-recovery`;
      const [existing]=await manager.query('SELECT id,status FROM mps_reconciliation_outbox WHERE tenant_id=$1 AND idempotency_key=$2',[actor.tenantId,key]);
      if(existing)return {eventId:String(existing.id),status:String(existing.status),allocationVersion:Number(allocation.version),repeated:true};
      const [event]=await manager.query(`INSERT INTO mps_reconciliation_outbox(tenant_id,resource,record_id,sync_key,scope_json,idempotency_key,actor_id,actor_name,created_by,updated_by)
        VALUES($1,'mps-order-allocations',$2::uuid,'plan-projections',$3::jsonb,$4,$5::uuid,$6,$5::uuid,$5::uuid) RETURNING id,status`,
        [actor.tenantId,id,JSON.stringify(scope),key,actor.userId??MASTER_PLAN_SYSTEM_USER_ID,actor.username]);
      await this.audit(manager,actor,resource.code,id,'allocation.archived_source_recovery_requested',allocation,
        {version:Number(allocation.version),scope,reason:recoveryReason,outboxId:event.id});
      return {eventId:String(event.id),status:String(event.status),allocationVersion:Number(allocation.version),repeated:false};
    });
    if(!result.repeated)await this.sync.processOutboxEvent(actor.tenantId,result.eventId);
    const event=await this.dataSource.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      return (await manager.query('SELECT status,last_error,attempts FROM mps_reconciliation_outbox WHERE tenant_id=$1 AND id=$2::uuid',[actor.tenantId,result.eventId]))[0];
    });
    return {...result,status:event?.status??result.status,lastError:event?.last_error??null,attempts:Number(event?.attempts??0),stages:[{syncKey:'demand-consistency',...event}]};
  }

  async update(code: string, id: string, body: Record<string, unknown>, actor: MasterPlanActor) {
    if (code === "mps-review-due-dates") throw new ForbiddenException("评审交期人工编辑必须使用专用命令，禁止通用修改路径");
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "update")) throw new ForbiddenException("当前权限组没有该表修改权限");
    await this.enforceShippingWindow(resource, actor);
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new BadRequestException("expectedVersion 必须是正整数");
    const values = this.writable(resource, body, actor);
    if (!Object.keys(values).length) throw new BadRequestException("没有可修改的业务字段");
    const result = await this.translateDatabaseError(() => this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      const [current] = await manager.query(`SELECT * FROM ${resource.table} WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE`, [actor.tenantId, id]);
      if (!current) throw new NotFoundException("记录不存在");
      if (!this.recordAllowed(resource, current, actor, "update")) throw new ForbiddenException("当前数据范围不允许修改该记录");
      if (Number(current.version) !== expectedVersion) throw new ConflictException("记录已被其他用户修改，请刷新后重试");
      if (code === "mps-order-allocations" && Object.hasOwn(values, "divisionId")
        && String(values.divisionId ?? "") !== String(current.division_id ?? "")) {
        throw new ConflictException("承接事业部变更必须先预览并使用专用变更操作，不能通过普通编辑直接修改");
      }
      if(code==="mps-order-allocations")await this.assertAllocationVendorTarget(manager,values.supplierName??current.supplier_name,values.divisionId??current.division_id);
      if (resource.code === "mps-shipping-plans" && ("orderNumber" in values || "itemCode" in values || "divisionId" in values)) {
        const [monthly] = await manager.query(`SELECT id FROM mps_monthly_plans WHERE tenant_id=$1 AND order_number=$2 AND item_code=$3 AND division_id IS NOT DISTINCT FROM $4::uuid`, [actor.tenantId, values.orderNumber ?? current.order_number, values.itemCode ?? current.item_code, (Object.hasOwn(values,"divisionId") ? values.divisionId : current.division_id)]);
        values.monthlyPlanId = monthly?.id ?? null;
      }
      if (resource.code==='mps-process-reports' && body.correctionReason!==undefined) {
        if (!hasMasterPlanPermission(actor,'mps-plan-correct-facts','update') || typeof body.correctionReason!=='string' || !body.correctionReason.trim() || body.correctionReason.length>1000) throw new ForbiddenException('历史纠错需要独立权限及明确原因');
        await manager.query("SELECT set_config('app.mps_lifecycle_correction','1',true)");
      }
      this.normalizeSystemSetting(resource, current, values);
      if (["mps-weekly-process-plans", "mps-material-reports", "mps-process-reports"].includes(resource.code) && "weeklyPlanId" in values) await this.fillReportSource(resource, values, actor.tenantId, manager);
      this.validateRequiredOnUpdate(resource, values, current);
      this.validateCrossFields(resource, { ...current, ...this.toDatabaseRecord(resource, values) });
      this.assertMappingTargetScope(resource, { ...current, ...this.toDatabaseRecord(resource, values) }, actor, "update");
      if (code === "mps-order-allocations" && !allocationChange(current, { ...current, ...this.toDatabaseRecord(resource, values) }).fields.length) return { id: current.id, version: Number(current.version), values, unchanged: true };
      const columns = columnsFor(resource); const entries = Object.entries(values); const params: unknown[] = [actor.tenantId, id, expectedVersion, actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID, ...entries.map(([, value]) => value)];
      const updated = await manager.query(`UPDATE ${resource.table} SET ${entries.map(([field], index) => `${columns[field]}=$${index + 5}`).join(",")},updated_at=now(),updated_by=$4,version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND version=$3 RETURNING *`, params);
      // TypeORM/pg returns UPDATE ... RETURNING as [rows, affectedCount], unlike INSERT/SELECT.
      const updatedRow = Array.isArray(updated[0]) ? updated[0][0] : updated[0];
      if (!updatedRow) throw new ConflictException("记录已被其他用户修改，请刷新后重试");
      let committedRow = updatedRow;
      if (resource.code === "mps-weekly-plans" && Object.keys(values).some((field) => WEEKLY_EXECUTION_REFRESH_FIELDS.has(field))) {
        await this.sync.refreshWeeklyExecution(manager, id, actor.tenantId, actor.userId, actor.userId ?? actor.username);
        [committedRow] = await manager.query(`SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND id=$2::uuid`, [actor.tenantId, id]);
      }
      await this.allocationEvent(manager, code, actor, [{ before: current, after: committedRow }]);
      const correction = code === 'mps-process-reports' && typeof body.correctionReason === 'string';
      await this.audit(manager, actor, code, id, correction ? `${code}.historical_corrected` : `${code}.updated`, current,
        correction ? { ...committedRow, correctionReason: String(body.correctionReason).trim() } : committedRow);
      if (resource.code === "mps-shipping-plans") await this.enqueueShippingPlanKeyFieldsChanged(manager, actor, current, committedRow);
      if(code==='mps-order-allocations')await this.enqueueAllocationReconciliations(manager,actor,[{before:current,after:committedRow}]);
      else await this.enqueueReconciliation(manager, resource, actor, id, committedRow);
      return {
        id: committedRow.id,
        version: Number(committedRow.version),
        values: Object.fromEntries(entries.map(([field]) => [field, committedRow[columns[field]!]]))
      };
    }));
    const reconciliation = await this.completeReconciliation(resource);
    return reconciliation ? { ...result, reconciliation } : result;
  }

  /** Read-only preview of the identity-preserving move and all linked plan/process route effects. */
  async previewAllocationDivisionTransfer(id: string, input: { targetDivisionId?: string; expectedVersion?: number }, actor: MasterPlanActor) {
    const resource = this.resource("mps-order-allocations");
    if (!hasMasterPlanPermission(actor, resource.code, "update")
      || !hasMasterPlanFieldPermission(actor, resource.code, "divisionId", "update")) throw new ForbiddenException("没有订单分配事业部变更权限");
    if (!uuidPattern.test(id) || !uuidPattern.test(String(input?.targetDivisionId ?? ""))) throw new BadRequestException("记录ID和目标事业部必须使用稳定ID");
    return this.dataSource.transaction(async manager => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      const [row] = await manager.query("SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid AND archived_at IS NULL", [actor.tenantId,id]);
      if (!row) throw new NotFoundException("订单分配记录不存在");
      if (!this.recordAllowed(resource,row,actor,"read") || !this.recordAllowed(resource,row,actor,"update")) throw new ForbiddenException("当前数据范围不允许核查或修改该记录");
      if (input.expectedVersion !== undefined && Number(row.version)!==Number(input.expectedVersion)) throw new ConflictException("订单分配记录已变化，请刷新后重新预览");
      const [target] = await manager.query("SELECT id,name FROM organization_units WHERE id=$1::uuid AND enabled=true",[input.targetDivisionId]);
      if (!target) throw new BadRequestException("目标事业部不存在或已停用");
      await this.assertAllocationVendorTarget(manager,row.supplier_name,target.id);
      this.assertMappingTargetScope(resource,{...row,division_id:target.id},actor,"update");
      if (!this.recordAllowed(resource,{...row,division_id:target.id},actor,"update")) throw new ForbiddenException("当前数据范围不允许将需求转入目标事业部");
      if (String(row.division_id)===String(target.id)) throw new BadRequestException("目标事业部与当前事业部相同");
      const sourcePlans=await this.allocationTransferPlanCoverage(manager,actor,row.order_number,row.item_code,String(row.division_id),String(target.id));
      const targetPlans=await this.allocationTransferPlanCoverage(manager,actor,row.order_number,row.item_code,String(target.id));
      const [facts] = await manager.query(`SELECT
        EXISTS(SELECT 1 FROM erp_staging_raw_records r JOIN finished_goods_inbound f ON f.source_database=r.source_database AND f.source_system=r.source_system AND f.source_key=r.source_id
          AND f.sales_order_number=r.order_number AND f.inventory_code=r.item_code AND f.received_quantity<>0
          WHERE r.tenant_id=$1 AND r.record_type='INBOUND_LINE' AND r.source_table='ST_RDRecord_b' AND r.order_link_stable=true AND r.status_code='189' AND r.order_number=$2 AND r.item_code=$3)
        OR EXISTS(SELECT 1 FROM mps_monthly_plans m WHERE m.tenant_id=$1 AND m.order_number=$2 AND m.item_code=$3 AND m.division_id=$4::uuid AND m.cumulative_inbound_quantity>0)
        OR EXISTS(SELECT 1 FROM mps_weekly_plans w WHERE w.tenant_id=$1 AND w.order_number=$2 AND w.item_code=$3 AND w.division_id=$4::uuid AND w.allocated_inbound_quantity>0) has_inbound`,
      [actor.tenantId,row.order_number,row.item_code,row.division_id]);
      const reasons: string[]=[];
      if (row.order_status!=="已审核" || row.archived_at!=null) reasons.push("订单分配不是有效的已审核需求");
      if (new Decimal(String(row.allocated_quantity??0)).lte(0)) reasons.push("分配数量不是正数");
      if (sourcePlans.monthly.length+sourcePlans.base.length+sourcePlans.weekly.length>0) {
        reasons.push(...await this.allocationTransferPlanMigrationBlockers(manager,actor,row,sourcePlans));
      } else if (row.monthly_plan_id!=null) reasons.push("订单分配声明了月度来源，但原事业部没有对应计划");
      if (targetPlans.monthly.length+targetPlans.shipping.length+targetPlans.base.length+targetPlans.weekly.length>0) reasons.push("目标事业部已存在同订单品项计划，需先核对冲突");
      if (facts.has_inbound) reasons.push("检测到入库事实，需核对其来源与归属");
      const fingerprint=createHash("sha256").update(JSON.stringify({tenantId:actor.tenantId,id:row.id,version:Number(row.version),targetDivisionId:target.id,
        orderNumber:row.order_number,itemCode:row.item_code,quantity:String(row.allocated_quantity),sourcePlans,targetPlans,facts})).digest("hex");
      return {allocationId:String(row.id),version:Number(row.version),orderNumber:row.order_number,itemCode:row.item_code,
        currentDivisionId:String(row.division_id),targetDivisionId:String(target.id),targetDivisionName:String(target.name),
        allocatedQuantity:new Decimal(String(row.allocated_quantity??0)).toFixed(),monthlyPlanCount:sourcePlans.monthly.length,
        shippingPlanCount:sourcePlans.shipping.length,basePlanCount:sourcePlans.base.length,weeklyPlanCount:sourcePlans.weekly.length,executionWeeklyPlanCount:sourcePlans.execution_weekly_count,
        linkedPlans:{monthly:sourcePlans.monthly,base:sourcePlans.base,weekly:sourcePlans.weekly},
        processRouteChanges:sourcePlans.processRoutes,
        targetLinkedPlans:{monthly:targetPlans.monthly,base:targetPlans.base,weekly:targetPlans.weekly},
        hasInbound:Boolean(facts.has_inbound),targetMonthlyPlanCount:targetPlans.monthly.length,canTransfer:reasons.length===0,
        reasons,previewFingerprint:fingerprint};
    });
  }

  /** Rechecks every preview condition under row lock, writes source+audit+outbox atomically,
   * and relies on the existing plan-projection consumer for durable downstream reconciliation. */
  async confirmAllocationDivisionTransfer(id: string, input: {targetDivisionId?:string;expectedVersion?:number;previewFingerprint?:string;reason?:string;idempotencyKey?:string}, actor: MasterPlanActor) {
    const key=String(input?.idempotencyKey??"");
    if(!hasMasterPlanPermission(actor,"mps-order-allocations","update") || !hasMasterPlanFieldPermission(actor,"mps-order-allocations","divisionId","update")) throw new ForbiddenException("没有订单分配事业部变更权限");
    if(!uuidPattern.test(id) || !uuidPattern.test(String(input?.targetDivisionId??""))) throw new BadRequestException("记录ID和目标事业部必须使用稳定ID");
    if(!uuidPattern.test(key) || typeof input.reason!=="string" || !input.reason.trim() || input.reason.trim().length>1000) throw new BadRequestException("需要有效的幂等请求ID和变更原因");
    const reason=input.reason.trim();
    const storageKey=`mps-allocation-division-transfer:${actor.tenantId}:${actor.userId??MASTER_PLAN_SYSTEM_USER_ID}:${key}`;
    const requestHash=createHash("sha256").update(JSON.stringify({id,targetDivisionId:input.targetDivisionId,expectedVersion:input.expectedVersion,previewFingerprint:input.previewFingerprint,reason})).digest("hex");
    const result=await this.dataSource.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${actor.tenantId}:mps-allocation-projection`]);
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${actor.tenantId}:mps-existing-monthly-inbound`]);
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))",[storageKey]);
      const [existing]=await manager.query("SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1",[storageKey]);
      if(existing){if(existing.request_hash!==requestHash)throw new ConflictException("相同幂等键不能用于不同的事业部变更");return {...existing.response_json,repeated:true};}
      const [current]=await manager.query("SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid AND archived_at IS NULL FOR UPDATE",[actor.tenantId,id]);
      if(!current || Number(current.version)!==Number(input.expectedVersion)) throw new ConflictException("订单分配记录已变化，请重新预览");
      if(!this.recordAllowed(this.resource("mps-order-allocations"),current,actor,"update")) throw new ForbiddenException("当前数据范围不允许修改该记录");
      const [target] = await manager.query("SELECT id FROM organization_units WHERE id=$1::uuid AND enabled=true",[input.targetDivisionId]);
      if(!target || !this.recordAllowed(this.resource("mps-order-allocations"),{...current,division_id:target.id},actor,"update")) throw new ForbiddenException("当前数据范围不允许将需求转入目标事业部");
      await this.assertAllocationVendorTarget(manager,current.supplier_name,target.id);
      const sourcePlans=await this.allocationTransferPlanCoverage(manager,actor,current.order_number,current.item_code,String(current.division_id),String(input.targetDivisionId));
      const targetPlans=await this.allocationTransferPlanCoverage(manager,actor,current.order_number,current.item_code,String(target.id));
      const [facts] = await manager.query(`SELECT
        EXISTS(SELECT 1 FROM erp_staging_raw_records r JOIN finished_goods_inbound f ON f.source_database=r.source_database AND f.source_system=r.source_system AND f.source_key=r.source_id
          AND f.sales_order_number=r.order_number AND f.inventory_code=r.item_code AND f.received_quantity<>0
          WHERE r.tenant_id=$1 AND r.record_type='INBOUND_LINE' AND r.source_table='ST_RDRecord_b' AND r.order_link_stable=true AND r.status_code='189' AND r.order_number=$2 AND r.item_code=$3)
        OR EXISTS(SELECT 1 FROM mps_monthly_plans m WHERE m.tenant_id=$1 AND m.order_number=$2 AND m.item_code=$3 AND m.division_id=$4::uuid AND m.cumulative_inbound_quantity>0)
        OR EXISTS(SELECT 1 FROM mps_weekly_plans w WHERE w.tenant_id=$1 AND w.order_number=$2 AND w.item_code=$3 AND w.division_id=$4::uuid AND w.allocated_inbound_quantity>0) has_inbound`,
        [actor.tenantId,current.order_number,current.item_code,current.division_id]);
      const freshFingerprint=createHash("sha256").update(JSON.stringify({tenantId:actor.tenantId,id:current.id,version:Number(current.version),targetDivisionId:input.targetDivisionId,
        orderNumber:current.order_number,itemCode:current.item_code,quantity:String(current.allocated_quantity),sourcePlans,targetPlans,facts})).digest("hex");
      if(freshFingerprint!==input.previewFingerprint) throw new ConflictException("预览后相关数据已变化，请重新预览");
      const migrationBlockers=sourcePlans.monthly.length+sourcePlans.base.length+sourcePlans.weekly.length>0
        ? await this.allocationTransferPlanMigrationBlockers(manager,actor,current,sourcePlans) : [];
      if(current.order_status!=="已审核" || new Decimal(String(current.allocated_quantity??0)).lte(0)
        || (current.monthly_plan_id!=null && sourcePlans.monthly.length===0)
        || migrationBlockers.length>0
        || targetPlans.monthly.length+targetPlans.shipping.length+targetPlans.base.length+targetPlans.weekly.length>0 || facts.has_inbound) {
        throw new ConflictException("需求或计划已变化，当前不能自动转移，请重新预览并转人工核查");
      }
      let migratedMonthly:Record<string,any>|null=null;
      if(sourcePlans.monthly.length===1){
        const [monthly]=await manager.query("SELECT * FROM mps_monthly_plans WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE",[actor.tenantId,sourcePlans.monthly[0]!.id]);
        if(!monthly || Number(monthly.version)!==Number(sourcePlans.monthly[0]!.version)) throw new ConflictException("月度计划已变化，请重新预览");
        const commandEvidence={allocationId:id,monthlyPlanId:String(monthly.id),sourceDivisionId:String(current.division_id),targetDivisionId:String(target.id),xactId:String((await manager.query("SELECT pg_current_xact_id()::text xact_id"))[0].xact_id)};
        await this.audit(manager,actor,"mps-order-allocation-transfers",id,"division_transfer.plan_identity_authorized",null,commandEvidence);
        const moved=await manager.query(`UPDATE mps_monthly_plans SET division_id=$3::uuid,updated_at=now(),updated_by=$4::uuid,version=version+1
          WHERE tenant_id=$1 AND id=$2::uuid AND version=$5 RETURNING *`,[actor.tenantId,monthly.id,target.id,actor.userId??MASTER_PLAN_SYSTEM_USER_ID,monthly.version]);
        migratedMonthly=Array.isArray(moved[0])?moved[0][0]:moved[0];
        if(!migratedMonthly) throw new ConflictException("月度计划已被并发修改");
        await this.audit(manager,actor,"mps-monthly-plans",String(monthly.id),"mps-monthly-plans.division_transferred",monthly,migratedMonthly);
      }
      const updated=await manager.query(`UPDATE mps_order_allocations SET division_id=$3::uuid,updated_at=now(),updated_by=$4::uuid,version=version+1
        WHERE tenant_id=$1 AND id=$2::uuid AND version=$5 RETURNING *`,[actor.tenantId,id,input.targetDivisionId,actor.userId??MASTER_PLAN_SYSTEM_USER_ID,input.expectedVersion]);
      const after=Array.isArray(updated[0])?updated[0][0]:updated[0];
      if(!after) throw new ConflictException("订单分配记录已被并发修改");
      if(migratedMonthly && (String(migratedMonthly.allocation_id)!==String(after.id) || String(after.monthly_plan_id)!==String(migratedMonthly.id)))
        throw new ConflictException("订单分配与月度计划稳定来源关系不一致，已回滚事业部变更");
      for(const [kind,table] of [["shipping","mps_shipping_plans"],["base","mps_base_plans"],["weekly","mps_weekly_plans"]] as const){
        const plans=sourcePlans[kind];
        for(const plan of plans){
          const [currentPlan]=await manager.query(`SELECT * FROM ${table} WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE`,[actor.tenantId,plan.id]);
          if(!currentPlan || Number(currentPlan.version)!==Number(plan.version)) throw new ConflictException(`${kind}计划已变化，请重新预览`);
          if(kind==="weekly" && currentPlan.base_plan_id!==plan.basePlanId) throw new ConflictException("周计划基础计划稳定关联已变化");
          if(kind==="base" && (String(currentPlan.monthly_plan_id??"")!==String(migratedMonthly?.id??"") || String(currentPlan.shipping_plan_id)!==String(plan.shippingPlanId))) throw new ConflictException("基础计划月度/交期父关系与预览不一致");
          if(kind==="shipping" && String(currentPlan.monthly_plan_id??"")!==String(migratedMonthly?.id??"")) throw new ConflictException("交期计划月度父关系与预览不一致");
          if(kind==="weekly"){
            const [guard]=await manager.query(`SELECT (mps_weekly_has_execution($1,$2::uuid) OR EXISTS(
              SELECT 1 FROM mps_three_day_work_orders wo WHERE wo.tenant_id=$1 AND wo.weekly_plan_id=$2::uuid
                AND (wo.blank_completion_date IS NOT NULL OR wo.packaging_completion_date IS NOT NULL))) has_execution,
              to_jsonb(weekly)->>'lifecycle_status' lifecycle_status FROM mps_weekly_plans weekly WHERE tenant_id=$1 AND id=$2::uuid`,[actor.tenantId,plan.id]);
            if(guard?.has_execution) throw new ConflictException("确认前发现周计划新增报工、入库、外协/外购、领料、完工日期或其他执行事实");
            if(guard?.lifecycle_status && guard.lifecycle_status!=="ACTIVE") throw new ConflictException("周计划状态已变化，当前不能迁移执行快照");
          }
          const moved=await manager.query(`UPDATE ${table} SET division_id=$3::uuid,updated_at=now(),updated_by=$4::uuid,version=version+1
            WHERE tenant_id=$1 AND id=$2::uuid AND version=$5 RETURNING *`,[actor.tenantId,plan.id,target.id,actor.userId??MASTER_PLAN_SYSTEM_USER_ID,plan.version]);
          const afterPlan=Array.isArray(moved[0])?moved[0][0]:moved[0];
          if(!afterPlan) throw new ConflictException(`${kind}计划已被并发修改`);
          await this.audit(manager,actor,table,String(plan.id),`${table}.division_transferred`,currentPlan,afterPlan);
          if(kind==="weekly" && sourcePlans.processRoutes.some(route=>route.weeklyPlanId===String(plan.id) && route.current.length>0)) {
            await this.sync.migrateWeeklyProcessRouteForDivisionTransfer(manager,String(plan.id),String(target.id),String(current.division_id),
              actor.tenantId,actor.userId,actor.userId??actor.username,actor.username,actor.requestId);
          }
          if(kind==="weekly") await this.migrateWeeklyExecutionContext(manager,String(plan.id),String(current.division_id),String(target.id),actor);
        }
      }
      await this.allocationEvent(manager,"mps-order-allocations",actor,[{before:current,after}]);
      await this.audit(manager,actor,"mps-order-allocations",id,"mps-order-allocations.division_transferred",current,after);
      await this.audit(manager,actor,"mps-order-allocation-transfers",id,"division_transfer.confirmed",null,{idempotencyKey:key,reason,quantity:String(after.allocated_quantity),sourceDivisionId:current.division_id,targetDivisionId:after.division_id,allocationId:id});
      const [outboxKey]=await this.enqueueReconciliation(manager,this.resource("mps-order-allocations"),actor,id,after);
      const transferExpectations={shipping:sourcePlans.shipping.map(plan=>String(plan.id)),base:sourcePlans.base.map(plan=>String(plan.id)),weekly:sourcePlans.weekly.map(plan=>String(plan.id)),
        processRoutes:sourcePlans.processRoutes.filter(route=>route.current.length>0).map(route=>({weeklyPlanId:route.weeklyPlanId,processCodes:route.targetRoute.map((process:any)=>String(process.processCode)).sort()}))};
      const response={allocationId:id,version:Number(after.version),status:"PENDING",reason,message:"分配事业部及已有计划链已在同一事务提交，集团/月度投影正在对账。",outboxKey,transferExpectations};
      await manager.query("INSERT INTO idempotency_keys(key,request_hash,response_json,created_by,updated_by) VALUES($1,$2,$3::jsonb,$4::uuid,$4::uuid)",[storageKey,requestHash,JSON.stringify(response),actor.userId??MASTER_PLAN_SYSTEM_USER_ID]);
      return response;
    });
    const persisted=await this.dataSource.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      const [saved]=await manager.query(`SELECT a.id,a.division_id,a.version,a.monthly_plan_id,m.division_id monthly_division_id,m.version monthly_version,
        s.id shipping_plan_id,s.division_id shipping_division_id,b.id base_plan_id,b.division_id base_division_id,w.id weekly_plan_id,w.division_id weekly_division_id,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'processCode',p.process_code) ORDER BY p.process_code)
          FROM mps_weekly_process_plans p WHERE p.tenant_id=w.tenant_id AND p.weekly_plan_id=w.id),'[]'::jsonb) process_tasks
        FROM mps_order_allocations a LEFT JOIN mps_monthly_plans m ON m.tenant_id=a.tenant_id AND m.id=a.monthly_plan_id
        LEFT JOIN mps_shipping_plans s ON s.tenant_id=m.tenant_id AND s.monthly_plan_id=m.id
        LEFT JOIN mps_base_plans b ON b.tenant_id=m.tenant_id AND (b.shipping_plan_id=s.id OR (s.id IS NULL AND b.monthly_plan_id=m.id AND b.shipping_plan_id IS NULL))
        LEFT JOIN mps_weekly_plans w ON w.tenant_id=b.tenant_id AND w.base_plan_id=b.id
        WHERE a.tenant_id=$1 AND a.id=$2::uuid`,[actor.tenantId,id]);
      if(!saved || String(saved.division_id)!==String(input.targetDivisionId)
        || (saved.monthly_plan_id!=null && String(saved.monthly_division_id)!==String(input.targetDivisionId)))
        throw new ConflictException("变更已提交但重新读取结果不一致，请勿重复操作并联系管理员核查");
      const expectations=result.transferExpectations??{};
      for(const [kind,idColumn,divisionColumn] of [["shipping","shipping_plan_id","shipping_division_id"],["base","base_plan_id","base_division_id"],["weekly","weekly_plan_id","weekly_division_id"]] as const){
        const expected=expectations[kind] as string[]|undefined;
        if(expected?.length && (expected.length!==1 || String(saved[idColumn])!==expected[0] || String(saved[divisionColumn])!==String(input.targetDivisionId)))
          throw new ConflictException(`变更已提交但重新读取${kind}计划结果不一致，请勿重复操作并联系管理员核查`);
      }
      const expectedRoutes=(expectations.processRoutes??[]) as Array<{weeklyPlanId:string;processCodes:string[]}>;
      const route=expectedRoutes.find(item=>item.weeklyPlanId===String(saved.weekly_plan_id));
      const savedTasks=(saved.process_tasks??[]) as Array<{processCode:string}>;
      if(route && JSON.stringify(savedTasks.map(task=>task.processCode).sort())!==JSON.stringify(route.processCodes))
        throw new ConflictException("变更已提交但重新读取工序路线不一致，请勿重复操作并联系管理员核查");
      return {allocationDivisionId:String(saved.division_id),monthlyPlanId:saved.monthly_plan_id==null?null:String(saved.monthly_plan_id),monthlyDivisionId:saved.monthly_division_id==null?null:String(saved.monthly_division_id),
        shippingPlanId:saved.shipping_plan_id==null?null:String(saved.shipping_plan_id),shippingDivisionId:saved.shipping_division_id==null?null:String(saved.shipping_division_id),
        basePlanId:saved.base_plan_id==null?null:String(saved.base_plan_id),baseDivisionId:saved.base_division_id==null?null:String(saved.base_division_id),
        weeklyPlanId:saved.weekly_plan_id==null?null:String(saved.weekly_plan_id),weeklyDivisionId:saved.weekly_division_id==null?null:String(saved.weekly_division_id),
        processTasks:savedTasks,allocationVersion:Number(saved.version),monthlyVersion:saved.monthly_version==null?null:Number(saved.monthly_version)};
    });
    if(!result.repeated) void this.sync.processOutbox().catch(()=>undefined);
    return {allocationId:result.allocationId,version:result.version,status:result.status,reason:result.reason,message:result.message,persisted,...(result.repeated?{repeated:true}:{})};
  }

  async allocationDivisionTransferStatus(id:string,key:string,actor:MasterPlanActor) {
    if(!uuidPattern.test(id)||!uuidPattern.test(key)) throw new BadRequestException("请求ID无效");
    const resource=this.resource("mps-order-allocations");
    if(!hasMasterPlanPermission(actor,resource.code,"read")) throw new ForbiddenException("没有订单分配读取权限");
    const storageKey=`mps-allocation-division-transfer:${actor.tenantId}:${actor.userId??MASTER_PLAN_SYSTEM_USER_ID}:${key}`;
    return this.dataSource.transaction(async manager=>{
      await manager.query("SELECT set_config('app.tenant_id',$1,true)",[actor.tenantId]);
      const [allocation]=await manager.query("SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND id=$2::uuid",[actor.tenantId,id]);
      if(!allocation||!this.recordAllowed(resource,allocation,actor,"read")) throw new NotFoundException("未找到事业部变更记录");
      const [entry]=await manager.query("SELECT response_json FROM idempotency_keys WHERE key=$1",[storageKey]);
      if(!entry || String(entry.response_json?.allocationId??"")!==id) throw new NotFoundException("未找到事业部变更记录");
      const [event]=await manager.query(`SELECT status,last_error FROM mps_reconciliation_outbox WHERE tenant_id=$1 AND idempotency_key=$2`,[actor.tenantId,entry.response_json.outboxKey]);
      const state=event?.status??"PENDING";
      const expectations=entry.response_json.transferExpectations;
      const base=expectations ? (expectations.base?.length?"COMMITTED":"NOT_APPLICABLE") : "NOT_TRACKED";
      const weekly=expectations ? (expectations.weekly?.length?"COMMITTED":"NOT_APPLICABLE") : "NOT_TRACKED";
      const processTasks=expectations ? (expectations.processRoutes?.length?"COMMITTED":expectations.weekly?.length?"PENDING_SYNC":"NOT_APPLICABLE") : "NOT_TRACKED";
      const hasUntracked=[base,weekly,processTasks].includes("NOT_TRACKED");
      const status=state==="SUCCESS"?(processTasks==="PENDING_SYNC"||hasUntracked?"PARTIAL":"SUCCESS"):
        state==="FAILED"||state==="BLOCKED"?"FAILED":state==="RUNNING"?"PROCESSING":"PENDING";
      const message=event?.last_error??(state==="SUCCESS"&&processTasks==="PENDING_SYNC"
        ?"订单分配、既有计划链及集团/月度投影已保存；空工序快照仍需由正式同步初始化。"
        :state==="SUCCESS"&&hasUntracked
          ?"订单分配及集团/月度投影已完成；历史请求缺少下游迁移台账，需继续核查。"
          :entry.response_json.message);
      return {allocationId:id,idempotencyKey:key,status,version:Number(entry.response_json.version),message,
        stages:{allocation:"COMMITTED",groupAndMonthly:state,base,weekly,processTasks}};
    });
  }

  private async allocationTransferPlanCoverage(manager: EntityManager, actor: MasterPlanActor, orderNumber: string, itemCode: string, divisionId: string, processTargetDivisionId?: string) {
    const definitions=[
      {resourceCode:"mps-monthly-plans",table:"mps_monthly_plans",kind:"monthly"},
      {resourceCode:"mps-base-plans",table:"mps_base_plans",kind:"base"},
      {resourceCode:"mps-weekly-plans",table:"mps_weekly_plans",kind:"weekly"}
    ] as const;
    const coverage:{monthly:Record<string,unknown>[];shipping:Record<string,unknown>[];base:Record<string,unknown>[];weekly:Record<string,any>[];processRoutes:Record<string,any>[];execution_weekly_count:number}={monthly:[],shipping:[],base:[],weekly:[],processRoutes:[],execution_weekly_count:0};
    for(const definition of definitions){
      const resource=this.resource(definition.resourceCode);
      if(!hasMasterPlanPermission(actor,resource.code,"read")) throw new ForbiddenException("需要同时具备月度、基础和周计划读取权限才能完整核查事业部变更");
      const rows=await manager.query(`SELECT * FROM ${definition.table} WHERE tenant_id=$1 AND order_number=$2 AND item_code=$3 AND division_id=$4::uuid ORDER BY id`,[actor.tenantId,orderNumber,itemCode,divisionId]);
      if(rows.length && (!hasMasterPlanPermission(actor,resource.code,"update") || !hasMasterPlanFieldPermission(actor,resource.code,"divisionId","update"))) throw new ForbiddenException("需要具备所有关联计划的事业部修改权限才能执行安全迁移");
      if(rows.some((row:Record<string,unknown>)=>!this.recordAllowed(resource,row,actor,"read") || !this.recordAllowed(resource,row,actor,"update")
        || (processTargetDivisionId!=null && !this.recordAllowed(resource,{...row,division_id:processTargetDivisionId},actor,"update")))) throw new ForbiddenException("当前计划数据范围不足以核查或迁移完整事业部计划链");
      coverage[definition.kind]=rows.map((row:Record<string,any>)=>({id:String(row.id),version:Number(row.version??0),plannedQuantity:String(row.required_quantity??row.planned_quantity??""),deliveryNumber:row.delivery_number??null,status:row.status??null,lifecycleStatus:row.lifecycle_status??null,divisionId:row.division_id==null?null:String(row.division_id),allocationId:row.allocation_id==null?null:String(row.allocation_id),monthlyPlanId:row.monthly_plan_id==null?null:String(row.monthly_plan_id),shippingPlanId:row.shipping_plan_id==null?null:String(row.shipping_plan_id),basePlanId:row.base_plan_id==null?null:String(row.base_plan_id)}));
      if(definition.kind==="weekly"){
        for(const row of rows){
          const [execution]=await manager.query(`SELECT (mps_weekly_has_execution($1,$2::uuid) OR EXISTS(
            SELECT 1 FROM mps_three_day_work_orders wo WHERE wo.tenant_id=$1 AND wo.weekly_plan_id=$2::uuid
              AND (wo.blank_completion_date IS NOT NULL OR wo.packaging_completion_date IS NOT NULL))) has_execution`,[actor.tenantId,row.id]);
          if(execution?.has_execution) coverage.execution_weekly_count++;
          const [context]=await manager.query(`SELECT
            EXISTS(SELECT 1 FROM mps_technical_reports r WHERE r.tenant_id=$1 AND r.weekly_plan_id=$2::uuid AND r.division_id IS DISTINCT FROM $3::uuid)
            OR EXISTS(SELECT 1 FROM mps_material_reports r WHERE r.tenant_id=$1 AND r.weekly_plan_id=$2::uuid AND r.division_id IS DISTINCT FROM $3::uuid)
            OR EXISTS(SELECT 1 FROM mps_outsourcing_reports r WHERE r.tenant_id=$1 AND r.weekly_plan_id=$2::uuid AND r.division_id IS DISTINCT FROM $3::uuid)
            OR EXISTS(SELECT 1 FROM mps_three_day_work_orders r WHERE r.tenant_id=$1 AND r.weekly_plan_id=$2::uuid AND r.division_id IS DISTINCT FROM $3::uuid) conflict`,[actor.tenantId,row.id,row.division_id]);
          const weeklySummary=coverage.weekly.find(plan=>plan.id===String(row.id));
          if(weeklySummary) weeklySummary.executionContextConflict=Boolean(context?.conflict);
          if(processTargetDivisionId){
            const [taskCount]=await manager.query("SELECT count(*)::int count FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid",[actor.tenantId,row.id]);
            if(Number(taskCount?.count)>0){
              if(!hasMasterPlanPermission(actor,"mps-division-process-configs","read") || !hasMasterPlanPermission(actor,"mps-item-process-routes","read"))
                throw new ForbiddenException("迁移已有工序快照需要读取事业部工序配置和品项工艺路线权限");
              coverage.processRoutes.push(await this.sync.previewDivisionTransferProcessRoute(manager,row,processTargetDivisionId,actor.tenantId));
            }
          }
        }
      }
    }
    const shippingResource=this.resource("mps-shipping-plans");
    if(!hasMasterPlanPermission(actor,shippingResource.code,"read")) throw new ForbiddenException("需要交期计划读取权限才能完整核查事业部变更");
    const shippingRows=await manager.query("SELECT * FROM mps_shipping_plans WHERE tenant_id=$1 AND order_number=$2 AND item_code=$3 AND division_id=$4::uuid ORDER BY id",[actor.tenantId,orderNumber,itemCode,divisionId]);
    if(shippingRows.length && (!hasMasterPlanPermission(actor,shippingResource.code,"update") || !hasMasterPlanFieldPermission(actor,shippingResource.code,"divisionId","update"))) throw new ForbiddenException("需要交期计划事业部修改权限才能执行安全迁移");
    if(shippingRows.some((row:Record<string,unknown>)=>!this.recordAllowed(shippingResource,row,actor,"read") || !this.recordAllowed(shippingResource,row,actor,"update")
      || (processTargetDivisionId!=null && !this.recordAllowed(shippingResource,{...row,division_id:processTargetDivisionId},actor,"update")))) throw new ForbiddenException("当前交期计划数据范围不足以核查或迁移事业部计划链");
    coverage.shipping=shippingRows.map((row:Record<string,unknown>)=>({id:String(row.id),version:Number(row.version??0),divisionId:row.division_id==null?null:String(row.division_id),monthlyPlanId:row.monthly_plan_id==null?null:String(row.monthly_plan_id),deliveryNumber:row.delivery_number??null,plannedQuantity:String(row.planned_quantity??"")}));
    return coverage;
  }

  private async migrateWeeklyExecutionContext(manager:EntityManager,weeklyPlanId:string,sourceDivisionId:string,targetDivisionId:string,actor:MasterPlanActor){
    const tables=[
      {resource:"mps-technical-reports",table:"mps_technical_reports",updatedBy:actor.userId??actor.username},
      {resource:"mps-material-reports",table:"mps_material_reports",updatedBy:actor.userId??actor.username},
      {resource:"mps-outsourcing-reports",table:"mps_outsourcing_reports",updatedBy:actor.userId??actor.username},
      {resource:"mps-three-day-work-orders",table:"mps_three_day_work_orders",updatedBy:actor.userId??MASTER_PLAN_SYSTEM_USER_ID}
    ] as const;
    for(const item of tables){
      const rows=await manager.query(`SELECT * FROM ${item.table} WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid ORDER BY id FOR UPDATE`,[actor.tenantId,weeklyPlanId]);
      for(const row of rows){
        if(String(row.division_id)!==sourceDivisionId) throw new ConflictException(`${item.resource}事业部上下文已变化，需人工核对后再迁移`);
        const [updated]=await manager.query(`UPDATE ${item.table} SET division_id=$3::uuid,updated_at=now(),updated_by=$4,version=version+1
          WHERE tenant_id=$1 AND id=$2::uuid AND division_id=$5::uuid RETURNING *`,[actor.tenantId,row.id,targetDivisionId,item.updatedBy,sourceDivisionId]);
        if(!updated) throw new ConflictException(`${item.resource}已被并发修改`);
        await this.audit(manager,actor,item.resource,String(row.id),`${item.resource}.division_transferred`,row,updated);
      }
    }
  }

  private async allocationTransferPlanMigrationBlockers(manager:EntityManager,actor:MasterPlanActor,allocation:Record<string,any>,plans:{monthly:Record<string,any>[];shipping:Record<string,any>[];base:Record<string,any>[];weekly:Record<string,any>[];processRoutes?:Record<string,any>[];execution_weekly_count:number}):Promise<string[]> {
    const blockers:string[]=[];
    if(plans.monthly.length!==1) blockers.push("原事业部必须恰有一条月度计划才能保留稳定ID迁移");
    if(plans.shipping.length>1 || plans.base.length>1 || plans.weekly.length>1) blockers.push("存在多个交期/批次计划，当前无法无歧义地逐链迁移");
    if(plans.weekly.some(weekly=>weekly.lifecycleStatus && weekly.lifecycleStatus!=="ACTIVE")) blockers.push("周计划处于待确认、暂停或取消状态，不能迁移执行快照");
    if(plans.weekly.some(weekly=>weekly.executionContextConflict)) blockers.push("周计划下游执行/工作单上下文与周计划事业部不一致，需先核对历史归属");
    if(plans.monthly.length===1){
      const monthly=plans.monthly[0]!;
      const [source]=await manager.query(`SELECT count(*)::int source_count FROM mps_order_allocations
        WHERE tenant_id=$1 AND order_number=$2 AND item_code=$3 AND archived_at IS NULL AND order_status='已审核'`,[actor.tenantId,allocation.order_number,allocation.item_code]);
      if(Number(source?.source_count)!==1) blockers.push("同订单品项存在多条有效分配来源，不能单独迁移月度计划");
      if(String(allocation.monthly_plan_id??"")!==String(monthly.id) || String(monthly.allocationId??"")!==String(allocation.id))
        blockers.push("订单分配monthly_plan_id与月度计划allocation_id未形成双向稳定关联");
      if(String(monthly.divisionId??allocation.division_id)!==String(allocation.division_id)) blockers.push("月度计划与订单分配当前事业部不一致");
      const [shippingCount]=await manager.query("SELECT count(*)::int count FROM mps_shipping_plans WHERE tenant_id=$1 AND monthly_plan_id=$2::uuid",[actor.tenantId,monthly.id]);
      if(Number(shippingCount?.count)!==plans.shipping.length) blockers.push("月度计划存在无法通过事业部与稳定父关系定位的交期记录");
      if(plans.shipping.length===1 && String(plans.shipping[0]!.monthlyPlanId??"")!==String(monthly.id)) blockers.push("交期计划未稳定关联到来源月度计划");
      const [baseParents]=await manager.query(`SELECT count(*)::int total,
        count(*) FILTER(WHERE division_id=$3::uuid)::int source_count,
        count(*) FILTER(WHERE shipping_plan_id IS NULL)::int direct_count
        FROM mps_base_plans b WHERE b.tenant_id=$1 AND (b.monthly_plan_id=$2::uuid OR b.shipping_plan_id IN(
          SELECT s.id FROM mps_shipping_plans s WHERE s.tenant_id=$1 AND s.monthly_plan_id=$2::uuid))`,[actor.tenantId,monthly.id,allocation.division_id]);
      const uniqueLegacyMonthlyParent=plans.shipping.length===0 && plans.base.length===1
        && String(plans.base[0]!.monthlyPlanId??"")===String(monthly.id)
        && plans.base[0]!.shippingPlanId==null
        && Number(baseParents?.total)===1 && Number(baseParents?.source_count)===1 && Number(baseParents?.direct_count)===1;
      const formallyLinkedShippingParent=plans.shipping.length===1 && plans.base.length<=1
        && Number(baseParents?.total)===plans.base.length && Number(baseParents?.source_count)===plans.base.length
        && plans.base.every(base=>String(base.shippingPlanId??"")===String(plans.shipping[0]!.id)
          && String(base.monthlyPlanId??"")===String(monthly.id));
      if(plans.base.length && !uniqueLegacyMonthlyParent && !formallyLinkedShippingParent) blockers.push("基础计划与月度/交期计划正式父关系不完整或冲突");
      if(plans.weekly.length && (plans.base.length!==1 || plans.weekly.some(weekly=>String(weekly.basePlanId??"")!==String(plans.base[0]!.id)))) blockers.push("周计划与基础计划稳定父关系不完整或冲突");
      if(plans.base.length && plans.shipping.length!==1 && !uniqueLegacyMonthlyParent) blockers.push("基础计划找不到唯一交期父记录或月度直连父记录");
      if(plans.weekly.length && plans.base.length!==1) blockers.push("周计划找不到唯一基础计划父记录");
      const [inbound]=await manager.query(`SELECT (m.cumulative_inbound_quantity>0 OR EXISTS(
          SELECT 1 FROM erp_staging_raw_records r JOIN finished_goods_inbound f ON f.source_database=r.source_database AND f.source_system=r.source_system AND f.source_key=r.source_id
            AND f.sales_order_number=r.order_number AND f.inventory_code=r.item_code AND f.received_quantity<>0
          WHERE r.tenant_id=m.tenant_id AND r.record_type='INBOUND_LINE' AND r.source_table='ST_RDRecord_b' AND r.order_link_stable=true AND r.status_code='189'
            AND r.order_number=m.order_number AND r.item_code=m.item_code)) has_inbound FROM mps_monthly_plans m WHERE m.tenant_id=$1 AND m.id=$2::uuid`,[actor.tenantId,monthly.id]);
      if(inbound?.has_inbound) blockers.push("月度计划存在累计入库或可核实ERP入库事实，无法确认其周计划归属");
      if(plans.execution_weekly_count>0) blockers.push("周计划存在生产执行事实，不能按未开工计划迁移");
      for(const route of plans.processRoutes??[]) blockers.push(...(route.blockers??[]));
    }
    return blockers;
  }

  /** KN-MPS-UI-WEEKLY-EXEC-001：业务人员按单条周计划手工重算执行任务，不走系统级同步权限或全租户扫描。 */
  async refreshWeeklyExecution(id: string, actor: MasterPlanActor) {
    const resource = this.resource("mps-weekly-plans");
    if (!hasMasterPlanPermission(actor, resource.code, "update")) throw new ForbiddenException("当前权限组没有该表修改权限");
    return this.translateDatabaseError(() => this.dataSource.transaction(async (manager) => {
      const [current] = await manager.query(`SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND id=$2::uuid FOR UPDATE`, [actor.tenantId, id]);
      if (!current) throw new NotFoundException("周计划不存在");
      if (!this.recordAllowed(resource, current, actor, "update")) throw new ForbiddenException("当前数据范围不允许刷新该记录");
      const refreshed = await this.sync.refreshWeeklyExecution(manager, id, actor.tenantId, actor.userId, actor.userId ?? actor.username);
      if (!refreshed) throw new NotFoundException("周计划不存在");
      const [updated] = await manager.query(`SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND id=$2::uuid`, [actor.tenantId, id]);
      await this.audit(manager, actor, resource.code, id, "mps-weekly-plans.execution_refreshed", current, updated);
      return { id, version: Number(updated.version) };
    }));
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
    if(code==="mps-order-allocations" && fieldKey==="divisionId") throw new ConflictException("承接事业部变更必须使用专用预览与确认操作");
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
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]);
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
      const allocationChanges: Array<{before: Record<string,unknown> | null; after: Record<string,unknown>}> = [];
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
          this.assertMappingTargetScope(resource, { ...current, [column]: value }, actor, "batch_update");
        } catch (error) {
          items.push({ id, success: false, reason: error instanceof Error ? error.message : "字段值不符合业务规则" }); continue;
        }
        if (code === "mps-order-allocations" && !allocationChange(current, { ...current, [column]: value }).fields.length) { items.push({id,success:true,version:Number(current.version)});continue; }
        const updated = await manager.query(`UPDATE ${resource.table} SET ${column}=$4,updated_at=now(),updated_by=$5::uuid,version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND version=$3 RETURNING *`, [actor.tenantId, id, expectedVersion, value, actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID]);
        const updatedRow = Array.isArray(updated[0]) ? updated[0][0] : updated[0];
        if (!updatedRow) { items.push({ id, success: false, reason: "记录版本已变化，请刷新后重试" }); continue; }
        allocationChanges.push({before:current,after:updatedRow});
        await this.audit(manager, actor, code, id, `${code}.batch_item_updated`, current, updatedRow);
        items.push({ id, success: true, version: Number(updatedRow.version) });
      }
      await this.allocationEvent(manager, code, actor, allocationChanges);
      const response = { batchId: idempotencyKey, submitted: records.length, succeeded: items.filter((item) => item.success).length, failed: items.filter((item) => !item.success).length, fieldKey, items, repeated: false };
      await this.audit(manager, actor, code, null, `${code}.batch_updated`, null, { ...response, idempotencyKey });
      await manager.query("INSERT INTO idempotency_keys(key,request_hash,response_json,created_by,updated_by) VALUES($1,$2,$3::jsonb,$4::uuid,$5)", [storageKey, requestHash, JSON.stringify(response), actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID, actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID]);
      if (response.succeeded > 0) {
        if (resource.code === "mps-base-plans") await this.enqueueBasePlanReconciliation(manager, actor, allocationChanges.map(change => change.after));
        else if(resource.code==='mps-order-allocations')await this.enqueueAllocationReconciliations(manager,actor,allocationChanges);
        else await this.enqueueReconciliation(manager, resource, actor);
      }
      return response;
    }));
    if (result.repeated || !result.succeeded) { void this.sync.processOutbox().catch(() => undefined); return result; }
    const reconciliation = await this.completeReconciliation(resource);
    return reconciliation ? { ...result, reconciliation } : result;
  }

  async importUpdates(code: string, rows: Array<{ row?:number; id: string | null; expectedVersion: number | null; values: Record<string, unknown> }>, fileHash: string, actor: MasterPlanActor, transactionManager?: EntityManager, allocationBatch?:{id:string;worksheet:string;fileHash:string}) {
    if (code === "mps-review-due-dates") throw new ForbiddenException("评审交期导入必须使用专用事务命令");
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "import")) throw new ForbiddenException("当前权限组没有该表导入权限");
    await this.enforceShippingWindow(resource, actor);
    if (!rows.length || rows.length > 50_000) throw new BadRequestException("导入数据必须为1至50000行");
    if(code==="mps-order-allocations"){
      if(!allocationBatch||!uuidPattern.test(allocationBatch.id)||!allocationBatch.worksheet||!/^[0-9a-f]{64}$/.test(allocationBatch.fileHash))throw new BadRequestException("导入预览已升级，请重新上传文件创建独立批次");
      if(rows.some(row=>row.id!=null||row.expectedVersion!=null||!Number.isInteger(row.row)||row.row!<2))throw new BadRequestException("订单分配导入必须按原始行号新增，不能更新历史记录");
      if(new Set(rows.map(row=>row.row)).size!==rows.length)throw new BadRequestException("同一批次原始行号重复");
    }
    const storageKey = `mps-import:${actor.tenantId}:${code}:${actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID}:${code==="mps-order-allocations"?allocationBatch!.id:fileHash}`;
    const work = async (manager: EntityManager) => {
      await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [storageKey]);
      const [existing] = await manager.query("SELECT response_json FROM idempotency_keys WHERE key=$1", [storageKey]);
      if (existing) return { ...existing.response_json, repeated: true };
      const actorId = actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID;
      if(code==="mps-order-allocations")await manager.query(`INSERT INTO mps_allocation_import_batches(id,tenant_id,file_hash,source_worksheet,row_count,imported_by) VALUES($1::uuid,$2,$3,$4,$5,$6::uuid)`,[allocationBatch!.id,actor.tenantId,allocationBatch!.fileHash,allocationBatch!.worksheet,rows.length,actorId]);
      const shippingMonthlyPlanIds = await this.shippingMonthlyPlanIds(resource, rows, actor.tenantId, manager);
      const importedLinks = ["mps-order-allocations","mps-base-plans"].includes(code) && await demandLinksReady(manager);
      const newAllocations: Array<Record<string,any>>=[];
      let createdCount = 0; let updatedCount = 0;
      const allocationChanges: Array<{before: Record<string,unknown> | null;after: Record<string,unknown>}> = [];
      for (const input of rows) {
        const creating = input.id == null && input.expectedVersion == null;
        if ((input.id == null) !== (input.expectedVersion == null)) throw new BadRequestException("新增时记录ID和版本都应留空；更新时必须同时填写");
        if (creating) {
          this.assertDirectCreateAllowed(resource);
          if (!resource.create || !hasMasterPlanPermission(actor, code, "create")) throw new ForbiddenException("当前权限组没有该表新增权限，不能导入新增记录");
          const values = this.writable(resource, input.values, actor, "create");
          this.validateRequiredOnCreate(resource, values);
          if(code==="mps-order-allocations")await this.assertAllocationVendorTarget(manager,values.supplierName,values.divisionId);
          await this.fillReportSource(resource, values, actor.tenantId, manager, shippingMonthlyPlanIds);
          this.assertCreateScope(resource, this.toDatabaseRecord(resource, values), actor);
          this.validateCrossFields(resource, this.toDatabaseRecord(resource, values));
          await this.assignDeliveryCode(resource, values, actor.tenantId, manager, actorId);
          const columns = columnsFor(resource); const entries = Object.entries(values);
          if (!entries.length) throw new BadRequestException("新增导入没有可写入的业务字段");
          const params: unknown[] = [actor.tenantId, actorId, ...entries.map(([, value]) => value)];
          let extraColumns="",extraValues="";
          if(code==="mps-order-allocations"){
            const start=params.length+1;params.push(allocationBatch!.id,allocationBatch!.worksheet,input.row);
            extraColumns=",manually_maintained,import_batch_id,source_worksheet,source_row_number,imported_at,imported_by";
            extraValues=`,true,$${start}::uuid,$${start+1},$${start+2}::integer,now(),$2::uuid`;
          }
          const inserted = await manager.query(`INSERT INTO ${resource.table}(tenant_id,created_by,updated_by,${entries.map(([field]) => columns[field]).join(",")}${extraColumns}) VALUES($1,$2::uuid,$2::uuid,${entries.map((_, index) => `$${index + 3}`).join(",")}${extraValues}) RETURNING *`, params);
          if(importedLinks && code==="mps-base-plans") inserted[0]=await linkNewDemandRecord(manager,'mps-base-plans',inserted[0],actorId,actor.username,actor.requestId);
          if(importedLinks && code==="mps-order-allocations") newAllocations.push(inserted[0]);
          allocationChanges.push({before:null,after:inserted[0]});
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
        if(code==="mps-order-allocations" && Object.hasOwn(values,"divisionId")
          && String(values.divisionId??"")!==String(current.division_id??"")) throw new ConflictException("Excel更新不能直接变更承接事业部，请使用专用预览与确认操作");
        if(code==="mps-order-allocations")await this.assertAllocationVendorTarget(manager,values.supplierName??current.supplier_name,values.divisionId??current.division_id);
        this.normalizeSystemSetting(resource, current, values);
        if (["mps-weekly-process-plans", "mps-material-reports", "mps-process-reports"].includes(resource.code) && "weeklyPlanId" in values) await this.fillReportSource(resource, values, actor.tenantId, manager);
        if (resource.code === "mps-shipping-plans" && ("orderNumber" in values || "itemCode" in values || "divisionId" in values)) {
          const link = { orderNumber:values.orderNumber ?? current.order_number,itemCode:values.itemCode ?? current.item_code,divisionId:(Object.hasOwn(values,"divisionId") ? values.divisionId : current.division_id) };
          await this.fillReportSource(resource,link,actor.tenantId,manager);
          values.monthlyPlanId = (link as Record<string,unknown>).monthlyPlanId;
        }
        if (!Object.keys(values).length) continue;
        const columns = columnsFor(resource); const entries = Object.entries(values);
        const databaseValues = this.toDatabaseRecord(resource, values);
        this.validateRequiredOnUpdate(resource, values, current);
        this.validateCrossFields(resource, { ...current, ...databaseValues });
        this.assertMappingTargetScope(resource, { ...current, ...databaseValues }, actor, "import");
        if (code === "mps-order-allocations" && !allocationChange(current, { ...current, ...databaseValues }).fields.length) continue;
        const params: unknown[] = [actor.tenantId, input.id, input.expectedVersion, actorId, ...entries.map(([, value]) => value)];
        const updated = await manager.query(`UPDATE ${resource.table} SET ${entries.map(([field], index) => `${columns[field]}=$${index + 5}`).join(",")},updated_at=now(),updated_by=$4::uuid,version=version+1 WHERE tenant_id=$1 AND id=$2::uuid AND version=$3 RETURNING *`, params);
        const updatedRow = Array.isArray(updated[0]) ? updated[0][0] : updated[0];
        if (!updatedRow) throw new ConflictException(`记录版本已变化，请重新导出后导入：${input.id}`);
        allocationChanges.push({before:current,after:updatedRow});
        await this.audit(manager, actor, code, input.id, `${code}.import_updated`, current, updatedRow);
        updatedCount++;
      }
      if(importedLinks && newAllocations.length) {
        // One demand calculation per newly imported business group, never an entire-tenant projection.
        const groups=new Map(newAllocations.filter(row=>row.order_status==='已审核').map(row=>[JSON.stringify([row.order_number,row.item_code,row.division_id]),row]));
        for(const row of groups.values())await ensureNewAllocationDemand(manager,row,actorId,actor.username,actor.requestId);
        const changesById=new Map(allocationChanges.map(change=>[String(change.after.id),change]));
        for(const row of newAllocations) {
          const linked=await linkNewDemandRecord(manager,'mps-order-allocations',row,actorId,actor.username,actor.requestId);
          const change=changesById.get(String(row.id));if(change)change.after=linked;
        }
      }
      await this.allocationEvent(manager, code, actor, allocationChanges);
      const response = { total: rows.length, created: createdCount, updated: updatedCount, repeated: false, ...(code==="mps-order-allocations"?{importBatchId:allocationBatch!.id}:{}) };
      await this.audit(manager, actor, code, null, `${code}.import_confirmed`, null, { ...response, fileHash });
      await manager.query("INSERT INTO idempotency_keys(key,request_hash,response_json,created_by,updated_by) VALUES($1,$2,$3::jsonb,$4::uuid,$4::uuid)", [storageKey, fileHash, JSON.stringify(response), actorId]);
      if (createdCount || updatedCount) {
        if (resource.code === "mps-base-plans") await this.enqueueBasePlanReconciliation(manager, actor, allocationChanges.map(change => change.after));
        else if(resource.code==='mps-order-allocations')await this.enqueueAllocationReconciliations(manager,actor,allocationChanges);
        else await this.enqueueReconciliation(manager, resource, actor);
      }
      return response;
    };
    const result = await this.translateDatabaseError(() => transactionManager ? work(transactionManager) : this.dataSource.transaction(work));
    if (transactionManager) return result;
    if (result.repeated || !(result.created + result.updated)) { void this.sync.processOutbox().catch(() => undefined); return result; }
    const reconciliation = await this.completeReconciliation(resource);
    return reconciliation ? { ...result, reconciliation } : result;
  }

  async validateImportUpdates(code: string, rows: Array<{ row: number; id: string | null; expectedVersion: number | null; values: Record<string, unknown> }>, actor: MasterPlanActor) {
    if (code === "mps-review-due-dates") throw new ForbiddenException("评审交期导入必须使用专用事务命令");
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
        if(code==="mps-order-allocations" && Object.hasOwn(values,"divisionId")
          && String(values.divisionId??"")!==String(current.division_id??"")) throw new ConflictException("Excel更新不能直接变更承接事业部，请使用专用预览与确认操作");
        this.normalizeSystemSetting(resource, current, values);
        if (["mps-weekly-process-plans", "mps-material-reports", "mps-process-reports"].includes(resource.code) && "weeklyPlanId" in values) await this.fillReportSource(resource, values, actor.tenantId);
        this.validateRequiredOnUpdate(resource, values, current);
        const mergedValues = this.completeValues(resource, current, values);
        this.validateCrossFields(resource, { ...current, ...this.toDatabaseRecord(resource, values) });
        this.assertMappingTargetScope(resource, { ...current, ...this.toDatabaseRecord(resource, values) }, actor, "update");
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
      if (["mps-external-process-mappings", "mps-review-due-dates"].includes(resource.code)) await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]);
      const activeAllocationClause = resource.code === "mps-order-allocations" ? " AND archived_at IS NULL" : "";
      const [current] = await manager.query(`SELECT * FROM ${resource.table} WHERE tenant_id=$1 AND id=$2::uuid${activeAllocationClause} FOR UPDATE`, [actor.tenantId, id]);
      if (!current) throw new NotFoundException("记录不存在");
      if (!this.recordAllowed(resource, current, actor, "delete")) throw new ForbiddenException("当前数据范围不允许删除该记录");
      if (Number(current.version) !== version) throw new ConflictException("记录已被其他用户修改，请刷新后重试");
      if (resource.code === "mps-order-allocations") {
        // Monthly plans retain a restrictive FK to this source row; archive it from active allocations instead of deleting history.
        const [archived] = await manager.query(`UPDATE mps_order_allocations SET archived_at=now(),updated_at=now(),updated_by=$3::uuid,version=version+1
          WHERE tenant_id=$1 AND id=$2::uuid AND version=$4 AND archived_at IS NULL RETURNING *`, [actor.tenantId, id, actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID, version]);
        if (!archived) throw new ConflictException("记录已被其他用户修改，请刷新后重试");
        await this.audit(manager, actor, code, id, `${code}.archived`, current, archived);
      } else {
        if (resource.code === "mps-review-due-dates") {
          await manager.query("SELECT set_config('app.review_due_delete_authorized','true',true)");
          await manager.query("DELETE FROM mps_review_due_date_changes WHERE tenant_id=$1 AND review_due_date_id=$2::uuid", [actor.tenantId, id]);
        }
        await manager.query(`DELETE FROM ${resource.table} WHERE tenant_id=$1 AND id=$2::uuid AND version=$3`, [actor.tenantId, id, version]);
        await this.audit(manager, actor, code, id, `${code}.deleted`, current, null);
      }
      if (resource.code !== "mps-review-due-dates") await this.enqueueReconciliation(manager, resource, actor, id, current);
      return { id, deleted: true, ...(resource.code === "mps-order-allocations" ? { archived: true } : {}) };
    }));
    if (resource.code === "mps-review-due-dates") return result;
    /* 删除实际报工后同样必须重新汇总，前端依据真实对账状态刷新周计划。 */
    const reconciliation = await this.completeReconciliation(resource);
    return reconciliation ? { ...result, reconciliation } : result;
  }

  async completeImportReconciliation(code:string,result:{created:number;updated:number;repeated?:boolean}) {
    if(result.repeated || !(result.created+result.updated))return result;
    const reconciliation=await this.completeReconciliation(this.resource(code));
    return reconciliation?{...result,reconciliation}:result;
  }

  allocationImportRecordAllowed(row:Record<string,unknown>,actor:MasterPlanActor) {
    const resource=this.resource("mps-order-allocations");
    return this.recordAllowed(resource,row,actor,"import") && this.recordAllowed(resource,row,actor,"read");
  }

  private async allocationEvent(manager: EntityManager, code: string, actor: MasterPlanActor, rows: Array<{before: Record<string,unknown> | null;after: Record<string,unknown>}>) {
    if(code!=="mps-order-allocations") return;
    const changes: AllocationChange[] = rows.map(r=>allocationChange(r.before,r.after)).filter(c=>c.fields.length>0);
    if(!changes.length) return;
    // Explicit human/import ownership survives the existing projection cadence.
    await manager.query("UPDATE mps_order_allocations SET manually_maintained=true WHERE tenant_id=$1 AND id=ANY($2::uuid[])",[actor.tenantId,changes.map(c=>c.after.id)]);
    if(!this.notifications) return;
    const [rule] = await manager.query("SELECT id FROM notification_rules WHERE tenant_id=$1 AND rule_key=$2 AND enabled=true",[actor.tenantId,ALLOCATION_RULE_KEY]);
    if(!rule) return; // no historical backlog when the switch is later enabled
    const units = await manager.query("SELECT id,name FROM organization_units");
    for (const change of changes) for (const snapshot of [change.before,change.after]) if(snapshot) snapshot.divisionName = units.find((u:{id:string;name:string})=>u.id===snapshot.divisionId)?.name??snapshot.divisionId;
    const [{id:batchId}] = await manager.query("SELECT uuidv7() AS id");
    await this.notifications.enqueueEvent(actor.tenantId,{eventType:ALLOCATION_EVENT,ruleId:rule.id,channel:"WECHAT_WORK",dedupKey:`allocation:${batchId}`,createdBy:actor.userId,payload:{batchId,actorUserId:actor.userId,actorName:actor.username,occurredAt:new Date().toISOString(),changes}},manager);
  }

  private resource(code: string) { const resource = MASTER_PLAN_RESOURCE_MAP.get(code as any); if (!resource) throw new NotFoundException("主计划表不存在"); return resource; }
  private assertDirectCreateAllowed(resource: MasterPlanResource) {
    if (resource.code === "mps-review-due-dates") throw new ForbiddenException("评审交期新增必须使用专用手工创建命令");
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
      if (field==='correctionReason' && resource.code==='mps-process-reports' && action==='update') continue;
      const definition = allowed.get(field); if (!definition) throw new BadRequestException(`字段 ${field} 不允许写入`);
      const canWrite = hasMasterPlanFieldPermission(actor, resource.code, field, "update")
        || (action === "create" && (hasMasterPlanFieldPermission(actor, resource.code, field, "read") || !hasMasterPlanPermission(actor, resource.code, "read")));
      if (!canWrite) throw new ForbiddenException(`当前权限组不能填写字段：${definition.label}`);
      output[field] = this.normalize(definition.type, raw, definition.label);
      if (output[field] != null && definition.format === "integer" && !Number.isInteger(Number(output[field]))) throw new BadRequestException(`${definition.label}必须为整数`);
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
    /* 新增主计划的交期编码由确认事务生成；预览阶段不能用空编码把同一订单+品项的拆分行误判为重复。 */
    if (["mps-shipping-plans", "mps-base-plans"].includes(resource.code) && values.deliveryNumber == null) return null;
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

  private monthlyPlanKey(orderNumber: unknown, itemCode: unknown, divisionId: unknown) { return `${String(orderNumber ?? "")}\u0000${String(itemCode ?? "")}\u0000${String(divisionId ?? "")}`; }

  private async shippingMonthlyPlanIds(resource: MasterPlanResource, rows: Array<{ values: Record<string, unknown> }>, tenantId: string, manager: Pick<EntityManager, "query">) {
    const result = new Map<string, string>();
    if (resource.code !== "mps-shipping-plans") return result;
    const pairs = rows.map((row) => ({ orderNumber: row.values.orderNumber, itemCode: row.values.itemCode }))
      .filter((pair) => pair.orderNumber != null && pair.itemCode != null);
    if (!pairs.length) return result;
    const monthlyRows = await manager.query(`SELECT id,order_number,item_code,division_id FROM mps_monthly_plans
      WHERE tenant_id=$1 AND (order_number,item_code) IN (SELECT * FROM unnest($2::text[],$3::text[]))`, [tenantId, pairs.map((pair) => String(pair.orderNumber)), pairs.map((pair) => String(pair.itemCode))]);
    for (const row of monthlyRows) result.set(this.monthlyPlanKey(row.order_number, row.item_code, row.division_id), row.id);
    return result;
  }

  private async fillReportSource(resource: MasterPlanResource, values: Record<string, unknown>, tenantId: string, manager: Pick<EntityManager, "query"> = this.dataSource.manager, shippingMonthlyPlanIds?: Map<string, string>) {
    if (resource.code === "mps-shipping-plans") {
      if (shippingMonthlyPlanIds) values.monthlyPlanId = shippingMonthlyPlanIds.get(this.monthlyPlanKey(values.orderNumber, values.itemCode, values.divisionId)) ?? null;
      else {
        const [monthly] = await manager.query(`SELECT id FROM mps_monthly_plans WHERE tenant_id=$1 AND order_number=$2 AND item_code=$3 AND division_id IS NOT DISTINCT FROM $4::uuid`, [tenantId, values.orderNumber, values.itemCode, values.divisionId]);
        values.monthlyPlanId = monthly?.id ?? null;
      }
    }
    if (resource.code === "mps-weekly-plans") values.pendingQuantity = values.plannedQuantity;
    if (!["mps-weekly-process-plans", "mps-material-reports", "mps-process-reports"].includes(resource.code)) return;
    const weeklyPlanId = String(values.weeklyPlanId ?? ""); if (!uuidPattern.test(weeklyPlanId)) throw new BadRequestException("请选择有效的周计划");
    const [weekly] = await manager.query(`SELECT division_id,order_number,item_code,item_name,delivery_number,planned_quantity,manufacturing_method FROM mps_weekly_plans WHERE tenant_id=$1 AND id=$2::uuid${resource.code === "mps-process-reports" ? " FOR UPDATE" : ""}`, [tenantId, weeklyPlanId]);
    if (!weekly) throw new BadRequestException("周计划不存在");
    if (["mps-weekly-process-plans", "mps-process-reports"].includes(resource.code) && !shouldEnableProcess(weekly.manufacturing_method, String(values.processCode ?? ""))) throw new BadRequestException("当前生产方式不允许创建该工序任务或工序报工");
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
      const [task] = await manager.query(`SELECT id FROM mps_weekly_process_plans WHERE tenant_id=$1 AND weekly_plan_id=$2::uuid AND process_code=$3 AND execution_enabled=true`, [tenantId, weeklyPlanId, values.processCode]);
      if (!task) throw new BadRequestException("该工序未包含在周计划工艺路线中，不能报工");
      values.processName = process[1];
    }
    this.validateCrossFields(resource, this.toDatabaseRecord(resource, values));
  }

  /**
   * 交期编码唯一生成入口：只给可直接新增的源/基础计划分配号码。
   * 周计划和各类报工快照从上游 UUID 复制编码，不能另行编号。
   * advisory xact lock 使同一租户+订单+品项的并发新增串行；counter 永久前进，删除不会复用。
   */
  private async assignDeliveryCode(resource: MasterPlanResource, values: Record<string, unknown>, tenantId: string, manager: Pick<EntityManager, "query">, actorId: string) {
    if (!["mps-shipping-plans", "mps-base-plans"].includes(resource.code)) return;
    if (values.deliveryNumber != null) throw new BadRequestException("交期编码由系统自动生成，不能人工填写");
    const orderNumber = String(values.orderNumber ?? "").trim();
    const itemCode = String(values.itemCode ?? "").trim();
    if (!orderNumber || !itemCode) throw new BadRequestException("生成交期编码前必须先填写订单编号和品项编码");
    values.deliveryNumber = await nextMasterPlanDeliveryCode(manager, tenantId, orderNumber, itemCode, actorId);
  }

  private async translateDatabaseError<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") throw new ConflictException("相同业务唯一键的记录已存在，请修改原记录");
      if (code === "23503") throw new BadRequestException("关联的上游记录不存在或已失效");
      if (code === "23001") throw new ConflictException("该记录已被下游业务引用，不能直接删除");
      if (code === "23502") throw new BadRequestException(`必填字段${(error as { column?: string }).column ? ` ${(error as { column?: string }).column}` : ""}不能为空`);
      if (code === "23514" && ["ck_mps_executed_identity", "ck_mps_report_context", "ck_mps_lifecycle", "ck_mps_lifecycle_execution"].includes(String((error as { constraint?: string }).constraint))) {
        throw new ConflictException((error as Error).message);
      }
      if (code === "23514") throw new BadRequestException("字段值不符合业务约束，请检查数量范围、选项及跨字段条件");
      if (code === "22003") throw new BadRequestException("数值超出数据库允许范围，请检查数字大小或小数格式");
      if (code === "22001") throw new BadRequestException("文本内容超过字段允许长度");
      if (["22P02", "22007", "22008"].includes(String(code))) throw new BadRequestException("字段类型或日期格式无效，请检查输入值");
      throw error;
    }
  }

  private toDatabaseRecord(resource: MasterPlanResource, values: Record<string, unknown>) { const columns = columnsFor(resource); return Object.fromEntries(Object.entries(values).map(([key, value]) => [columns[key], value])); }

  /**
   * 系统参数的 jsonb 只是存储容器，业务值仍按参数自己的契约校验。
   * 开放星期不接受 JSON 数组或中文逗号，持久化统一为稳定的英文逗号字符串，
   * 这样旧的单值 `5` 与新的多值 `2,4,5` 共用同一读取/编辑链路。
   */
  private normalizeSystemSetting(resource: MasterPlanResource, current: Record<string, unknown>, values: Record<string, unknown>) {
    if (resource.code !== "mps-system-settings" || !Object.prototype.hasOwnProperty.call(values, "valueJson")) return;
    if (String(current.setting_key ?? "") !== "shipping_edit_weekday") return;
    try {
      // value_json is jsonb.  The business value is a string, so the
      // parameter must be a JSON string literal ("2,4,5"), not the raw
      // unquoted text 2,4,5 which PostgreSQL rejects as invalid jsonb.
      values.valueJson = JSON.stringify(normalizeShippingEditWeekday(values.valueJson));
    } catch {
      throw new BadRequestException("请输入 1~7 的星期数字，多个星期使用英文逗号分隔，例如：2,4,5");
    }
  }
  private validateCrossFields(resource: MasterPlanResource, row: Record<string, unknown>) {
    if (resource.code === "mps-external-process-mappings") {
      if (row.source_key !== "tplus-kejia" || !/^[A-Za-z0-9_.:/-]{1,128}$/.test(String(row.source_process_code ?? ""))) throw new BadRequestException("来源账套或ERP工序编码无效");
      if (!["MATCH", "IGNORE"].includes(String(row.mapping_mode))) throw new BadRequestException("请选择匹配方式");
      if (row.mapping_mode === "MATCH" && !row.process_code) throw new BadRequestException("绑定时必须选择KDOS工序");
      if (row.mapping_mode === "IGNORE" && row.process_code != null) throw new BadRequestException("不参与内部报工时请清空KDOS工序");
    }

    if(resource.code === "mps-order-allocations") for(const [key,label,type] of ALLOCATION_FIELDS) {
      if(type !== "number" || row[allocationColumn(key)] == null) continue;
      const value=new Decimal(String(row[allocationColumn(key)])),scale=["financialExchangeRate","settlementRatio"].includes(key)?8:4;
      if(value.decimalPlaces()>scale || value.abs().gte(new Decimal(10).pow(20-scale))) throw new BadRequestException(`${label}超出数据库精度（最多${scale}位小数）`);
    }
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
    if (code === "mps-review-due-dates") throw new ForbiddenException("评审交期导入必须使用专用事务命令");
    const resource = this.resource(code);
    if (!hasMasterPlanPermission(actor, code, "import")) throw new ForbiddenException("当前权限组没有该表导入权限");
    try { await this.enforceShippingWindow(resource, actor); return null; }
    catch (error) {
      if (resource.code === "mps-shipping-plans" && error instanceof ForbiddenException) return "数据校验通过，但当前不在出货计划开放修改时间，暂不能确认导入。";
      throw error;
    }
  }

  /** Inline mapping controls follow the same field and row rules as the command. */
  externalProcessMappingCanWrite(row: Record<string, unknown>, actor: MasterPlanActor, existing: boolean) {
    const resource = this.resource("mps-external-process-mappings");
    const action = existing ? "update" : "create";
    if (!hasMasterPlanPermission(actor, resource.code, action) || !this.recordAllowed(resource, row, actor, "read")) return false;
    const fields = existing ? ["mappingMode", "processCode", "enabled"] : ["divisionId", "sourceKey", "sourceProcessCode", "sourceProcessName", "mappingMode", "processCode", "enabled"];
    if (!fields.every(f => hasMasterPlanFieldPermission(actor, resource.code, f, "update") || (!existing && hasMasterPlanFieldPermission(actor, resource.code, f, "read")))) return false;
    if (existing) return this.recordAllowed(resource, row, actor, "update");
    try { this.assertCreateScope(resource, row, actor); return true; } catch { return false; }
  }

  private assertMappingTargetScope(resource: MasterPlanResource, row: Record<string, unknown>, actor: MasterPlanActor, action: string) {
    if (resource.code === "mps-external-process-mappings" && !this.recordAllowed(resource,row,actor,action)) throw new ForbiddenException("工序映射不能移入未授权的事业部");
  }

  private recordAllowed(resource: MasterPlanResource, row: Record<string, unknown>, actor: MasterPlanActor, action: string) {
    if (resource.code === "mps-order-allocations" && row.archived_at != null) return false;
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

  private async enqueueBasePlanReconciliation(manager: EntityManager, actor: MasterPlanActor, records: Array<Record<string, unknown>>) {
    const uniqueById = new Map<string, Record<string, unknown>>();
    for (const row of records) { const id = String(row.id ?? ""); if (id) uniqueById.set(id, row); }
    const unique = [...uniqueById.values()];
    for (let offset = 0; offset < unique.length; offset += 100) {
      const chunk = unique.slice(offset, offset + 100);
      const ids = chunk.map(row => String(row.id));
      await this.enqueueReconciliation(manager, this.resource("mps-base-plans"), actor, ids[0]!, chunk[0]!, { basePlanIds: ids });
    }
  }

  private async enqueueAllocationReconciliations(manager:EntityManager,actor:MasterPlanActor,changes:Array<{before:Record<string,unknown>|null;after:Record<string,unknown>}>){
    const keys=new Map<string,Record<string,unknown>>();
    for(const change of changes)for(const row of [change.before,change.after])if(row&&row.order_number&&row.item_code&&uuidPattern.test(String(row.division_id??'')))keys.set(JSON.stringify([row.order_number,row.item_code,row.division_id]),row);
    for(const row of keys.values())await this.enqueueReconciliation(manager,this.resource('mps-order-allocations'),actor,String(row.id),row);
  }

  private async enqueueReconciliation(manager: EntityManager, resource: MasterPlanResource, actor: MasterPlanActor, recordId: string | null = null, record: Record<string, unknown> | null = null, scopeOverride?: Record<string, unknown>) {
    const actorId = actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID;
    /* 删除报工后事实行已不存在，故在同一事务内把稳定工序身份写入 durable outbox，而不是事后猜测。 */
    const scope = scopeOverride ?? (resource.code === "mps-base-plans" && recordId
      ? { basePlanIds: [recordId] }
      : resource.code === "mps-order-allocations" && recordId && record
        && Number.isInteger(Number(record.version)) && typeof record.order_number === "string"
        && typeof record.item_code === "string" && uuidPattern.test(String(record.division_id ?? ""))
      ? { allocationKey: { orderNumber: String(record.order_number),
          itemCode: String(record.item_code), divisionId: String(record.division_id) } }
      : resource.code === "mps-process-reports" || resource.code === "mps-weekly-process-plans"
      ? this.executionScope(record)
      : null);
    const scopeIdentity = scope == null ? "" : `:${createHash("sha256").update(JSON.stringify(scope)).digest("hex").slice(0, 16)}`;
    const keys=(RECONCILIATION_JOBS[resource.code]??[]).map(syncKey=>({syncKey,key:`outbox:${actor.requestId}:${resource.code}:${syncKey}${scopeIdentity}`}));
    for (const {syncKey,key} of keys) await manager.query(`
      INSERT INTO mps_reconciliation_outbox(tenant_id,resource,record_id,sync_key,scope_json,idempotency_key,actor_id,actor_name,created_by,updated_by)
      VALUES($1,$2,$3::uuid,$4,$5::jsonb,$6,$7::uuid,$8,$7::uuid,$7::uuid)
      ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
    [actor.tenantId, resource.code, recordId, syncKey, scope == null ? null : JSON.stringify(scope), key, actorId, actor.username]);
    return keys.map(entry=>entry.key);
  }

  private async enqueueShippingPlanKeyFieldsChanged(
    manager: EntityManager,
    actor: MasterPlanActor,
    before: Record<string, unknown>,
    after: Record<string, unknown>
  ) {
    const changedFields = SHIPPING_PLAN_KEY_FIELDS.filter((field) => this.shippingFieldChanged(field, before[field.column], after[field.column]));
    if (!changedFields.length) return;
    if (!this.notifications) throw new ConflictException("通知基础设施未配置");
    const divisionIds = [before.division_id, after.division_id]
      .map((value) => String(value ?? "").trim())
      .filter((value, index, values) => uuidPattern.test(value) && values.indexOf(value) === index);
    const divisionNames = await this.shippingDivisionNames(manager, divisionIds);
    const changeSummary = changedFields.map((field) => {
      const beforeValue = this.shippingDisplayValue(field, before[field.column], divisionNames);
      const afterValue = this.shippingDisplayValue(field, after[field.column], divisionNames);
      return `${field.label}：${beforeValue} → ${afterValue}`;
    }).join("\n");
    const recordId = String(after.id ?? before.id ?? "");
    const version = Number(after.version);
    const divisionId = String(after.division_id ?? "").trim();
    const occurredAt = new Date().toISOString();
    await this.notifications.enqueueEvent(actor.tenantId, {
      eventType: SHIPPING_PLAN_KEY_FIELDS_CHANGED_EVENT,
      channel: "WECHAT_WORK",
      dedupKey: `mps-shipping-plans:${recordId}:${version}:${SHIPPING_PLAN_KEY_FIELDS_CHANGED_EVENT}`,
      payload: {
        recordId,
        customerCode: after.customer_code ?? null,
        orderNumber: after.order_number ?? null,
        itemCode: after.item_code ?? null,
        itemName: after.item_name ?? null,
        deliveryNumber: after.delivery_number ?? null,
        divisionName: divisionNames.get(divisionId) ?? (divisionId || null),
        changeSummary,
        actorName: actor.username,
        occurredAt
      },
      createdBy: actor.userId
    }, manager);
  }

  private shippingFieldChanged(field: (typeof SHIPPING_PLAN_KEY_FIELDS)[number], before: unknown, after: unknown) {
    if (field.kind === "date") return this.dateText(before) !== this.dateText(after);
    if (field.kind === "number") {
      try { return new Decimal(String(before ?? "0")).eq(new Decimal(String(after ?? "0"))) === false; }
      catch { return String(before ?? "") !== String(after ?? ""); }
    }
    return String(before ?? "") !== String(after ?? "");
  }

  private shippingDisplayValue(field: (typeof SHIPPING_PLAN_KEY_FIELDS)[number], value: unknown, divisionNames: Map<string, string>) {
    if (value == null || value === "") return "空";
    if (field.kind === "date") return this.dateText(value) ?? "空";
    if (field.kind === "number") {
      try { return new Decimal(String(value)).toString(); } catch { return String(value); }
    }
    if (field.kind === "division") return divisionNames.get(String(value)) ?? String(value);
    return String(value);
  }

  private async shippingDivisionNames(manager: Pick<EntityManager, "query">, ids: string[]) {
    const names = new Map<string, string>();
    if (!ids.length) return names;
    const rows = await manager.query("SELECT id,name FROM organization_units WHERE id=ANY($1::uuid[])", [ids]);
    for (const row of rows) names.set(String(row.id), String(row.name));
    return names;
  }

  private async completeReconciliation(resource: MasterPlanResource) {
    if (resource.code === "mps-external-process-mappings" || resource.code === "mps-review-due-dates") return undefined;
    const feedback = RECONCILIATION_FEEDBACK[resource.code];
    if (!feedback) { void this.sync.processOutbox().catch(() => undefined); return undefined; }
    /* durable event 已随业务写入提交；仅触发后台消费者，HTTP 绝不等待全租户 reconciliation。 */
    void this.sync.processOutbox().catch(() => undefined);
    return { status: "PENDING", message: feedback.pending };
  }

  private executionScope(record: Record<string, unknown> | null) {
    const weeklyPlanId = record?.weekly_plan_id ?? record?.weeklyPlanId;
    const processCode = record?.process_code ?? record?.processCode;
    return typeof weeklyPlanId === "string" && typeof processCode === "string" && weeklyPlanId && processCode
      ? { weeklyPlanId, processCode }
      : null;
  }

  private async enforceShippingWindow(resource: MasterPlanResource, actor: MasterPlanActor) {
    if (resource.code !== "mps-shipping-plans") return;
    const rows = await this.dataSource.query(`SELECT setting_key,value_json FROM mps_system_settings WHERE tenant_id=$1 AND setting_key IN ('shipping_edit_weekday','shipping_temporary_unlock_until')`, [actor.tenantId]);
    const settings = new Map(rows.map((row: any) => [row.setting_key, row.value_json]));
    /* KN-MPS-LIVE-002：单一解析入口。临时解锁优先；开放星期支持 "2,4,5"；非法配置 fail closed。 */
    assertShippingEditAllowed({
      editWeekday: settings.get("shipping_edit_weekday"),
      temporaryUnlockUntil: settings.get("shipping_temporary_unlock_until")
    });
  }

  private audit(manager: EntityManager, actor: MasterPlanActor, resource: string, recordId: string | null, action: string, before: unknown, after: unknown) {
    const actorId = actor.userId ?? MASTER_PLAN_SYSTEM_USER_ID;
    /* audit_logs 的持久化枚举将系统调用归档为 API；应用层仍以 system 表示非人工来源。 */
    const source = actor.source === "system" ? "api" : actor.source;
    if (resource === "mps-order-allocations") {
      if (before && typeof before === "object" && "id" in before) before = allocationSnapshot(before as Record<string,unknown>);
      if (after && typeof after === "object" && "id" in after) {
        const allocation = after as Record<string,unknown>, snapshot = allocationSnapshot(allocation);
        after = allocation.archived_at == null ? snapshot : { ...snapshot, archived: true, archivedAt: allocation.archived_at instanceof Date ? allocation.archived_at.toISOString() : allocation.archived_at, version: Number(allocation.version) };
      }
    }
    return manager.query(`INSERT INTO audit_logs(actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by,tenant_id) VALUES($1::uuid,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$1::uuid,$1::uuid,$10)`, [actorId, actor.username, resource, recordId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), actor.requestId, source, actor.tenantId]);
  }
}
