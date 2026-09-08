export type MarketingActor = {
  userId: string | null;
  username: string;
  tenantCode: string;
  permissions: string[];
  managedOrganizationUnitIds?: string[];
  tableDataScopes?: Array<{ resource: string; groupId: string; scope: string; match: "ALL" | "ANY"; rules: Array<{ fieldKey: string; operator: string; value: unknown; fieldType?: string }>; actions?: string[] }>;
  requestId: string;
  ip?: string;
};

export type BusinessCustomerMappingInput = {
  departmentId?: string | null;
  department?: string;
  section?: string;
  customerCode: string;
  salespersonUserIds: string[];
};

export type ResolvedBusinessCustomerMappingInput = {
  departmentId: string;
  department: string;
  section: string;
  customerCode: string;
  salespersonUserIds: string[];
};

export type MappingDepartmentDirectorySyncTarget = {
  id: string;
  departmentId: string;
  department: string;
};

export type MappingDepartmentDirectorySyncResult = {
  sourceCustomers: number;
  resolved: number;
  mappingsUpdated: number;
  skipped: Array<{ customerCode: string; reason: string }>;
};

export type DirectoryOrganizationOption = {
  id: string;
  name: string;
  parentId: string | null;
  path: string[];
  pathLabel: string;
  enabled: boolean;
};

export type DirectoryUserOption = {
  id: string;
  displayName: string;
  departmentPaths: string[][];
  enabled: boolean;
};

export type MappingImportSummary = {
  ignoredBlankCustomerRows: number;
  sourceRows: number;
  unmatchedSalespeople: string[];
  ambiguousSalespeople: Array<{ name: string; userIds: string[] }>;
  crossSectionCustomers: Array<{ customerCode: string; locations: string[] }>;
};

export type MappingImportResult = MappingImportSummary & {
  imported: number;
  repeated: boolean;
};

export type OrderScheduleInput = {
  customerCode: string;
  orderNumber: string;
  itemNumber: string;
  itemName: string;
  customerDueDate?: string | null;
  orderTotalQuantity: string | number;
  productionUnit?: string | null;
  completionRatio: string | number;
  status?: "NORMAL" | "VOID";
  sourcePlanItemId?: string | null;
};

export type ScheduleImportRow = { row: number; input: OrderScheduleInput; id: string | null; expectedVersion: number | null };

export type RollingPlanSyncRow = {
  id: string;
  expectedVersion: number;
  responsibleOrgId: string;
};

export type RollingPlanSyncFailure = {
  id: string;
  orderNumber: string;
  itemNumber: string;
  reason: string;
};

export type RollingPlanSyncResult = {
  selected: number;
  eligible: number;
  matched: number;
  created: number;
  updated: number;
  unchanged: number;
  retained: number;
  failed: RollingPlanSyncFailure[];
  repeated: boolean;
};

export type DivisionReviewConfirmRow = {
  id: string;
  expectedVersion: number;
  responsibleOrgId: string | null;
};

export type DivisionReviewConfirmResult = RollingPlanSyncResult & {
  confirmed: number;
};
