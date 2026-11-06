import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import type { MpsReviewApplicationInfo, MpsReviewApplyRequest, MpsReviewApplyPreview, MpsReviewApplyConfirm, MpsReviewApplyResult } from '@kdos/contracts';
import { MasterPlanDemandLinkService } from './master-plan.demand-link.service';
import { demandLinksReady } from './master-plan.demand-links';
import { hasMasterPlanPermission as permission, hasMasterPlanFieldPermission as field, type MasterPlanActor } from './master-plan.types';
import { buildDataScopeClause } from '../../common/filtering/data-scope';
import { columnsFor, fieldsFor, MASTER_PLAN_RESOURCE_MAP } from './master-plan.config';
const R = 'mps-review-due-dates', B = 'mps-base-plans', M = 'mps-monthly-plans';
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(v);
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().filter(k => x[k] !== undefined).map(k => [k, x[k]])) : x)).digest('hex');
// pg parses SQL date as local midnight; UTC serialization would move it to the prior day in China.
const date = (v: any): string | null => v == null ? null : v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v).slice(0, 10);
type Row = Record<string, any>;
export async function reviewApplicationsReady(m: Pick<EntityManager, 'query'>) {
    const [r] = await m.query(`SELECT to_regclass('mps_review_base_plan_links') IS NOT NULL AND
 (SELECT count(*)=2 FROM pg_trigger WHERE tgname IN('trg_mps_review_application','trg_mps_applied_review_identity') AND tgenabled IN('O','A')) ready`);
    return !!r.ready && await demandLinksReady(m);
}
@Injectable()
export class MasterPlanReviewApplicationService {
    constructor(private readonly db: DataSource, private readonly links: MasterPlanDemandLinkService) { }
    canUse(a: MasterPlanActor) { return !!a.userId && [R, B].every(r => permission(a, r, 'read') && permission(a, r, 'update')) && permission(a, M, 'read') && ['orderNumber','drawingNumber','divisionId','batchNumber', 'dueDate', 'inboundDate'].every(k => field(a, R, k, 'read')) && field(a, R, 'inboundDate', 'update') && ['orderNumber','itemCode','divisionId','deliveryNumber','plannedQuantity', 'latestCustomerDueDate', 'latestReviewDueDate'].every(k => field(a, B, k, 'read')) && field(a, B, 'latestReviewDueDate', 'update')&&['orderNumber','itemCode','divisionId'].every(k=>field(a,M,k,'read')); }
    async availability(a: MasterPlanActor) { return { schemaReady: await reviewApplicationsReady(this.db.manager), canApply: this.canUse(a) }; }
    private scoped(m: EntityManager, r: string, id: string, a: MasterPlanActor, write = false, lock = false) { return this.links.scoped(m, r, id, { ...a, tableDataScopes: a.tableDataScopes.filter(s => s.scope !== 'NONE') }, write, lock); }
    private async context(m: EntityManager, id: string, a: MasterPlanActor, lock = false) {
        if (!this.canUse(a))
            throw new ForbiddenException('缺少评审及目标批次字段、操作权限');
        if (!uuid(id))
            throw new BadRequestException('评审ID无效');
        if (!await reviewApplicationsReady(m))
            throw new ConflictException('评审批次应用结构尚未发布');
        const review: Row = await this.scoped(m, R, id, a, true, lock), blockers: string[] = [];
        const parent: Row | null = review.monthly_plan_id ? await this.scoped(m, M, review.monthly_plan_id, a, false, lock) : null;
        if (!parent)
            blockers.push('需求关联尚未确认，不能按订单或批次号猜测基础计划');
        if (parent && (review.order_number !== parent.order_number || review.drawing_number !== parent.item_code || review.division_id !== parent.division_id))
            throw new ConflictException('评审与需求身份冲突');
        if (parent && (parent.lifecycle_status ?? 'ACTIVE') !== 'ACTIVE')
            blockers.push('需求不是已确认ACTIVE状态');
        if (!review.inbound_date)
            blockers.push('最新评审交期为空，不能使用客户交期或历史日期替代');
        const raw: Row[] = parent ? await m.query(`SELECT * FROM mps_base_plans WHERE tenant_id=$1 AND monthly_plan_id=$2::uuid ORDER BY id${lock ? ' FOR UPDATE' : ''}`, [a.tenantId, parent.id]) : [];
        const bases: Row[] = [];
        for (const b of raw) {
            try {
                await this.scoped(m, B, b.id, a);
                bases.push(b);
            }
            catch (e) {
                if (!(e instanceof ForbiddenException || e instanceof NotFoundException))
                    throw e;
            }
        }
        for (const b of bases)
            if (b.order_number !== review.order_number || b.item_code !== review.drawing_number || b.division_id !== review.division_id)
                throw new ConflictException('目标批次身份与评审冲突，禁止文本回退');
        const weekly: Row[] = bases.length ? await m.query(`SELECT w.*,mps_weekly_has_execution(w.tenant_id,w.id) protected FROM mps_weekly_plans w WHERE tenant_id=$1 AND base_plan_id=ANY($2::uuid[]) ORDER BY id${lock ? ' FOR UPDATE' : ''}`, [a.tenantId, bases.map(b => b.id)]) : [];
        const history: Row[] = bases.length ? await m.query(`SELECT l.*,o.status sync_status FROM mps_review_base_plan_links l JOIN mps_reconciliation_outbox o ON o.tenant_id=l.tenant_id AND o.id=l.outbox_id WHERE l.tenant_id=$1 AND l.base_plan_id=ANY($2::uuid[]) ORDER BY l.created_at DESC,l.id DESC`, [a.tenantId, bases.map(b => b.id)]) : [];
        const [division] = await m.query('SELECT name FROM organization_units WHERE id=$1::uuid', [review.division_id]);
        const info: MpsReviewApplicationInfo = { reviewId: id, reviewVersion: review.version, orderNumber: review.order_number, itemCode: review.drawing_number, divisionName: division?.name ?? null, demandId: parent?.id ?? null, batchNumber: review.batch_number, reviewDate: date(review.inbound_date), customerDate: date(review.due_date), canApply: this.canUse(a) && !!parent, canBind: !parent && this.links.canBind(R, a), blockers,
            candidates: [], history: history.filter(l => l.review_id === id).map(l => ({ id: l.id, baseId: l.base_plan_id, deliveryNumber: bases.find(b => b.id === l.base_plan_id)!.delivery_number, reviewVersion: l.applied_review_version, date: date(l.applied_date)!, appliedAt: new Date(l.created_at).toISOString(), version: l.version, syncStatus: l.sync_status })) };
        for (const b of bases) {
            let canUpdate = true;
            try {
                await this.scoped(m, B, b.id, a, true);
            }
            catch (e) {
                if (e instanceof ForbiddenException || e instanceof NotFoundException)
                    canUpdate = false;
                else
                    throw e;
            }
            const latest = history.find(l => l.base_plan_id === b.id && l.review_id === id), otherReview = history.some(l => l.base_plan_id === b.id && l.review_id !== id);
            info.candidates.push({ id: b.id, version: b.version, deliveryNumber: b.delivery_number, quantity: String(b.planned_quantity), customerDate: date(b.latest_customer_due_date), reviewDate: date(b.latest_review_due_date), status: b.lifecycle_status ?? 'ACTIVE', protected: weekly.some(w => w.base_plan_id === b.id && (w.protected || w.process_config_locked_at)), canUpdate, appliedVersion: latest?.applied_review_version ?? null, appliedDate: latest ? date(latest.applied_date) : null, pending: !!latest && latest.applied_review_version !== review.version, otherReview });
        }
        const execution: Row[] = weekly.length ? await m.query('SELECT id,version FROM mps_process_reports WHERE tenant_id=$1 AND weekly_plan_id=ANY($2::uuid[]) ORDER BY id', [a.tenantId, weekly.map(w => w.id)]) : [];
        return { info, review, parent, bases, weekly, history, execution };
    }
    async info(id: string, a: MasterPlanActor) { return this.db.transaction('REPEATABLE READ', async (m) => { await m.query("SELECT set_config('app.tenant_id',$1,true)", [a.tenantId]); return (await this.context(m, id, a)).info; }); }
    private validate(b: MpsReviewApplyRequest) { if (!b || !Number.isSafeInteger(b.expectedReviewVersion) || b.expectedReviewVersion < 1 || !Array.isArray(b.targets) || !b.targets.length || b.targets.length > 100 || b.targets.some(t => !t || !uuid(t.baseId) || !Number.isSafeInteger(t.expectedVersion) || t.expectedVersion < 1) || new Set(b.targets.map(t => t.baseId)).size !== b.targets.length)
        throw new BadRequestException('必须明确选择1至100个独立批次及当前版本'); }
    private async prepare(m: EntityManager, id: string, b: MpsReviewApplyRequest, a: MasterPlanActor, lock = false) {
        this.validate(b);
        const ctx = await this.context(m, id, a, lock), { info } = ctx, blockers = [...info.blockers], changes: MpsReviewApplyPreview['changes'] = [];
        if (info.reviewVersion !== b.expectedReviewVersion)
            blockers.push('评审版本已变化，请重新预览');
        for (const t of b.targets) {
            const target = info.candidates.find(c => c.id === t.baseId);
            if (!target)
                throw new ForbiddenException('所选批次不在已确认需求和获权范围');
            if (!target.canUpdate)
                throw new ForbiddenException('没有目标基础批次修改范围');
            if (target.version !== t.expectedVersion)
                blockers.push(`批次${target.deliveryNumber}版本已变化`);
            if (target.status !== 'ACTIVE' || ctx.weekly.some(w => w.base_plan_id === t.baseId && (w.lifecycle_status ?? 'ACTIVE') !== 'ACTIVE'))
                blockers.push(`批次${target.deliveryNumber}或周计划不是ACTIVE状态`);
            if (target.otherReview)
                blockers.push(`批次${target.deliveryNumber}已采用其他评审，禁止静默覆盖`);
            if (target.appliedVersion === info.reviewVersion && target.reviewDate !== target.appliedDate)
                blockers.push(`批次${target.deliveryNumber}同版本应用后已人工变更日期，请走正式纠错或新评审`);
            // Both old and new data scope must pass. Only this one date can change.
            const def = MASTER_PLAN_RESOURCE_MAP.get(B)!, params: unknown[] = [info.reviewDate,a.tenantId,t.baseId];
            const clauses = ['read', 'update'].map(action => buildDataScopeClause({ resource: B, action, params, columns: columnsFor(def), numericFields: fieldsFor(def).filter(f => f.type === 'number').map(f => f.key), actor: { ...a, tableDataScopes: a.tableDataScopes.filter(s => s.scope !== 'NONE') } }));
            if (!(await m.query(`SELECT 1 FROM mps_base_plans original CROSS JOIN LATERAL jsonb_populate_record(original,jsonb_build_object('latest_review_due_date',$1::date)) record WHERE original.tenant_id=$2 AND original.id=$3::uuid AND (${clauses.join(') AND (')})`, params)).length)
                throw new ForbiddenException('应用后的批次不在授权范围');
            if (info.reviewDate)
                changes.push({ baseId: t.baseId, deliveryNumber: target.deliveryNumber, before: target.reviewDate, after: info.reviewDate });
        }
        const result: MpsReviewApplyPreview = { info, request: b, allowed: !blockers.length, blockers: [...new Set(blockers)], changes, previewHash: digest({ ...ctx, input: b }) };
        return { ctx, result };
    }
    async preview(id: string, b: MpsReviewApplyRequest, a: MasterPlanActor) { return this.db.transaction('REPEATABLE READ', async (m) => { await m.query("SELECT set_config('app.tenant_id',$1,true)", [a.tenantId]); return (await this.prepare(m, id, b, a)).result; }); }
    async confirm(id: string, b: MpsReviewApplyConfirm, a: MasterPlanActor, attempt = 0): Promise<MpsReviewApplyResult> {
        this.validate(b);
        if (!uuid(b.idempotencyKey) || typeof b.reason !== 'string' || !b.reason.trim() || b.reason.length > 1000 || typeof b.previewHash !== 'string')
            throw new BadRequestException('缺少原因、幂等键或预览摘要');
        const input: MpsReviewApplyRequest = { expectedReviewVersion: b.expectedReviewVersion, targets: b.targets };
        const key = JSON.stringify(['review-apply', a.tenantId, a.userId, b.idempotencyKey]), hash = digest([id, input, b.previewHash, b.reason.trim()]);
        try {
            return await this.db.transaction('SERIALIZABLE', async (m) => {
                await m.query("SELECT set_config('app.tenant_id',$1,true),set_config('lock_timeout','5s',true)", [a.tenantId]);
                await m.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
                const first = await this.context(m, id, a, true);
                for (const t of b.targets) {
                    if (!first.bases.some(x => x.id === t.baseId))
                        throw new ForbiddenException('目标批次已不在范围');
                    await this.scoped(m, B, t.baseId, a, true);
                }
                const [prior] = await m.query('SELECT request_hash,response_json FROM idempotency_keys WHERE key=$1', [key]);
                if (prior) {
                    if (prior.request_hash !== hash)
                        throw new ConflictException('幂等键内容冲突');
                    return { ...prior.response_json, repeated: true };
                }
                const { ctx, result } = await this.prepare(m, id, input, a, true);
                if (!result.allowed || result.previewHash !== b.previewHash)
                    throw new ConflictException({ message: result.blockers.join('；') || '预览已过期，请重新预览' });
                const applicationIds: string[] = [];
                const changedIds = result.changes.filter(c => !ctx.history.some(l => l.review_id === id && l.base_plan_id === c.baseId && l.applied_review_version === ctx.review.version)).map(c => c.baseId);
                let outboxId: string | null = null;
                if (changedIds.length) {
                    const [e] = await m.query(`INSERT INTO mps_reconciliation_outbox(tenant_id,resource,record_id,sync_key,scope_json,idempotency_key,actor_id,actor_name,created_by,updated_by)VALUES($1,$2,$3::uuid,'base-to-weekly',$4::jsonb,$5,$6::uuid,$7,$6::uuid,$6::uuid)RETURNING id`, [a.tenantId, R, id, JSON.stringify({ basePlanIds: changedIds.sort() }), key, a.userId, a.username]);
                    outboxId = e.id;
                }
                for (const change of result.changes) {
                    const target = ctx.bases.find(x => x.id === change.baseId)!;
                    const old = ctx.history.find(l => l.review_id === id && l.base_plan_id === target.id && l.applied_review_version === ctx.review.version);
                    if (old) {
                        applicationIds.push(old.id);
                        continue;
                    }
                    const after = { ...target, latest_review_due_date: change.after };
                    if (date(target.latest_review_due_date) !== change.after) {
                        const updated = await m.query(`UPDATE mps_base_plans SET latest_review_due_date=$3::date,version=version+1,updated_by=$4::uuid,updated_at=now() WHERE tenant_id=$1 AND id=$2::uuid AND version=$5 RETURNING *`, [a.tenantId, target.id, change.after, a.userId, target.version]);
                        const row = Array.isArray(updated[0]) ? updated[0][0] : updated[0];
                        if (!row)
                            throw new ConflictException('批次版本已变化');
                        Object.assign(after, row);
                    }
                    await this.audit(m, a, id, 'review.application_authorized', null, { baseId: target.id, reviewVersion: ctx.review.version, xactId: (await m.query('SELECT pg_current_xact_id()::text id'))[0].id, reason: b.reason.trim() });
                    const [link] = await m.query(`INSERT INTO mps_review_base_plan_links(tenant_id,review_id,base_plan_id,applied_review_version,applied_date,created_by,updated_by,outbox_id)VALUES($1,$2::uuid,$3::uuid,$4,$5::date,$6::uuid,$6::uuid,$7::uuid)RETURNING id`, [a.tenantId, id, target.id, ctx.review.version, change.after, a.userId, outboxId]);
                    applicationIds.push(link.id);
                    await this.audit(m, a, id, 'review.batch_applied', target, { ...after, applicationId: link.id, reviewVersion: ctx.review.version, appliedDate: change.after, reason: b.reason.trim() });
                }
                const response: MpsReviewApplyResult = { reviewId: id, applicationIds, outboxId, syncStatus: outboxId ? 'PENDING' : 'NO_CHANGE', repeated: false };
                await m.query('INSERT INTO idempotency_keys(key,request_hash,response_json,created_by,updated_by)VALUES($1,$2,$3::jsonb,$4::uuid,$4::uuid)', [key, hash, JSON.stringify(response), a.userId]);
                return response;
            });
        }
        catch (e) {
            const code = (e as any)?.driverError?.code ?? (e as any)?.code;
            if (['40001', '40P01'].includes(code) && attempt < 2)
                return this.confirm(id, b, a, attempt + 1);
            if (['23514', '23503', '23505', '40001', '40P01', '55P03'].includes(code))
                throw new ConflictException('评审应用受身份、历史事实或并发保护限制，请重新核对');
            throw e;
        }
    }
    private audit(m: EntityManager, a: MasterPlanActor, id: string, action: string, before: unknown, after: unknown) { return m.query(`INSERT INTO audit_logs(tenant_id,actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)VALUES($1,$2::uuid,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,'web',$2::uuid,$2::uuid)`, [a.tenantId, a.userId, a.username, R, id, action, JSON.stringify(before), JSON.stringify(after), a.requestId]); }
    async status(id: string, event: string, a: MasterPlanActor) { if (!uuid(event))
        throw new BadRequestException('事件ID无效'); return this.db.transaction(async (m) => { await m.query("SELECT set_config('app.tenant_id',$1,true)", [a.tenantId]); await this.context(m, id, a); const [r] = await m.query(`SELECT status,last_error FROM mps_reconciliation_outbox WHERE tenant_id=$1 AND id=$2::uuid AND resource=$3 AND record_id=$4::uuid AND sync_key='base-to-weekly'`, [a.tenantId, event, R, id]); return r ?? { status: 'UNKNOWN' }; }); }
}
