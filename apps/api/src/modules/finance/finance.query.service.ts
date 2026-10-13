import { Injectable } from "@nestjs/common";
import { FinanceRepository } from "./finance.repository";
import { financeAuthorize, financeField, financeAdmin, financeScope, type FinanceActor } from "./finance.types";
@Injectable()
export class FinanceQueryService {
    constructor(private readonly repository: FinanceRepository) { }
    summary(actor: FinanceActor) {
        financeAuthorize(actor);
        return this.repository.transaction(actor.tenantId, async (m) => {
            const params: unknown[] = [actor.tenantId];
            const scope = financeScope(actor, params);
            const pendingReadable = ["departmentCategory", "salesChannel"].every(k => financeField(actor, k, "read"));
            const [counts] = await m.query(`SELECT count(*)::integer total,${pendingReadable ? "count(*) FILTER(WHERE department_category IS NULL OR sales_channel IS NULL)::integer" : "NULL::integer"} pending FROM finance_customer_mappings record WHERE tenant_id=$1 AND ${scope}`, params);
            const lastSync = financeAdmin(actor) ? (await m.query("SELECT completed_at AS \"completedAt\",created_count AS \"created\",read_count AS \"read\" FROM finance_customer_sync_runs WHERE tenant_id=$1 AND source='E10_SYNC' AND status='SUCCESS' ORDER BY completed_at DESC LIMIT 1", [actor.tenantId]))[0] ?? null : null;
            return { ...counts, lastSync };
        });
    }
}
