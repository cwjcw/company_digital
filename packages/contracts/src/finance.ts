import financeSyncPolicy from "./finance-sync-policy.json";
/** Finance classifications are independent of PMC organization/division IDs. */
export const financeDepartmentOptions = ["业务一部", "业务二部", "业务三部", "业务四部"].map(value => ({ value, label: value }));
export const financeSalesChannelOptions = ["内销", "外销"].map(value => ({ value, label: value }));
export const FINANCE_CUSTOMER_RESOURCE = "finance-customer-mappings" as const;
export const financeCustomerManualFields = ["customerCode", "departmentCategory", "salesChannel"] as const;
export type FinanceCustomerManualInput = {
    customerCode: string;
    departmentCategory?: string | null;
    salesChannel?: string | null;
};

/** Creation follows the platform's visible-field policy; ADD_ONLY may fill its form without reading records. */
export function financeCustomerCreateFieldAllowed(actor: {
    permissions: string[];
    isSystemAdmin?: boolean;
    moduleAdminCodes?: string[];
    tableDataScopes?: Array<{ resource: string; scope: string; actions?: string[] }>;
}, field: string) {
    if (!financeCustomerManualFields.some(key => key === field)) return false;
    const permissions = actor.permissions;
    if (actor.isSystemAdmin || permissions.includes("*") || actor.moduleAdminCodes?.includes("finance")) return true;
    const has = (action: string) => permissions.includes(`${FINANCE_CUSTOMER_RESOURCE}:*:${action}`) || permissions.includes(`${FINANCE_CUSTOMER_RESOURCE}:*:*`);
    if (!has("create")) return false;
    if (["read", "update"].some(action => permissions.includes(`${FINANCE_CUSTOMER_RESOURCE}:${field}:${action}`))) return true;
    return !has("read") && !!actor.tableDataScopes?.some(scope => scope.resource === FINANCE_CUSTOMER_RESOURCE && scope.scope === "NONE" && (!scope.actions || scope.actions.includes("create")));
}
export type FinanceCustomerMapping = {
    id: string;
    version: number;
    customerCode: string;
    departmentCategory: string | null;
    salesChannel: string | null;
};

/** Dates are the verified E10 business-local datetime2 values; no UTC conversion. */
export const financeCustomerMinimumSourceDate = financeSyncPolicy.minimumSourceDate;
