import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import Decimal from 'decimal.js';
import { DataSource, EntityManager } from 'typeorm';
import { mpsLifecycleResources, mpsLifecycleOperations, type MpsLifecycleOperation, type MpsLifecyclePreview, type MpsPlanLifecycleStatus } from '@kdos/contracts';
import { buildDataScopeClause } from '../../common/filtering/data-scope';
import { columnsFor, fieldsFor, MASTER_PLAN_RESOURCE_MAP } from './master-plan.config';
import { hasMasterPlanPermission, hasMasterPlanFieldPermission, type MasterPlanActor } from './master-plan.types';
import { readMpsLifecycleAvailability, requireMpsLifecycleAvailable } from './master-plan.lifecycle-availability';
type Row = Record<string, any>;
const tables = { 'mps-monthly-plans': 'mps_monthly_plans', 'mps-base-plans': 'mps_base_plans', 'mps-weekly-plans': 'mps_weekly_plans' } as const;
const uuid = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const canonical = (value: unknown): string => JSON.stringify(value, (_key, next) => next && typeof next === 'object' && !Array.isArray(next) ? Object.fromEntries(Object.keys(next).sort().map(k => [k, next[k]])) : next);
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const mpsLifecycleWritesEnabled = () => process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED === 'true';
/** Existing sync runner receives an actual failure, never an ignored lifecycle skip. */
export async function assertMpsLifecycleSyncReady(manager: Pick<EntityManager, 'query'>, tenant: string, resources: string[]) {
    for (const resource of resources) {
        const table = tables[resource as keyof typeof tables];
        if (!table)
            throw new Error('Unregistered lifecycle sync resource');
        // Hold the snapshot's parent rows until the existing sync transaction commits.
        // A concurrent lifecycle command cannot pass between the guard and projection writes.
        const [row] = await manager.query(`WITH lifecycle_rows AS MATERIALIZED (
          SELECT COALESCE(to_jsonb(p)->>'lifecycle_status','ACTIVE') status FROM ${table} p WHERE p.tenant_id=$1 FOR SHARE
        ) SELECT count(*)::integer count FROM lifecycle_rows WHERE status<>'ACTIVE'`, [tenant]);
        if (Number(row?.count) > 0)
            throw new ConflictException(`LIFECYCLE_BLOCKED: ${resource}存在暂停、取消或来源待确认计划；本阶段不自动重激活或级联处理`);
    }
}
@Injectable()
export class MasterPlanLifecycleService {
    constructor(private readonly db: DataSource) { }
    availability(resource: string) {
        return readMpsLifecycleAvailability(this.db, resource);
    }
    async assertAvailable(resource: string, manager: Pick<EntityManager, 'query'> = this.db) {
        const availability = await readMpsLifecycleAvailability(manager, resource);
        requireMpsLifecycleAvailable(availability);
        return availability;
    }
    private validate(resource: string, id: string, operation: string) {
        if (!(mpsLifecycleResources as readonly string[]).includes(resource) || !uuid.test(id) || !Object.hasOwn(mpsLifecycleOperations, operation))
            throw new BadRequestException('生命周期资源、记录或操作无效');
    }
    private requirePermission(actor: MasterPlanActor, resource: string, operation: MpsLifecycleOperation) {
        const capability = mpsLifecycleOperations[operation].capability;
        if (!actor.userId || !hasMasterPlanPermission(actor, resource, 'read') || !hasMasterPlanPermission(actor, resource, 'update') || !hasMasterPlanPermission(actor, capability, 'update'))
            throw new ForbiddenException('缺少计划查看、编辑或独立生命周期操作权限');
        const quantity = resource === 'mps-monthly-plans' ? 'requiredQuantity' : 'plannedQuantity';
        if (!['orderNumber', 'itemCode', 'divisionId', quantity, 'lifecycleStatus'].every(f => hasMasterPlanFieldPermission(actor, resource, f, 'read')))
            throw new ForbiddenException('生命周期预览需要身份、数量及状态字段读取权限');
    }
    private async scope(m: EntityManager, resource: string, row: Row, actor: MasterPlanActor, write = true) {
        if (!hasMasterPlanPermission(actor, resource, 'read') || (write && !hasMasterPlanPermission(actor, resource, 'update')))
            throw new ForbiddenException('关联计划或执行事实超出当前权限');
        if (actor.isSystemAdmin || actor.permissions.includes('*') || actor.moduleAdminCodes?.includes('planning'))
            return;
        const definition = MASTER_PLAN_RESOURCE_MAP.get(resource as Parameters<typeof MASTER_PLAN_RESOURCE_MAP.get>[0]);
        if (!definition)
            throw new ForbiddenException('不支持的关联数据范围');
        for (const action of write ? ['read', 'update'] : ['read']) {
            const p: unknown[] = [actor.tenantId, row.id];
            const clause = buildDataScopeClause({ resource, action, params: p, columns: columnsFor(definition), numericFields: fieldsFor(definition).filter(f => f.type === 'number').map(f => f.key), actor: { ...actor, tableDataScopes: actor.tableDataScopes.filter(s => s.scope !== 'NONE') } });
            const found = await m.query(`SELECT record.id FROM ${definition.table} record WHERE record.tenant_id=$1 AND record.id=$2::uuid AND (${clause})`, p);
            if (!found.length)
                throw new ForbiddenException('关联计划或执行事实超出当前数据范围');
        }
    }
    private secret() { const secret = process.env.JWT_ACCESS_SECRET; if (!secret)
        throw new ServiceUnavailableException('生命周期预览签名服务未配置'); return secret; }
    private sign(payload: Row) { const data = Buffer.from(canonical(payload)).toString('base64url'); return data + '.' + createHmac('sha256', this.secret()).update(data).digest('base64url'); }
    private verify(token: string) {
        if (typeof token !== 'string' || token.length > 4096)
            throw new BadRequestException('预览凭据无效');
        const [data, signature, ...extra] = token.split('.');
        const expected = createHmac('sha256', this.secret()).update(data ?? '').digest();
        const supplied = Buffer.from(signature ?? '', 'base64url');
        if (extra.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
            throw new ConflictException('预览凭据无效，请重新预览');
        try {
            return JSON.parse(Buffer.from(data, 'base64url').toString()) as Row;
        }
        catch {
            throw new ConflictException('预览凭据无效，请重新预览');
        }
    }
    private async inspect(m: EntityManager, resource: string, id: string, operation: MpsLifecycleOperation, actor: MasterPlanActor, lock = false) {
        const suffix = lock ? ' FOR UPDATE' : '';
        const [plan]: Row[] = await m.query(`SELECT * FROM ${tables[resource as keyof typeof tables]} WHERE tenant_id=$1 AND id=$2::uuid${suffix}`, [actor.tenantId, id]);
        if (!plan)
            throw new NotFoundException('计划不存在或不属于当前租户');
        await this.scope(m, resource, plan, actor);
        const t = actor.tenantId;
        let monthly: Row[] = [], base: Row[] = [], weekly: Row[] = [];
        if (resource === 'mps-monthly-plans')
            monthly = [plan];
        if (resource === 'mps-base-plans')
            base = [plan];
        if (resource === 'mps-weekly-plans') {
            weekly = [plan];
            base = await m.query(`SELECT * FROM mps_base_plans WHERE tenant_id=$1 AND id=$2::uuid${suffix}`, [t, plan.base_plan_id]);
        }
        if (!monthly.length && base.length) {
            const source = base[0];
            monthly = await m.query(`SELECT m.* FROM mps_monthly_plans m WHERE m.tenant_id=$1 AND (
        m.id=(SELECT s.monthly_plan_id FROM mps_shipping_plans s WHERE s.tenant_id=$1 AND s.id=$2::uuid)
        OR (NOT EXISTS(SELECT 1 FROM mps_shipping_plans s WHERE s.tenant_id=$1 AND s.id=$2::uuid AND s.monthly_plan_id IS NOT NULL)
          AND m.order_number=$3 AND m.item_code=$4 AND m.division_id IS NOT DISTINCT FROM $5::uuid)) ORDER BY m.id${suffix}`, [t, source.shipping_plan_id, source.order_number, source.item_code, source.division_id]);
        }
        if (resource === 'mps-monthly-plans')
            base = await m.query(`SELECT b.* FROM mps_base_plans b LEFT JOIN mps_shipping_plans s ON s.tenant_id=b.tenant_id AND s.id=b.shipping_plan_id
      WHERE b.tenant_id=$1 AND (s.monthly_plan_id=$2::uuid OR (s.monthly_plan_id IS NULL AND b.order_number=$3 AND b.item_code=$4 AND b.division_id IS NOT DISTINCT FROM $5::uuid)) ORDER BY b.id${lock ? ' FOR UPDATE OF b' : ''}`, [t, id, plan.order_number, plan.item_code, plan.division_id]);
        if (resource !== 'mps-weekly-plans' && base.length)
            weekly = await m.query(`SELECT * FROM mps_weekly_plans WHERE tenant_id=$1 AND base_plan_id=ANY($2::uuid[]) ORDER BY id${suffix}`, [t, base.map(p => p.id)]);
        const related = [...monthly.map(p => ({ resource: 'mps-monthly-plans', row: p })), ...base.map(p => ({ resource: 'mps-base-plans', row: p })), ...weekly.map(p => ({ resource: 'mps-weekly-plans', row: p }))];
        for (const p of related) {
            await this.scope(m, p.resource, p.row, actor);
            this.requirePermission(actor,p.resource,operation);
        }
    const allocations: Row[] = await m.query(`SELECT * FROM mps_order_allocations WHERE tenant_id=$1 AND (id=ANY($2::uuid[]) OR (order_number=$3 AND item_code=$4 AND division_id IS NOT DISTINCT FROM $5::uuid)) ORDER BY id${lock ? ' FOR SHARE' : ''}`, [t, monthly.map(p => p.allocation_id).filter(Boolean), plan.order_number, plan.item_code, plan.division_id]);
        for (const allocation of allocations) await this.scope(m,'mps-order-allocations',allocation,actor,false);
        const ids = weekly.map(p => p.id);
        const facts: Record<string, Row[]> = {};
        for (const [key, table, code] of [
            ['reports', 'mps_process_reports', 'mps-process-reports'], ['technical', 'mps_technical_reports', 'mps-technical-reports'],
            ['material', 'mps_material_reports', 'mps-material-reports'], ['outsourcing', 'mps_outsourcing_reports', 'mps-outsourcing-reports'],
            ['workOrders', 'mps_three_day_work_orders', 'mps-three-day-work-orders'], ['processes', 'mps_weekly_process_plans', 'mps-weekly-process-plans']
        ]) {
            facts[key] = ids.length ? await m.query(`SELECT r.*,${key === 'processes' ? 'false' : `mps_execution_content('${table}',to_jsonb(r))`} has_content FROM ${table} r WHERE r.tenant_id=$1 AND r.weekly_plan_id=ANY($2::uuid[]) ORDER BY r.id`, [t, ids]) : [];
            if (key !== 'processes')
                for (const row of facts[key]) {
                    await this.scope(m, code, row, actor, false);
                    if (key === 'reports' && !hasMasterPlanFieldPermission(actor, code, 'productionQuantity', 'read'))
                        throw new ForbiddenException('缺少历史报工数量读取权限');
                }
        }
        // Tenant-owned canonical staging proves inbound identity; a missing allocation is never proof of no inventory.
        const inbound: Row[] = await m.query(`SELECT r.source_database,r.source_system,r.source_id,f.received_quantity FROM erp_staging_raw_records r
      JOIN finished_goods_inbound f ON f.source_database=r.source_database AND f.source_system=r.source_system AND f.source_key=r.source_id
      AND f.sales_order_number=r.order_number AND f.inventory_code=r.item_code
      WHERE r.tenant_id=$1 AND r.order_number=$2 AND r.item_code=$3 AND r.record_type='INBOUND_LINE' AND r.source_table='ST_RDRecord_b'
      AND r.order_link_stable=true AND r.status_code='189' AND f.received_quantity<>0 ORDER BY r.source_database,r.source_system,r.source_id,f.received_quantity`, [t, plan.order_number, plan.item_code]);
        const [divisionInfo] = await m.query('SELECT name FROM organization_units WHERE id=$1::uuid', [plan.division_id]);
        const unresolvedInbound: Row[] = await m.query(`SELECT source_database,source_system,source_id,order_link_stable,status_code FROM erp_staging_raw_records
      WHERE tenant_id=$1 AND order_number=$2 AND item_code=$3 AND record_type='INBOUND_LINE'
      AND (order_link_stable IS DISTINCT FROM true OR status_code IS DISTINCT FROM '189') ORDER BY source_database,source_system,source_id`, [t, plan.order_number, plan.item_code]);
        const quantity = String(resource === 'mps-monthly-plans' ? plan.required_quantity : plan.planned_quantity);
        const hasInbound = inbound.length > 0 || monthly.some(p => new Decimal(p.cumulative_inbound_quantity ?? 0).gt(0)) || weekly.some(p => new Decimal(p.allocated_inbound_quantity ?? 0).gt(0));
        const actualReports = facts.reports.length;
        const internal = facts.technical.filter(r => r.has_content).length + facts.material.filter(r => r.has_content).length;
        const external = facts.outsourcing.filter(r => r.has_content || r.execution_enabled === true).length;
        const workOrders = facts.workOrders.length;
        const summary = { reportCount: actualReports, reportedQuantity: facts.reports.reduce((n, r) => n.plus(r.production_quantity), new Decimal(0)).toString(), technicalExecution: facts.technical.filter(r => r.has_content).length, materialExecution: facts.material.filter(r => r.has_content).length, outsourcingDependencies: external, workOrderDependencies: workOrders, hasInbound, processLocked: weekly.some(p => p.process_config_locked_at != null) };
        const blockers: string[] = [];
        const status = plan.lifecycle_status as MpsPlanLifecycleStatus;
        const allowedFrom: Record<MpsLifecycleOperation, string[]> = { HOLD: ['ACTIVE'], CANCEL: ['ACTIVE', 'ON_HOLD'], CANCEL_REMAINING: ['ACTIVE', 'ON_HOLD'], RESTORE: ['ON_HOLD', 'CANCELLED', 'LEGACY_RETAINED'] };
        if (!allowedFrom[operation].includes(status))
            blockers.push('当前生命周期不允许该转换；历史保留计划须先核实来源并确认有效');
        const source = resource === 'mps-weekly-plans' ? base : resource === 'mps-base-plans' ? monthly : allocations.filter(a => a.archived_at == null && a.order_status === '已审核');
        if (operation !== 'HOLD') {
            if (resource !== 'mps-monthly-plans' && (monthly.length !== 1 || monthly[0]?.lifecycle_status !== 'ACTIVE'))
                blockers.push('完整上游月度需求尚未确认有效，禁止直接取消或恢复');
            for (const month of monthly) {
                const demand = allocations.filter(a => a.archived_at == null && a.order_status === '已审核'
                    && a.order_number === month.order_number && a.item_code === month.item_code && a.division_id === month.division_id);
                if (!demand.some(a => a.id === month.allocation_id) || demand.some(a => a.manually_maintained !== true || !a.customer_code?.trim() || a.customer_code !== month.customer_code)
                    || !demand.reduce((n,a) => n.plus(a.allocated_quantity),new Decimal(0)).eq(month.required_quantity))
                    blockers.push('上游订单分配已失效、归属未确认或需求数量存在冲突');
            }
            if (resource === 'mps-monthly-plans') {
                const linked = allocations.find(a => a.id === plan.allocation_id && a.archived_at == null && a.order_status === '已审核');
                if (!linked || !source.length || source.some(p => p.order_number !== plan.order_number || p.item_code !== plan.item_code || p.division_id !== plan.division_id || p.manually_maintained !== true || !p.customer_code?.trim() || p.customer_code !== plan.customer_code))
                    blockers.push('上游有效需求或稳定来源归属未核实');
                const total = source.reduce((n, p) => n.plus(p.allocated_quantity), new Decimal(0));
                if (!total.eq(quantity))
                    blockers.push('当前计划数量与上游有效需求冲突');
            }
            else {
                if (source.length !== 1 || source[0]?.lifecycle_status !== 'ACTIVE' || source[0]?.order_number !== plan.order_number || source[0]?.item_code !== plan.item_code || source[0]?.division_id !== plan.division_id)
                    blockers.push('上游计划来源不唯一、不活动或历史身份冲突');
                else if (!new Decimal(source[0].planned_quantity ?? source[0].required_quantity).eq(quantity))
                    blockers.push('当前计划数量与上游计划数量冲突');
                if (resource === 'mps-weekly-plans' && source.length === 1
                    && (source[0].manufacturing_method !== plan.manufacturing_method || String(source[0].delivery_number) !== String(plan.delivery_number)))
                    blockers.push('制造方式或交期身份与原基础计划冲突，禁止直接迁移历史归属');
            }
            const [org] = await m.query('SELECT id FROM organization_units WHERE id=$1::uuid AND enabled=true', [plan.division_id]);
            if (!org)
                blockers.push('原事业部已停用或身份不合法');
            const duplicate = await m.query(`SELECT id FROM ${tables[resource as keyof typeof tables]} WHERE tenant_id=$1 AND id<>$2::uuid AND order_number=$3 AND item_code=$4 AND division_id IS NOT DISTINCT FROM $5::uuid
        ${resource === 'mps-monthly-plans' ? '' : 'AND delivery_number=$6'} AND lifecycle_status IN ('ACTIVE','ON_HOLD') LIMIT 1`, resource === 'mps-monthly-plans' ? [t, id, plan.order_number, plan.item_code, plan.division_id] : [t, id, plan.order_number, plan.item_code, plan.division_id, plan.delivery_number]);
            if (duplicate.length)
                blockers.push('存在新的重复有效计划，禁止直接恢复或取消归属不明需求');
            if (hasInbound)
                blockers.push('存在真实入库关联；请先完成库存业务核验，可选择暂停');
            if (unresolvedInbound.length)
                blockers.push('存在来源或状态尚未确认的入库关联，可选择暂停后核验');
            if (external || workOrders)
                blockers.push('存在外协或生产工单关联待处置，可选择暂停');
            if (resource !== 'mps-weekly-plans' && (operation !== 'RESTORE' || status === 'CANCELLED'))
                blockers.push('父计划取消/取消后恢复消费者尚未完成（第二、三阶段），本轮禁止实际写入');
        }
        if (operation === 'CANCEL' && (actualReports || internal || summary.processLocked))
            blockers.push('已有生产执行事实，需要独立剩余需求取消权限和专用操作');
        if (operation === 'CANCEL_REMAINING' && !actualReports && !internal && !summary.processLocked)
            blockers.push('尚无执行事实，请使用未执行计划取消');
        if (!mpsLifecycleWritesEnabled())
            blockers.push('计划生命周期写入开关默认关闭；仅可预览');
        const requiredPermissions = [`${resource}:*:read`, `${resource}:*:update`, `${mpsLifecycleOperations[operation].capability}:*:update`];
        const snapshotHash = digest({ plan, monthly, base, weekly, allocations, facts, inbound, unresolvedInbound, writesEnabled: mpsLifecycleWritesEnabled() });
        const result = { resource, recordId: id, operation, currentStatus: status, targetStatus: mpsLifecycleOperations[operation].target, orderNumber: String(plan.order_number), itemCode: String(plan.item_code), divisionId: plan.division_id, divisionName: divisionInfo?.name ?? null, plannedQuantity: quantity, expectedVersion: Number(plan.version), facts: summary, affectedPlans: related.map(p => ({ resource: p.resource, id: p.row.id, status: p.row.lifecycle_status, orderNumber: p.row.order_number, itemCode: p.row.item_code, deliveryNumber: p.row.delivery_number == null ? null : String(p.row.delivery_number) })), allowed: !blockers.length, blockers, requiredPermissions, writesEnabled: mpsLifecycleWritesEnabled() };
        return { result, snapshotHash, plan };
    }
    async preview(resource: string, id: string, operation: MpsLifecycleOperation, actor: MasterPlanActor): Promise<MpsLifecyclePreview> {
        this.validate(resource, id, operation);
        this.requirePermission(actor, resource, operation);
        return this.db.transaction('REPEATABLE READ', async (m) => {
            await m.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]);
            await this.assertAvailable(resource, m);
            const { result, snapshotHash } = await this.inspect(m, resource, id, operation, actor);
            const expiresAt = Date.now() + 300000;
            const previewToken = this.sign({ tenant: actor.tenantId, user: actor.userId, resource, id, operation, version: result.expectedVersion, snapshotHash, expiresAt });
            return { ...result, previewToken, expiresAt };
        });
    }
    async confirm(resource: string, id: string, input: {
        operation: MpsLifecycleOperation;
        expectedVersion: number;
        reason: string;
        idempotencyKey: string;
        previewToken: string;
    }, actor: MasterPlanActor) {
        this.validate(resource, id, input?.operation);
        this.requirePermission(actor, resource, input.operation);
        if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1 || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000 || !uuid.test(input.idempotencyKey))
            throw new BadRequestException('请提供有效版本、操作原因和幂等键');
        const key = `mps-lifecycle:${actor.tenantId}:${actor.userId}:${resource}:${id}:${input.idempotencyKey}`, requestHash = digest(input);
        try {
            return await this.db.transaction('SERIALIZABLE', async (m) => {
                await m.query("SELECT set_config('app.tenant_id',$1,true),set_config('lock_timeout','5s',true),set_config('statement_timeout','15s',true)", [actor.tenantId]);
                await this.assertAvailable(resource, m);
                await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
                const [prior] = await m.query('SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1', [key]);
                if (prior) {
                    if (prior.request_hash !== requestHash)
                        throw new ConflictException('同一幂等键对应不同请求');
                    const [current] = await m.query(`SELECT * FROM ${tables[resource as keyof typeof tables]} WHERE tenant_id=$1 AND id=$2::uuid`, [actor.tenantId, id]);
                    if (!current)
                        throw new NotFoundException('计划不存在');
                    await this.scope(m, resource, current, actor);
                    return prior.response_json;
                }
                const signed = this.verify(input.previewToken);
                if (signed.tenant !== actor.tenantId || signed.user !== actor.userId || signed.resource !== resource || signed.id !== id || signed.operation !== input.operation || signed.version !== input.expectedVersion || signed.expiresAt < Date.now())
                    throw new ConflictException('预览已过期或不属于当前请求，请重新预览');
                const { result, snapshotHash, plan } = await this.inspect(m, resource, id, input.operation, actor, true);
                if (Number(plan.version) !== input.expectedVersion || signed.snapshotHash !== snapshotHash)
                    throw new ConflictException('预览后的计划、来源或执行事实已变化，请重新预览');
                if (!result.allowed)
                    throw new ConflictException(result.blockers.join('；'));
                await m.query("SELECT set_config('app.mps_lifecycle_command','1',true),set_config('app.mps_lifecycle_enabled','1',true)");
                const rows = await m.query(`UPDATE ${tables[resource as keyof typeof tables]} SET lifecycle_status=$4,version=version+1,updated_at=now(),updated_by=$5 WHERE tenant_id=$1 AND id=$2::uuid AND version=$3 RETURNING *`, [actor.tenantId, id, input.expectedVersion, result.targetStatus, actor.userId]);
                const after = Array.isArray(rows[0]) ? rows[0][0] : rows[0];
                if (!after)
                    throw new ConflictException('计划版本冲突，请重新预览');
                await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1,$2::uuid,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$2::uuid,$2::uuid)`, [actor.tenantId, actor.userId, actor.username, resource, id, `${resource}.lifecycle.${input.operation.toLowerCase()}`, JSON.stringify(plan), JSON.stringify({ ...after, lifecycleReason: input.reason.trim(), previewHash: snapshotHash, facts: result.facts }), actor.requestId, actor.source]);
                const response = { id, version: Number(after.version), lifecycleStatus: after.lifecycle_status, operation: input.operation };
                await m.query('INSERT INTO idempotency_keys(key,request_hash,response_json,created_by,updated_by)VALUES($1,$2,$3::jsonb,$4::uuid,$4::uuid)', [key, requestHash, JSON.stringify(response), actor.userId]);
                return response;
            });
        }
        catch (error) {
            if (['40001', '40P01', '55P03'].includes((error as {
                code?: string;
            }).code ?? ''))
                throw new ConflictException('计划或执行事实发生并发变化，请重新预览');
            throw error;
        }
    }
}
