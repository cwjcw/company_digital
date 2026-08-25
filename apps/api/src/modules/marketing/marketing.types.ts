export type MarketingActor = {
  userId: string | null;
  username: string;
  tenantCode: string;
  permissions: string[];
  requestId: string;
  ip?: string;
};

export type BusinessCustomerMappingInput = {
  department: string;
  section: string;
  customerCode: string;
  salespersonUserIds: string[];
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
  sourcePlanItemId?: string | null;
};
