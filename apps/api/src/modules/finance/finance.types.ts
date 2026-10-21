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
    throw new ForbiddenException(`当前权限组没有客户对应表${({ read: "查看", create: "新增", update: "修改", import: "导入", export: "导出" } as Record<string,string>)[action] ?? action}权限`); }
export function financeScope(a: TableFilterActor, params: unknown[], action = "read") {
    if (financeAdmin(a))
        return "1=1";
    // The shared legacy helper treats planning administrators as owners; finance is a separate module.
    // A partially recognized CUSTOM group must never broaden access by dropping an unknown rule.
    const operators = new Set(["EQ", "NE", "GT", "GTE", "LT", "LTE", "IN", "NOT_IN", "CONTAINS", "NOT_CONTAINS", "STARTS_WITH", "IS_EMPTY", "IS_NOT_EMPTY"]);
    const tableDataScopes = (a.tableDataScopes ?? []).filter(scope => scope.scope !== "CUSTOM" ||
        (!!scope.rules?.length && scope.rules.every(rule => Object.hasOwn(financeColumns, String(rule.fieldKey)) && operators.has(String(rule.operator)) &&
            (["IS_EMPTY", "IS_NOT_EMPTY"].includes(String(rule.operator)) || (rule.value != null && (!["IN", "NOT_IN"].includes(String(rule.operator)) || Array.isArray(rule.value)))))));
    return buildDataScopeClause({ resource, columns: financeColumns, actor: { ...a, tableDataScopes, moduleAdminCodes: [] }, params, action });
}
