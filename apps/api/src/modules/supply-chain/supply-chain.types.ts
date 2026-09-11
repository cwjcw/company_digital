export type SupplyChainActor = {
  tenantId: string;
  userId: string | null;
  username: string;
  isSystemAdmin?: boolean;
  moduleAdminCodes?: string[];
  permissions: string[];
  tableDataScopes: Array<{
    resource: string;
    scope: string;
    match?: string;
    actions?: string[];
    rules?: Array<{ fieldKey?: string; operator?: string; value?: unknown }>;
  }>;
  requestId: string;
  source?: "web" | "api" | "import";
};

export type TplusSupplierCanonicalRow = {
  sourceSystem: "TPLUS";
  sourceDatabase: string;
  sourceAccountName: string;
  sourceId: string;
  code: string;
  name: string;
  abbreviation: string | null;
  shorthand: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  partnerType: 226 | 228;
  partnerTypeLabel: "供应商" | "客户及供应商";
  representative: string | null;
  contact: string | null;
  mobilePhone: string | null;
  telephone: string | null;
  fax: string | null;
  email: string | null;
  address: string | null;
  enabled: boolean;
  sourceUpdatedAt: string | null;
};

export function hasSupplierListPermission(actor: SupplyChainActor, action: string) {
  return actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.permissions.includes(`supplier-list:*:${action}`);
}
