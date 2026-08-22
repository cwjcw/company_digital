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
  salesperson: string;
  customerCodes: string;
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
