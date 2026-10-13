import { ForbiddenException } from "@nestjs/common";
import { FINANCE_CUSTOMER_RESOURCE as resource } from "@kdos/contracts";
import type { TableFilterActor } from "../../common/filtering/table-filter.registry";
import { buildDataScopeClause } from "../../common/filtering/data-scope";
export type FinanceActor = TableFilterActor & {
    username: string;
    requestId: string;
    source?: string;
};
export const financeColumns = { id: "id", version: "version", customerCode: "customer_code", departmentCategory: "department_category", salesChannel: "sales_channel", createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at" };
export function financeAdmin(a: TableFilterActor) { return a.isSystemAdmin === true || a.permissions.includes("*") || a.moduleAdminCodes?.includes("finance") === true; }
export function financePermission(a: TableFilterActor, action: string) { return financeAdmin(a) || a.permissions.includes(`${resource}:*:${action}`) || a.permissions.includes(`${resource}:*:*`); }
export function financeField(a: TableFilterActor, field: string, action: string) { return financeAdmin(a) || a.permissions.includes(`${resource}:${field}:${action}`); }
export function financeAuthorize(a: TableFilterActor, action = "read") { if (!financePermission(a, action))
    throw new ForbiddenException(`当前权限组没有客户对应表${action === "read" ? "查看" : action === "update" ? "修改" : "导入"}权限`); }
export function financeScope(a: TableFilterActor, params: unknown[], action = "read") {
    if (financeAdmin(a))
        return "1=1";
    // The shared legacy helper treats planning administrators as owners; finance is a separate module.
    return buildDataScopeClause({ resource, columns: financeColumns, actor: { ...a, moduleAdminCodes: [] }, params, action });
}
