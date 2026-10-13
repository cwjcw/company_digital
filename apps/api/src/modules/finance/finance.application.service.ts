import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { financeDepartmentOptions, financeSalesChannelOptions, FINANCE_CUSTOMER_RESOURCE as resource } from "@kdos/contracts";
import { AuditLog } from "../../entities";
import type { EntityManager } from "typeorm";
import { FinanceRepository } from "./finance.repository";
import { financeAuthorize, financeField, financeScope, type FinanceActor } from "./finance.types";
export type FinanceImportRow = {
    customerCode: string;
    departmentCategory: string | null;
    salesChannel: string | null;
};
export function financeClassification(value: unknown, field: string) {
    if (value == null || value === "")
        return null;
    const options = field === "departmentCategory" ? financeDepartmentOptions : financeSalesChannelOptions;
    if (typeof value !== "string" || !options.some(o => o.value === value))
        throw new BadRequestException(`${field === "departmentCategory" ? "部门类别" : "内外区分"}选项无效`);
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
        if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(k => !["customerCode", ...(source === "INITIAL_IMPORT" ? ["departmentCategory", "salesChannel"] : [])].includes(k)))
            throw new BadRequestException("客户导入包含无效或未授权字段");
        if (typeof raw.customerCode !== "string" || !raw.customerCode.trim() || raw.customerCode.trim().length > 128)
            throw new BadRequestException("客户编号应为非空字符串，最长128字符");
        const row = { customerCode: raw.customerCode.trim(), departmentCategory: source === "INITIAL_IMPORT" ? financeClassification(raw.departmentCategory, "departmentCategory") : null, salesChannel: source === "INITIAL_IMPORT" ? financeClassification(raw.salesChannel, "salesChannel") : null };
        const previous = unique.get(row.customerCode);
        if (previous && JSON.stringify(previous) !== JSON.stringify(row))
            throw new BadRequestException("重复客户编号的分类冲突");
        unique.set(row.customerCode, row);
    }
    return { rows: [...unique.values()].sort((a, b) => a.customerCode.localeCompare(b.customerCode)), read: rows.length };
}
@Injectable()
export class FinanceApplicationService {
    constructor(private readonly repository: FinanceRepository) { }
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
            await this.audit(m, actor, null, "finance.sync.completed", null, { source, read, created, skipped });
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
        return actor.source === "api" ? { ...actor, userId: "0199e000-0000-7000-8000-000000000001", username: "KDOS系统任务", source: "system" } : actor;
    }
    private audit(m: EntityManager, actor: FinanceActor, recordId: string | null, action: string, beforeJson: unknown, afterJson: unknown) {
        return m.save(AuditLog, { tenantId: actor.tenantId, actorId: actor.userId, actorName: actor.username, resource, recordId, action, beforeJson, afterJson: { tenantId: actor.tenantId, ...afterJson as object }, requestId: actor.requestId, source: actor.source ?? "api" });
    }
}
