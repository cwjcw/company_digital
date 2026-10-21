import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { financeCustomerMinimumSourceDate, financeDepartmentOptions, financeSalesChannelOptions, financeCustomerManualFields, financeCustomerCreateFieldAllowed, FINANCE_CUSTOMER_RESOURCE as resource } from "@kdos/contracts";
import { AuditLog } from "../../entities";
import type { EntityManager } from "typeorm";
import { FinanceRepository } from "./finance.repository";
import { financeAuthorize, financeField, financeScope, type FinanceActor } from "./finance.types";
export type FinanceImportRow = {
    customerCode: string;
    departmentCategory: string | null;
    salesChannel: string | null;
    createdAtSource?: string | null;
    modifiedAtSource?: string | null;
};
export function financeClassification(value: unknown, field: string) {
    if (value == null || value === "")
        return null;
    const options = field === "departmentCategory" ? financeDepartmentOptions : financeSalesChannelOptions;
    if (typeof value !== "string" || !options.some(o => o.value === value))
        throw new BadRequestException(`${field === "departmentCategory" ? "部门类别" : "内外区分"}选项无效`);
    return value;
}
export function financeCustomerCode(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 128)
        throw new BadRequestException("客户编号必填，最长128字符");
    return value.trim();
}
export function financeSourceDate(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value !== "string") throw new BadRequestException("E10客户创建/修改日期格式无效");
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,7})?$/.exec(value);
    if (!match || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) throw new BadRequestException("E10客户创建/修改日期格式无效");
    const calendar = new Date(Date.UTC(Number(match[1]), Number(match[2])-1, Number(match[3])));
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0,10) !== value.slice(0,10)) throw new BadRequestException("E10客户创建/修改日期无效");
    return value;
}
export function normalizeFinanceRows(rows: unknown, source: string): {
    rows: FinanceImportRow[];
    read: number;
} {
    if (!Array.isArray(rows) || rows.length > 10000)
        throw new BadRequestException("客户数据应为不超过10000行的数组");
    const unique = new Map<string, FinanceImportRow>();
    for (const raw of rows) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(k => !["customerCode", ...(source === "INITIAL_IMPORT" ? ["departmentCategory", "salesChannel"] : ["createdAtSource", "modifiedAtSource"])].includes(k)))
            throw new BadRequestException("客户导入包含无效或未授权字段");
        const row = { customerCode: financeCustomerCode(raw.customerCode), departmentCategory: source === "INITIAL_IMPORT" ? financeClassification(raw.departmentCategory, "departmentCategory") : null, salesChannel: source === "INITIAL_IMPORT" ? financeClassification(raw.salesChannel, "salesChannel") : null };
        if (source === "E10_SYNC") {
            const createdAtSource = financeSourceDate(raw.createdAtSource);
            const modifiedAtSource = financeSourceDate(raw.modifiedAtSource);
            if (![createdAtSource,modifiedAtSource].some(date => date && date.slice(0,10) >= financeCustomerMinimumSourceDate)) throw new BadRequestException(`E10客户创建或修改日期必须在${financeCustomerMinimumSourceDate}起`);
            Object.assign(row,{createdAtSource,modifiedAtSource});
        }
        const previous = unique.get(row.customerCode);
        if (previous && source === "INITIAL_IMPORT" && JSON.stringify(previous) !== JSON.stringify(row))
            throw new BadRequestException("重复客户编号的分类冲突");
        unique.set(row.customerCode, row);
    }
    return { rows: [...unique.values()].sort((a, b) => a.customerCode.localeCompare(b.customerCode)), read: rows.length };
}
@Injectable()
export class FinanceApplicationService {
    constructor(private readonly repository: FinanceRepository) { }
    async createManual(input: Record<string, unknown>, actor: FinanceActor) {
        financeAuthorize(actor, "create");
        if (!actor.userId || !actor.tenantId) throw new ForbiddenException("新增客户必须关联有效租户和操作人");
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !financeCustomerManualFields.some(field => field === key)))
            throw new BadRequestException("新增客户请求包含无效或未授权字段");
        for (const field of new Set(["customerCode", ...Object.keys(input)])) {
            if (!financeCustomerCreateFieldAllowed(actor, field)) throw new ForbiddenException(`当前权限组不能填写${field === "customerCode" ? "客户编号" : field === "departmentCategory" ? "部门类别" : "内外区分"}`);
        }
        const values = { customerCode: financeCustomerCode(input.customerCode), departmentCategory: financeClassification(input.departmentCategory, "departmentCategory"), salesChannel: financeClassification(input.salesChannel, "salesChannel") };
        return this.repository.transaction(actor.tenantId, async m => {
            const [operator] = await m.query("SELECT id FROM users WHERE tenant_id=$1 AND id=$2::uuid AND enabled", [actor.tenantId, actor.userId]);
            if (!operator) throw new ForbiddenException("操作人无效或不属于当前租户");
            const params: unknown[] = [actor.tenantId, values.customerCode, values.departmentCategory, values.salesChannel, actor.userId];
            const scope = financeScope(actor, params, "create");
            const [candidate] = await m.query(`SELECT record.id FROM (SELECT uuidv7() id,$1::varchar tenant_id,$2::varchar customer_code,
                $3::varchar department_category,$4::varchar sales_channel,$5::uuid created_by,$5::uuid updated_by,
                now() created_at,now() updated_at,1 version) record WHERE ${scope}`, params);
            if (!candidate) throw new ForbiddenException("当前数据范围不允许新增此客户，请检查客户编号和分类");
            const [saved] = await m.query(`INSERT INTO finance_customer_mappings(id,tenant_id,customer_code,department_category,sales_channel,source,created_by,updated_by)
                VALUES($1::uuid,$2,$3,$4,$5,'MANUAL',$6::uuid,$6::uuid)
                ON CONFLICT(tenant_id,customer_code) DO NOTHING RETURNING id,version`, [candidate.id, actor.tenantId, values.customerCode, values.departmentCategory, values.salesChannel, actor.userId]);
            if (!saved) throw new ConflictException({ code: "FINANCE_CUSTOMER_EXISTS", message: "客户编号已存在，请返回列表修改已有客户分类" });
            await this.audit(m, actor, saved.id, "finance.customer.created", null, { ...values, source: "MANUAL" });
            return saved as { id: string; version: number };
        });
    }
    async update(id: string, input: Record<string, unknown>, actor: FinanceActor) {
        financeAuthorize(actor, "update");
        if (!input || typeof input !== "object" || Array.isArray(input))
            throw new BadRequestException("客户分类请求无效");
        if (!actor.userId)
            throw new ForbiddenException("修改必须关联有效操作人");
        const changed = Object.keys(input).filter(k => k !== "expectedVersion");
        if (!changed.length || changed.some(k => !["departmentCategory", "salesChannel"].includes(k)))
            throw new BadRequestException("只允许修改部门类别和内外区分");
        if (!Number.isInteger(input.expectedVersion) || Number(input.expectedVersion) < 1)
            throw new BadRequestException("缺少有效版本号");
        for (const field of changed)
            if (!financeField(actor, field, "update"))
                throw new ForbiddenException("当前权限组不能修改该字段");
        const values = changed.map(k => financeClassification(input[k], k));
        return this.repository.transaction(actor.tenantId, async (m) => {
            const params: unknown[] = [actor.tenantId, id];
            const scope = financeScope(actor, params, "update");
            const [before] = await m.query(`SELECT record.* FROM finance_customer_mappings record WHERE tenant_id=$1 AND id=$2::uuid AND ${scope} FOR UPDATE`, params);
            if (!before)
                throw new NotFoundException("客户记录不存在或不在授权范围");
            if (before.version !== input.expectedVersion)
                throw new ConflictException("客户分类已被其他人员修改，请刷新后重试");
            const columns: Record<string, string> = { departmentCategory: "department_category", salesChannel: "sales_channel" };
            const updateParams = [actor.tenantId, id, ...values, actor.userId];
            await m.query(`UPDATE finance_customer_mappings SET ${changed.map((k, i) => `${columns[k]}=$${i + 3}`).join(",")},updated_by=$${updateParams.length},updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2::uuid`, updateParams);
            await this.audit(m, actor, id, "finance.customer.updated", Object.fromEntries(changed.map(k => [k, before[columns[k]]])), Object.fromEntries(changed.map((k, i) => [k, values[i]])));
            // The table refetches through field/data-scoped rows; never return hidden fields here.
            return { id, version: before.version + 1 };
        });
    }
    async ingest(input: Record<string, unknown>, actor: FinanceActor) {
        financeAuthorize(actor, "import");
        financeAuthorize(actor, "create");
        if (!actor.userId)
            throw new ForbiddenException("导入必须关联有效操作人");
        if (!input || typeof input !== "object" || Array.isArray(input))
            throw new BadRequestException("客户导入请求无效");
        if (Object.keys(input).some(k => !["source", "rows", "runKey", "startedAt"].includes(k)))
            throw new BadRequestException("客户导入请求包含未知字段");
        const source = input.source;
        if (source !== "INITIAL_IMPORT" && source !== "E10_SYNC")
            throw new BadRequestException("客户来源无效");
        if (source === "INITIAL_IMPORT" && (!["departmentCategory", "salesChannel"].every(k => financeField(actor, k, "update"))))
            throw new ForbiddenException("初始分类导入需要分类字段修改权限");
        const { rows, read } = normalizeFinanceRows(input.rows, source);
        // API-key scheduled imports authenticate a linked operator, but business audit uses the existing disabled system actor.
        if (source === "E10_SYNC") actor = this.syncActor(actor);
        const hash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
        if (typeof input.runKey !== "string" || !/^[A-Za-z0-9:_-]{1,100}$/.test(input.runKey))
            throw new BadRequestException("同步运行标识无效");
        const runKey = `${input.runKey}:${hash}`;
        const started = typeof input.startedAt === "string" ? new Date(input.startedAt) : new Date();
        if (!Number.isFinite(started.getTime()))
            throw new BadRequestException("同步开始时间无效");
        return this.repository.transaction(actor.tenantId, async (m) => {
            await m.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`finance:${actor.tenantId}`]);
            const [previous] = await m.query("SELECT * FROM finance_customer_sync_runs WHERE tenant_id=$1 AND run_key=$2 AND status='SUCCESS'", [actor.tenantId, runKey]);
            if (previous)
                return { read: previous.read_count, created: previous.created_count, skipped: previous.skipped_count, repeated: true };
            let created = 0;
            for (const row of rows) {
                const saved = await m.query(`INSERT INTO finance_customer_mappings(tenant_id,customer_code,department_category,sales_channel,source,created_by,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT(tenant_id,customer_code) DO NOTHING RETURNING id`, [actor.tenantId, row.customerCode, row.departmentCategory, row.salesChannel, source, actor.userId]);
                if (saved.length) {
                    created++;
                    await this.audit(m, actor, saved[0].id, "finance.customer.created", null, { ...row, source });
                }
            }
            const skipped = read - created;
            await m.query(`INSERT INTO finance_customer_sync_runs(tenant_id,run_key,source,started_at,read_count,created_count,skipped_count,status,actor_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,'SUCCESS',$8)`, [actor.tenantId, runKey, source, started, read, created, skipped, actor.userId]);
            await this.audit(m, actor, null, "finance.sync.completed", null, { source, read, created, skipped, ...(source === "E10_SYNC" ? { minimumSourceDate: financeCustomerMinimumSourceDate } : {}) });
            return { read, created, skipped, repeated: false };
        });
    }
    async failed(actor: FinanceActor) {
        financeAuthorize(actor, "import");
        actor = this.syncActor(actor);
        return this.repository.transaction(actor.tenantId, async (m) => {
            await m.query(`INSERT INTO finance_customer_sync_runs(tenant_id,run_key,source,started_at,status,error_count,error_summary,actor_id)
        VALUES($1,uuidv7()::text,'E10_SYNC',now(),'FAILED',1,'E10客户主档采集或提交失败；请查看受控任务状态',$2)`, [actor.tenantId, actor.userId]);
            await this.audit(m, actor, null, "finance.sync.failed", null, { status: "FAILED" });
            return { status: "FAILED" };
        });
    }
    private syncActor(actor: FinanceActor): FinanceActor {
        return actor.source === "api" ? { ...actor, userId: "0199e000-0000-7000-8000-000000000001", username: "KDOS系统任务", source: "api" } : actor;
    }
    private audit(m: EntityManager, actor: FinanceActor, recordId: string | null, action: string, beforeJson: unknown, afterJson: unknown) {
        return m.save(AuditLog, { tenantId: actor.tenantId, actorId: actor.userId, actorName: actor.username, resource, recordId, action, beforeJson, afterJson: { tenantId: actor.tenantId, ...afterJson as object }, requestId: actor.requestId, source: actor.source ?? "api" });
    }
}
