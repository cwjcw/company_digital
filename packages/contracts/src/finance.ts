import financeSyncPolicy from "./finance-sync-policy.json";
/** Finance classifications are independent of PMC organization/division IDs. */
export const financeDepartmentOptions = ["业务一部", "业务二部", "业务三部", "业务四部"].map(value => ({ value, label: value }));
export const financeSalesChannelOptions = ["内销", "外销"].map(value => ({ value, label: value }));
export const FINANCE_CUSTOMER_RESOURCE = "finance-customer-mappings" as const;
export type FinanceCustomerMapping = {
    id: string;
    version: number;
    customerCode: string;
    departmentCategory: string | null;
    salesChannel: string | null;
};

/** Dates are the verified E10 business-local datetime2 values; no UTC conversion. */
export const financeCustomerMinimumSourceDate = financeSyncPolicy.minimumSourceDate;
