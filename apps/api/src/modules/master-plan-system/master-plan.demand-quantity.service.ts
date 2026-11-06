import { MasterPlanApplicationService } from './master-plan.application.service';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { DataSource, type EntityManager } from 'typeorm';
import { mpsQuantityOperations, type MpsQuantityConfirm, MpsQuantityPreview, MpsQuantityRequest, MpsQuantityResult, MpsQuantitySnapshot } from '@kdos/contracts';
import { MasterPlanDemandLinkService } from './master-plan.demand-link.service';
import { demandLinksReady, linkNewDemandRecord } from './master-plan.demand-links';
import { hasMasterPlanFieldPermission as field, hasMasterPlanPermission as permission, type MasterPlanActor } from './master-plan.types';
import { nextMasterPlanDeliveryCode } from './master-plan.delivery-code';
import { monthlyBaseValues } from './master-plan.monthly-base';
import { quantityBalance } from './master-plan.demand-quantity';
import { buildDataScopeClause } from '../../common/filtering/data-scope';
import { columnsFor, fieldsFor, MASTER_PLAN_RESOURCE_MAP } from './master-plan.config';
import { MASTER_PLAN_ERP_ADMISSION } from './master-plan.erp-admission';
const UUID = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const baseResource = 'mps-base-plans', monthlyResource = 'mps-monthly-plans';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Date) ? Object.fromEntries(Object.keys(x).sort().filter(k => x[k] !== undefined).map(k => [k, x[k]])) : x)).digest('hex');
type Row = Record<string, any>;
@Injectable()
export class MasterPlanDemandQuantityService {
    constructor(private readonly db: DataSource, private readonly links: MasterPlanDemandLinkService, private readonly application: MasterPlanApplicationService) { }
    async availability(actor: MasterPlanActor) { return { schemaReady: await demandLinksReady(this.db.manager), canRead: permission(actor, monthlyResource, 'read') && permission(actor, baseResource, 'read') && field(actor, monthlyResource, 'requiredQuantity', 'read') && field(actor, monthlyResource, 'cumulativeInboundQuantity', 'read') && field(actor, baseResource, 'plannedQuantity', 'read') }; }
    private async context(m: EntityManager, id: string, actor: MasterPlanActor, lock = false) {
        if (!UUID.test(id))
            throw new BadRequestException('需求ID无效');
        if (!permission(actor, monthlyResource, 'read') || !permission(actor, baseResource, 'read') || !field(actor, monthlyResource, 'requiredQuantity', 'read') || !field(actor, monthlyResource, 'cumulativeInboundQuantity', 'read') || !field(actor, baseResource, 'plannedQuantity', 'read'))
            throw new ForbiddenException('缺少需求及批次数量读取权限');
        if (!await demandLinksReady(m))
            throw new ConflictException('需求数量管理结构尚未发布');
        const parent: Row = await this.links.scoped(m, monthlyResource, id, actor, false, lock);
        const candidates: Row[] = await m.query(`SELECT b.* FROM mps_base_plans b WHERE tenant_id=$1 AND (monthly_plan_id=$2::uuid OR (order_number=$3 AND item_code=$4 AND division_id IS NOT DISTINCT FROM $5::uuid)) ORDER BY id${lock ? ' FOR UPDATE' : ''}`, [actor.tenantId, id, parent.order_number, parent.item_code, parent.division_id]);
        for (const b of candidates)
            await this.links.scoped(m, baseResource, b.id, actor);
        const blockers: string[] = [];
        const status = parent.lifecycle_status ?? 'ACTIVE';
        if (status !== 'ACTIVE')
            blockers.push('需求不是已确认有效状态，禁止新增或释放排产');
        if (candidates.some(b => b.monthly_plan_id !== id))
            blockers.push('历史批次需求关联待确认');
        const bases = candidates.filter(b => b.monthly_plan_id === id);
        if (bases.some(b => b.order_number !== parent.order_number || b.item_code !== parent.item_code || b.division_id !== parent.division_id))
            throw new ConflictException('需求父关系身份冲突，禁止文本回退');
        if (bases.some(b => b.lifecycle_status === 'LEGACY_RETAINED'))
            blockers.push('历史批次来源尚未确认');
        const sources: Row[] = await m.query(`SELECT id,version,monthly_plan_id,allocated_quantity,order_number,item_code,division_id,customer_code,archived_at,order_status,manually_maintained FROM mps_order_allocations WHERE tenant_id=$1 AND (monthly_plan_id=$2::uuid OR (order_number=$3 AND item_code=$4 AND division_id IS NOT DISTINCT FROM $5::uuid)) ORDER BY id`, [actor.tenantId, id, parent.order_number, parent.item_code, parent.division_id]);
        const active = sources.filter(s => !s.archived_at && s.order_status === '已审核' && s.manually_maintained);
        if (!active.length || active.some(s => s.allocated_quantity == null || s.monthly_plan_id !== id || s.order_number !== parent.order_number || s.item_code !== parent.item_code || s.division_id !== parent.division_id || s.customer_code !== parent.customer_code) || !active.reduce((n, s) => n.add(s.allocated_quantity), new Decimal(0)).eq(parent.required_quantity))
            blockers.push('有效来源关联或需求数量待确认');
        const weekly: Row[] = await m.query(`SELECT w.*,mps_weekly_has_execution(w.tenant_id,w.id) protected FROM mps_weekly_plans w WHERE tenant_id=$1 AND base_plan_id=ANY($2::uuid[]) ORDER BY id${lock ? ' FOR UPDATE' : ''}`, [actor.tenantId, bases.map(b => b.id)]);
        // Validate canonical tenant evidence; never trust FIFO weekly allocations as batch fulfillment.
        const facts: Row[] = await m.query(`SELECT f.id,f.source_database,f.source_system,f.source_key,f.received_quantity::text quantity,
      r.id canonical_id,r.quantity::text canonical_quantity,r.version canonical_version,r.source_active,r.is_cancelled,r.status_code,r.order_link_stable,r.customer_code
      FROM finished_goods_inbound f LEFT JOIN erp_staging_raw_records r ON r.tenant_id=$1 AND r.source_database=f.source_database AND r.source_system=f.source_system AND r.source_id=f.source_key AND r.record_type='INBOUND_LINE' AND r.source_table='ST_RDRecord_b' AND r.order_number=f.sales_order_number AND r.item_code=f.inventory_code
      WHERE f.sales_order_number=$2 AND f.inventory_code=$3 ORDER BY f.id`, [actor.tenantId, parent.order_number, parent.item_code]);
        const [pendingInbound] = await m.query(`SELECT EXISTS(SELECT 1 FROM erp_staging_raw_records r WHERE r.tenant_id=$1 AND r.order_number=$2 AND r.item_code=$3 AND r.record_type='INBOUND_LINE' AND r.source_active=true AND r.is_cancelled=false AND COALESCE(r.quantity,0)<>0 AND NOT EXISTS(SELECT 1 FROM finished_goods_inbound f WHERE f.source_database=r.source_database AND f.source_system=r.source_system AND f.source_key=r.source_id)) pending`, [actor.tenantId, parent.order_number, parent.item_code]);
        if (pendingInbound.pending)
            blockers.push('入库事实尚未投影完成，不能按零履约计算');
        const seen = new Set<string>();
        let fulfilled = new Decimal(0);
        for (const f of facts) {
            const key = JSON.stringify([f.source_database, f.source_system, f.source_key]);
            if (seen.has(key)) {
                blockers.push('重复入库来源身份，履约待确认');
                continue;
            }
            seen.add(key);
            if (f.quantity == null || f.is_cancelled == null || !parent.customer_code || !f.canonical_id || f.source_database !== MASTER_PLAN_ERP_ADMISSION.sourceDatabase || f.source_system !== 'T+' || f.status_code !== '189' || !f.order_link_stable || f.customer_code !== parent.customer_code || f.canonical_quantity == null || !new Decimal(f.canonical_quantity).eq(f.quantity)) {
                blockers.push('入库证据尚未核验，履约归属待确认');
                continue;
            }
            if (f.source_active && !f.is_cancelled)
                fulfilled = fulfilled.add(f.quantity);
        }
        const [siblings] = await m.query(`SELECT count(*)::int count FROM mps_monthly_plans WHERE tenant_id=$1 AND order_number=$2 AND item_code=$3`, [actor.tenantId, parent.order_number, parent.item_code]);
        if (fulfilled.lt(0) || ((facts.length || new Decimal(parent.cumulative_inbound_quantity ?? 0).gt(0) || weekly.some(w => new Decimal(w.allocated_inbound_quantity ?? 0).gt(0))) && (bases.length !== 1 || siblings.count !== 1)))
            blockers.push('履约归属待确认：不能按订单品号猜测批次分摊');
        if (!facts.length && (new Decimal(parent.cumulative_inbound_quantity ?? 0).gt(0) || weekly.some(w => new Decimal(w.allocated_inbound_quantity ?? 0).gt(0))))
            blockers.push('缺少入库来源证据，不能按零履约计算');
        const trusted = blockers.length === 0;
        const fulfillmentTrusted = !blockers.some(b => /入库|履约|历史批次/.test(b));
        const snapshot: MpsQuantitySnapshot = { demandId: id, demandVersion: parent.version, orderNumber: parent.order_number, itemCode: parent.item_code, status, required: status === 'LEGACY_RETAINED' ? null : status === 'CANCELLED' ? '0.0000' : new Decimal(parent.required_quantity).toFixed(4), originalRequired: new Decimal(parent.required_quantity).toFixed(4), ...quantityBalance(parent.required_quantity, bases.map((b, i) => ({ planned_quantity: String(b.planned_quantity), lifecycle_status: b.lifecycle_status, fulfilled: i === 0 ? fulfilled.toFixed(4) : '0' })), fulfillmentTrusted), ...(!trusted ? { difference: null, unallocated: null, overallocated: null } : {}), trusted, relationStatus: candidates.some(b => b.monthly_plan_id !== id) ? 'PENDING' : 'CONFIRMED', blockers: [...new Set(blockers)], canUpdate: !!actor.userId && permission(actor, baseResource, 'update') && field(actor, baseResource, 'plannedQuantity', 'update'), canCreate: !!actor.userId && permission(actor, baseResource, 'create'), batches: bases.map(b => ({ id: b.id, version: b.version, deliveryNumber: b.delivery_number, quantity: new Decimal(b.planned_quantity).toFixed(4), status: b.lifecycle_status ?? 'ACTIVE', protected: weekly.some(w => w.base_plan_id === b.id && w.protected) || fulfilled.gt(0), manual: false, canUpdate: permission(actor, baseResource, 'update') && field(actor, baseResource, 'plannedQuantity', 'update') })) };
        const baselines: Row[] = await m.query(`SELECT DISTINCT ON(record_id) record_id,after_json->'syncValues'->>'planned_quantity' quantity FROM audit_logs WHERE tenant_id=$1 AND resource='mps-base-plans' AND action='mps-base-plans.synchronized' AND record_id=ANY($2::text[]) ORDER BY record_id,created_at DESC,id DESC`, [actor.tenantId, bases.map(b => b.id)]);
        for (const b of snapshot.batches) {
            const prior = baselines.find(p => p.record_id === b.id);
            b.manual = !prior?.quantity || !new Decimal(prior.quantity).eq(b.quantity);
        }
        const execution: Row[] = await m.query(`SELECT kind,id,version FROM (
      SELECT 'reports' kind,r.id,r.version FROM mps_process_reports r WHERE tenant_id=$1 AND weekly_plan_id=ANY($2::uuid[])
      UNION ALL SELECT 'technical',r.id,r.version FROM mps_technical_reports r WHERE tenant_id=$1 AND weekly_plan_id=ANY($2::uuid[])
      UNION ALL SELECT 'material',r.id,r.version FROM mps_material_reports r WHERE tenant_id=$1 AND weekly_plan_id=ANY($2::uuid[])
      UNION ALL SELECT 'outsourcing',r.id,r.version FROM mps_outsourcing_reports r WHERE tenant_id=$1 AND weekly_plan_id=ANY($2::uuid[])
      UNION ALL SELECT 'workOrders',r.id,r.version FROM mps_three_day_work_orders r WHERE tenant_id=$1 AND weekly_plan_id=ANY($2::uuid[])
    ) x ORDER BY kind,id`, [actor.tenantId, weekly.map(w => w.id)]);
        return { parent, bases, snapshot, weekly, sources, facts, execution, pendingInbound };
    }
    async read(id: string, actor: MasterPlanActor) { return this.db.transaction('REPEATABLE READ', async (m) => { await m.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]); return (await this.context(m, id, actor)).snapshot; }); }
    private validate(input: MpsQuantityRequest) {
        if (!input || !mpsQuantityOperations.includes(input.operation) || typeof input.quantity !== 'string' || !/^\d{1,12}(\.\d{1,4})?$/.test(input.quantity) || !new Decimal(input.quantity).gt(0) || !Number.isSafeInteger(input.expectedDemandVersion) || input.expectedDemandVersion < 1 || !input.expectedVersions || typeof input.expectedVersions !== 'object' || Array.isArray(input.expectedVersions))
            throw new BadRequestException('操作、精确数量或版本无效');
        for (const id of [input.sourceId, input.targetId].filter(Boolean))
            if (typeof id !== 'string' || !UUID.test(id))
                throw new BadRequestException('批次ID无效');
    }
    private async prepare(m: EntityManager, id: string, input: MpsQuantityRequest, actor: MasterPlanActor, lock = false) {
        this.validate(input);
        const ctx = await this.context(m, id, actor, lock), { snapshot, parent, bases } = ctx;
        const blockers = [...snapshot.blockers], changes: MpsQuantityPreview['changes'] = [], q = new Decimal(input.quantity);
        if (!snapshot.canUpdate)
            throw new ForbiddenException('没有基础计划数量修改权限');
        if (parent.version !== input.expectedDemandVersion)
            blockers.push('需求版本已变化');
        const selected = (bid: string | undefined, write: boolean) => { const row = bases.find(b => b.id === bid); if (!row) {
            blockers.push('必须明确选择本需求的批次');
            return undefined;
        } const b = snapshot.batches.find(b => b.id === bid)!; if (!Number.isSafeInteger(input.expectedVersions[row.id]) || input.expectedVersions[row.id] !== row.version)
            blockers.push('批次版本已变化'); if (b.status !== 'ACTIVE')
            blockers.push('只能调整ACTIVE批次'); if (write)
            changes.push({ id: row.id, before: b.quantity, after: b.quantity }); return { row, b }; };
        const source = ['REDUCE', 'SPLIT', 'MERGE'].includes(input.operation) ? selected(input.sourceId, true) : undefined;
        const target = ['INCREASE', 'MERGE'].includes(input.operation) ? selected(input.targetId, true) : undefined;
        for (const b of [source, target].filter(Boolean))
            await this.links.scoped(m, baseResource, b!.row.id, actor, true);
        if (source) {
            if (source.b.protected)
                blockers.push('已有执行、工艺锁或入库，不允许减少、拆分或合批');
            if (q.gte(source.b.quantity))
                blockers.push('源批次必须保留正数量及原ID；本轮仅支持部分安全转移');
            changes.find(c => c.id === source.row.id)!.after = new Decimal(source.b.quantity).sub(q).toFixed(4);
        }
        if (target) {
            if (input.operation === 'MERGE' && target.b.protected)
                blockers.push('目标批次已有执行，禁止合批');
            changes.find(c => c.id === target.row.id)!.after = new Decimal(target.b.quantity).add(q).toFixed(4);
        }
        if (input.operation === 'MERGE' && source && target && ['manufacturing_method','product_attribute','surface_nature'].some(k => source.row[k] !== target.row[k]))
            blockers.push('生产方式或工艺属性不同，本轮不支持合批');
        if (input.operation === 'MERGE' && input.sourceId === input.targetId)
            blockers.push('源目标不能相同');
        if (['INCREASE', 'NEW'].includes(input.operation) && (!snapshot.unallocated || q.gt(snapshot.unallocated)))
            blockers.push('分配数量超过可信待分配量');
        if (input.operation === 'REDUCE' && (!snapshot.overallocated || q.gt(snapshot.overallocated)))
            blockers.push('减少数量超过可信超额量');
        let newValues: Row | null = null;
        if (['NEW', 'SPLIT'].includes(input.operation)) {
            if(snapshot.fulfilled && new Decimal(snapshot.fulfilled).gt(0))blockers.push('已有入库且缺少稳定批次履约关联，本轮不能增加批次数量');
            if (!snapshot.canCreate)
                throw new ForbiddenException('没有新增基础批次权限');
            // Splits copy only plan context. New allocation uses the selected template if supplied.
            const template = source?.row ?? (input.sourceId ? selected(input.sourceId, false)?.row : undefined);
            newValues = { ...monthlyBaseValues(parent), ...(template ? Object.fromEntries(['latest_customer_due_date', 'latest_review_due_date', 'model_age', 'product_attribute', 'surface_nature', 'manufacturing_method'].map(k => [k, template[k]])) : {}), ...(input.newBatchValues ? this.application.quantityBatchContext(input.newBatchValues, actor) : {}), planned_quantity: q.toFixed(4), monthly_plan_id: id, tenant_id: actor.tenantId, created_by: actor.userId, order_number: parent.order_number, item_code: parent.item_code };
            const def = MASTER_PLAN_RESOURCE_MAP.get(baseResource)!;
            for (const f of fieldsFor(def).filter(f => f.editable && f.required))
                if (newValues[columnsFor(def)[f.key]] == null || newValues[columnsFor(def)[f.key]] === '')
                    blockers.push(`新批次缺少${f.label}，请选用已核实的批次属性模板`);
            for (const f of fieldsFor(def).filter(f => f.editable && newValues![columnsFor(def)[f.key]] != null))
                if (!field(actor, baseResource, f.key, 'update') && !field(actor, baseResource, f.key, 'read'))
                    throw new ForbiddenException('新增批次缺少来源字段权限');
            await this.assertScope(m, newValues, 'create', actor);
            changes.push({ id: 'NEW', before: '0.0000', after: q.toFixed(4) });
        }
        for (const c of changes.filter(c => c.id !== 'NEW')) {
            const b = bases.find(b => b.id === c.id)!;
            await this.assertScope(m, { ...b, planned_quantity: c.after }, 'update', actor);
        }
        const netChange=changes.reduce((sum,c)=>sum.add(new Decimal(c.after).sub(c.before)),new Decimal(0));
        const afterDelta=snapshot.difference==null?null:new Decimal(snapshot.difference).sub(netChange);
        const afterBalance={allocated:new Decimal(snapshot.allocated).add(netChange).toFixed(4),unallocated:afterDelta==null?null:Decimal.max(afterDelta,0).toFixed(4),overallocated:afterDelta==null?null:Decimal.max(afterDelta.neg(),0).toFixed(4)};
        const result: MpsQuantityPreview = { snapshot, request: input, allowed: blockers.length === 0, blockers: [...new Set(blockers)], afterBalance, changes, previewHash: hash({ parent, bases, weekly: ctx.weekly, sources: ctx.sources, facts: ctx.facts, execution: ctx.execution, pendingInbound: ctx.pendingInbound, input, newValues }) };
        return { result, newValues, ctx };
    }
    private async assertScope(m: EntityManager, row: Row, action: string, actor: MasterPlanActor) {
        const def = MASTER_PLAN_RESOURCE_MAP.get(baseResource)!;
        const params: unknown[] = [JSON.stringify(row)];
        const clauses = [action, 'read'].map(a => buildDataScopeClause({ resource: baseResource, action: a, params, columns: columnsFor(def), numericFields: fieldsFor(def).filter(f => f.type === 'number').map(f => f.key), actor: { ...actor, tableDataScopes: actor.tableDataScopes.filter(s => s.scope !== 'NONE') } }));
        const [allowed] = await m.query(`SELECT 1 FROM jsonb_populate_record(NULL::mps_base_plans,$1::jsonb) record WHERE (${clauses.join(') AND (')})`, params);
        if (!allowed)
            throw new ForbiddenException('调整后的批次不在获权数据范围');
    }
    async preview(id: string, input: MpsQuantityRequest, actor: MasterPlanActor) { return this.db.transaction('REPEATABLE READ', async (m) => { await m.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]); return (await this.prepare(m, id, input, actor)).result; }); }
    async confirm(id: string, input: MpsQuantityConfirm, actor: MasterPlanActor, attempt = 0): Promise<MpsQuantityResult> {
        this.validate(input);
        if (!actor.userId || (typeof input.idempotencyKey !== 'string' || !UUID.test(input.idempotencyKey)) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000 || typeof input.previewHash !== 'string')
            throw new BadRequestException('缺少原因、预览摘要或幂等键');
        const request: MpsQuantityRequest = { newBatchValues: input.newBatchValues, operation: input.operation, quantity: input.quantity, sourceId: input.sourceId, targetId: input.targetId, expectedDemandVersion: input.expectedDemandVersion, expectedVersions: input.expectedVersions };
        const key = JSON.stringify(['mps-quantity', actor.tenantId, actor.userId, input.idempotencyKey]), requestHash = hash({ id, ...request, previewHash: input.previewHash, reason: input.reason.trim() });
        try {
            return await this.db.transaction('SERIALIZABLE', async (m) => {
                await m.query("SELECT set_config('app.tenant_id',$1,true),set_config('lock_timeout','5s',true)", [actor.tenantId]);
                await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
                const ctx = await this.context(m, id, actor, true);
                for (const bid of [input.sourceId, input.targetId].filter(Boolean))
                    await this.links.scoped(m, baseResource, bid!, actor, true);
                if (!ctx.snapshot.canUpdate || (['NEW', 'SPLIT'].includes(input.operation) && !ctx.snapshot.canCreate))
                    throw new ForbiddenException('缺少批次数量操作权限');
                const [prior] = await m.query('SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1', [key]);
                if (prior) {
                    if (prior.request_hash !== requestHash)
                        throw new ConflictException('幂等键内容冲突');
                    return { ...prior.response_json, repeated: true };
                }
                const { result, newValues } = await this.prepare(m, id, request, actor, true);
                if (!result.allowed || result.previewHash !== input.previewHash)
                    throw new ConflictException({ message: result.blockers.join('；') || '预览已过期，请重新预览', blockers: result.blockers });
                const batchIds: string[] = [];
                for (const change of result.changes) {
                    let after: Row, before: Row | null = null;
                    if (change.id === 'NEW') {
                        const delivery = await nextMasterPlanDeliveryCode(m, actor.tenantId, ctx.parent.order_number, ctx.parent.item_code, actor.userId!);
                        const entries = Object.entries(newValues!).filter(([k]) => !['monthly_plan_id', 'tenant_id', 'created_by'].includes(k));
                        [after] = await m.query(`INSERT INTO mps_base_plans(tenant_id,created_by,updated_by,delivery_number,${entries.map(([k]) => k).join(',')})VALUES($1,$2::uuid,$2::uuid,$3,${entries.map((_, i) => '$' + (i + 4)).join(',')}) RETURNING *`, [actor.tenantId, actor.userId, delivery, ...entries.map(([k, v]) => k === 'image_refs' ? JSON.stringify(v) : v)]);
                        after = await linkNewDemandRecord(m, baseResource, after, actor.userId!, actor.username, actor.requestId);
                        if (after.monthly_plan_id !== id)
                            throw new ConflictException('新批次需求身份无法确认');
                    }
                    else {
                        before = ctx.bases.find(b => b.id === change.id)!;
                        const changed = await m.query(`UPDATE mps_base_plans SET planned_quantity=$3::numeric,version=version+1,updated_by=$4::uuid,updated_at=now() WHERE tenant_id=$1 AND id=$2::uuid AND version=$5 RETURNING *`, [actor.tenantId, change.id, change.after, actor.userId, before.version]);
                        after = Array.isArray(changed[0]) ? changed[0][0] : changed[0];
                        if (!after)
                            throw new ConflictException('批次版本发生变化');
                    }
                    batchIds.push(after.id);
                    await m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)VALUES($1,$2::uuid,$3,'mps-base-plans',$4,'demand.quantity.confirmed',$5::jsonb,$6::jsonb,$7,'web',$2::uuid,$2::uuid)`, [actor.tenantId, actor.userId, actor.username, after.id, JSON.stringify(before), JSON.stringify({ ...after, quantityOperation: request, reason: input.reason.trim(), previewHash: input.previewHash }), actor.requestId]);
                }
                // A durable receipt reports queue status only, never downstream success.
                const [event] = await m.query(`INSERT INTO mps_reconciliation_outbox(tenant_id,resource,record_id,sync_key,idempotency_key,actor_id,actor_name,created_by,updated_by)VALUES($1,'mps-base-plans',$2::uuid,'base-to-weekly',$3,$4::uuid,$5,$4::uuid,$4::uuid)RETURNING id`, [actor.tenantId, batchIds[0], key, actor.userId, actor.username]);
                const response: MpsQuantityResult = { demandId: id, batchIds, repeated: false, syncStatus: 'PENDING', outboxId: event.id };
                await m.query('INSERT INTO idempotency_keys(key,request_hash,response_json,created_by,updated_by)VALUES($1,$2,$3::jsonb,$4::uuid,$4::uuid)', [key, requestHash, JSON.stringify(response), actor.userId]);
                return response;
            });
        }
        catch (e) {
            const code = (e as any)?.driverError?.code ?? (e as any)?.code;
            if (['40001', '40P01'].includes(code) && attempt < 2)
                return this.confirm(id, input, actor, attempt + 1);
            if (['23514', '23503', '23505', '40001', '40P01', '55P03'].includes(code))
                throw new ConflictException('数量操作与执行事实或并发修改冲突，请重新核对');
            throw e;
        }
    }
    async status(id: string, eventId: string, actor: MasterPlanActor) { if (!UUID.test(eventId))
        throw new BadRequestException('事件ID无效'); return this.db.transaction(async (m) => { await m.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]); await this.context(m, id, actor); const [r] = await m.query(`SELECT o.status,o.last_error FROM mps_reconciliation_outbox o JOIN mps_base_plans b ON b.tenant_id=o.tenant_id AND b.id=o.record_id WHERE o.tenant_id=$1 AND o.id=$2::uuid AND b.monthly_plan_id=$3::uuid AND o.resource='mps-base-plans' AND o.sync_key='base-to-weekly'`, [actor.tenantId, eventId, id]); return r ?? { status: 'UNKNOWN' }; }); }
}
