import { sql } from "drizzle-orm";
import {
  boolean, check, date, index, integer, jsonb, numeric, pgSchema, primaryKey,
  text, timestamp, uniqueIndex, uuid, varchar
} from "drizzle-orm/pg-core";

export const iam = pgSchema("iam");
export const planning = pgSchema("planning");
export const audit = pgSchema("audit");
export const integration = pgSchema("integration");
export const marketing = pgSchema("marketing");

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
  version: integer("version").notNull().default(1)
};

export const tenants = iam.table("tenants", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  code: varchar("code", { length: 64 }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  ...auditColumns
}, (table) => [uniqueIndex("tenants_code_uq").on(table.code)]);

export const organizations = iam.table("organizations", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  parentId: uuid("parent_id"), code: varchar("code", { length: 80 }).notNull(), name: varchar("name", { length: 200 }).notNull(),
  enabled: boolean("enabled").notNull().default(true), ...auditColumns
}, (table) => [uniqueIndex("organizations_tenant_code_uq").on(table.tenantId, table.code), index("organizations_tenant_parent_idx").on(table.tenantId, table.parentId)]);

export const departments = iam.table("departments", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id), parentId: uuid("parent_id"),
  code: varchar("code", { length: 80 }).notNull(), name: varchar("name", { length: 200 }).notNull(), enabled: boolean("enabled").notNull().default(true), ...auditColumns
}, (table) => [uniqueIndex("departments_tenant_code_uq").on(table.tenantId, table.code), index("departments_tenant_org_idx").on(table.tenantId, table.organizationId)]);

export const positions = iam.table("positions", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  departmentId: uuid("department_id").references(() => departments.id), code: varchar("code", { length: 80 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(), enabled: boolean("enabled").notNull().default(true), ...auditColumns
}, (table) => [uniqueIndex("positions_tenant_code_uq").on(table.tenantId, table.code)]);

export const employees = iam.table("employees", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  employeeNumber: varchar("employee_number", { length: 80 }).notNull(), displayName: varchar("display_name", { length: 200 }).notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id), departmentId: uuid("department_id").references(() => departments.id),
  positionId: uuid("position_id").references(() => positions.id), email: varchar("email", { length: 320 }), mobile: varchar("mobile", { length: 80 }),
  enabled: boolean("enabled").notNull().default(true), ...auditColumns
}, (table) => [uniqueIndex("employees_tenant_number_uq").on(table.tenantId, table.employeeNumber), index("employees_tenant_department_idx").on(table.tenantId, table.departmentId)]);

export const iamUsers = iam.table("users", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), employeeId: uuid("employee_id").references(() => employees.id),
  username: varchar("username", { length: 160 }).notNull(), displayName: varchar("display_name", { length: 200 }), enabled: boolean("enabled").notNull().default(true), ...auditColumns
}, (table) => [uniqueIndex("iam_users_tenant_username_uq").on(table.tenantId, table.username), uniqueIndex("iam_users_tenant_employee_uq").on(table.tenantId, table.employeeId)]);

export const identities = iam.table("identities", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), userId: uuid("user_id").notNull().references(() => iamUsers.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 80 }).notNull(), subject: varchar("subject", { length: 320 }).notNull(), claims: jsonb("claims").notNull().default({}),
  ...auditColumns
}, (table) => [uniqueIndex("identities_tenant_provider_subject_uq").on(table.tenantId, table.provider, table.subject), uniqueIndex("identities_user_provider_uq").on(table.userId, table.provider)]);

export const roles = iam.table("roles", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), code: varchar("code", { length: 120 }).notNull(),
  name: varchar("name", { length: 200 }).notNull(), system: boolean("system").notNull().default(false), enabled: boolean("enabled").notNull().default(true), ...auditColumns
}, (table) => [uniqueIndex("roles_tenant_code_uq").on(table.tenantId, table.code)]);

export const permissions = iam.table("permissions", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), code: varchar("code", { length: 200 }).notNull(),
  description: varchar("description", { length: 500 }), ...auditColumns
}, (table) => [uniqueIndex("permissions_tenant_code_uq").on(table.tenantId, table.code)]);

export const rolePermissions = iam.table("role_permissions", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }), ...auditColumns
}, (table) => [uniqueIndex("role_permissions_role_permission_uq").on(table.roleId, table.permissionId)]);

export const roleBindings = iam.table("role_bindings", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => iamUsers.id, { onDelete: "cascade" }), organizationId: uuid("organization_id").references(() => organizations.id),
  ...auditColumns
}, (table) => [uniqueIndex("role_bindings_role_user_org_uq").on(table.roleId, table.userId, table.organizationId), index("role_bindings_tenant_user_idx").on(table.tenantId, table.userId)]);

export const fieldPolicies = iam.table("field_policies", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  resource: varchar("resource", { length: 160 }).notNull(), fieldCode: varchar("field_code", { length: 200 }).notNull(), access: varchar("access", { length: 20 }).notNull(), maskPattern: varchar("mask_pattern", { length: 160 }), ...auditColumns
}, (table) => [uniqueIndex("field_policies_role_resource_field_uq").on(table.roleId, table.resource, table.fieldCode), check("field_policies_access_ck", sql`${table.access} in ('HIDDEN','READONLY','EDITABLE','MASKED')`)]);

export const planPeriods = planning.table("plan_periods", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("OPEN"),
  currentVersionId: uuid("current_version_id"),
  ...auditColumns
}, (table) => [
  uniqueIndex("plan_periods_tenant_year_month_uq").on(table.tenantId, table.year, table.month),
  check("plan_periods_month_ck", sql`${table.month} between 1 and 12`)
]);

export const planVersions = planning.table("plan_versions", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  periodId: uuid("period_id").notNull().references(() => planPeriods.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("DRAFT"),
  basedOnVersionId: uuid("based_on_version_id"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: uuid("published_by"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: uuid("locked_by"),
  lockReason: text("lock_reason"),
  ...auditColumns
}, (table) => [
  uniqueIndex("plan_versions_period_number_uq").on(table.periodId, table.versionNumber),
  index("plan_versions_period_status_idx").on(table.periodId, table.status),
  check("plan_versions_status_ck", sql`${table.status} in ('DRAFT','PUBLISHED','LOCKED','ARCHIVED')`)
]);

export const salesOrders = planning.table("sales_orders", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  orderNumber: varchar("order_number", { length: 120 }).notNull(),
  customerCode: varchar("customer_code", { length: 120 }),
  customerName: varchar("customer_name", { length: 240 }),
  orderDate: date("order_date"),
  sourceSystem: varchar("source_system", { length: 64 }),
  sourceKey: varchar("source_key", { length: 240 }),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  enabled: boolean("enabled").notNull().default(true),
  ...auditColumns
}, (table) => [
  uniqueIndex("sales_orders_tenant_number_uq").on(table.tenantId, table.orderNumber),
  index("sales_orders_source_idx").on(table.tenantId, table.sourceSystem, table.sourceKey)
]);

export const salesOrderLines = planning.table("sales_order_lines", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  salesOrderId: uuid("sales_order_id").notNull().references(() => salesOrders.id, { onDelete: "cascade" }),
  lineNumber: integer("line_number").notNull().default(1),
  itemNumber: varchar("item_number", { length: 160 }).notNull(),
  itemName: varchar("item_name", { length: 320 }),
  specification: varchar("specification", { length: 320 }),
  orderQuantity: numeric("order_quantity", { precision: 18, scale: 4 }).notNull().default("0"),
  deliveryDate: date("delivery_date"),
  sourcePayload: jsonb("source_payload").notNull().default({}),
  ...auditColumns
}, (table) => [
  uniqueIndex("sales_order_lines_order_item_uq").on(table.salesOrderId, table.itemNumber),
  index("sales_order_lines_tenant_item_idx").on(table.tenantId, table.itemNumber)
]);

export const planItems = planning.table("plan_items", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  planVersionId: uuid("plan_version_id").notNull().references(() => planVersions.id, { onDelete: "cascade" }),
  salesOrderLineId: uuid("sales_order_line_id").references(() => salesOrderLines.id),
  orderNumber: varchar("order_number", { length: 120 }).notNull(),
  itemNumber: varchar("item_number", { length: 160 }).notNull(),
  customerCode: varchar("customer_code", { length: 120 }),
  customerName: varchar("customer_name", { length: 240 }),
  itemName: varchar("item_name", { length: 320 }),
  specification: varchar("specification", { length: 320 }),
  orderQuantity: numeric("order_quantity", { precision: 18, scale: 4 }).notNull().default("0"),
  productionQuantity: numeric("production_quantity", { precision: 18, scale: 4 }).notNull().default("0"),
  historicalInboundQuantity: numeric("historical_inbound_quantity", { precision: 18, scale: 4 }).notNull().default("0"),
  currentInboundQuantity: numeric("current_inbound_quantity", { precision: 18, scale: 4 }).notNull().default("0"),
  unitPrice: numeric("unit_price", { precision: 18, scale: 6 }).notNull().default("0"),
  deliveryDate: date("delivery_date"),
  responsibleOrgId: uuid("responsible_org_id"),
  ownerUserId: uuid("owner_user_id"),
  priority: integer("priority").notNull().default(50),
  sequence: integer("sequence").notNull().default(0),
  status: varchar("status", { length: 40 }).notNull().default("PENDING"),
  exception: text("exception"),
  remark: text("remark"),
  imageRefs: jsonb("image_refs").notNull().default([]),
  legacyData: jsonb("legacy_data").notNull().default({}),
  ...auditColumns
}, (table) => [
  uniqueIndex("plan_items_version_order_item_uq").on(table.planVersionId, table.orderNumber, table.itemNumber),
  index("plan_items_version_sequence_idx").on(table.planVersionId, table.sequence),
  index("plan_items_tenant_delivery_idx").on(table.tenantId, table.deliveryDate)
]);

export const processDefinitions = planning.table("process_definitions", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  code: varchar("code", { length: 80 }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  sequence: integer("sequence").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  requiredDaysEnabled: boolean("required_days_enabled").notNull().default(true),
  dueDateEnabled: boolean("due_date_enabled").notNull().default(true),
  statusEnabled: boolean("status_enabled").notNull().default(true),
  exceptionEnabled: boolean("exception_enabled").notNull().default(true),
  statusStrategy: varchar("status_strategy", { length: 40 }).notNull().default("MANUAL"),
  ...auditColumns
}, (table) => [uniqueIndex("process_definitions_tenant_code_uq").on(table.tenantId, table.code)]);

export const processProgress = planning.table("process_progress", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  planItemId: uuid("plan_item_id").notNull().references(() => planItems.id, { onDelete: "cascade" }),
  processDefinitionId: uuid("process_definition_id").notNull().references(() => processDefinitions.id),
  requiredDays: numeric("required_days", { precision: 10, scale: 2 }),
  plannedDate: date("planned_date"),
  actualDate: date("actual_date"),
  plannedQuantity: numeric("planned_quantity", { precision: 18, scale: 4 }),
  completedQuantity: numeric("completed_quantity", { precision: 18, scale: 4 }),
  status: varchar("status", { length: 40 }),
  exception: text("exception"),
  ...auditColumns
}, (table) => [
  uniqueIndex("process_progress_item_definition_uq").on(table.planItemId, table.processDefinitionId),
  index("process_progress_tenant_date_idx").on(table.tenantId, table.plannedDate)
]);

export const planSnapshots = planning.table("plan_snapshots", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  versionId: uuid("version_id").notNull().references(() => planVersions.id),
  snapshotNumber: integer("snapshot_number").notNull(),
  payload: jsonb("payload").notNull(),
  ...auditColumns
}, (table) => [uniqueIndex("plan_snapshots_version_number_uq").on(table.versionId, table.snapshotNumber)]);

export const planChanges = planning.table("plan_changes", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  versionId: uuid("version_id").notNull().references(() => planVersions.id),
  planItemId: uuid("plan_item_id").references(() => planItems.id),
  changeType: varchar("change_type", { length: 80 }).notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  reason: text("reason"),
  source: varchar("source", { length: 40 }).notNull().default("WEB"),
  ...auditColumns
});

export const auditLogs = audit.table("audit_logs", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  userId: uuid("user_id"),
  action: varchar("action", { length: 120 }).notNull(),
  resourceType: varchar("resource_type", { length: 120 }).notNull(),
  resourceId: uuid("resource_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  reason: text("reason"),
  source: varchar("source", { length: 40 }).notNull(),
  requestId: varchar("request_id", { length: 120 }).notNull(),
  traceId: varchar("trace_id", { length: 120 }),
  ip: varchar("ip", { length: 120 }),
  ...auditColumns
}, (table) => [
  index("audit_logs_tenant_created_idx").on(table.tenantId, table.createdAt),
  index("audit_logs_resource_idx").on(table.resourceType, table.resourceId)
]);

export const importJobs = integration.table("import_jobs", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  type: varchar("type", { length: 80 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }),
  fileName: varchar("file_name", { length: 320 }),
  fileHash: varchar("file_hash", { length: 128 }),
  status: varchar("status", { length: 40 }).notNull(),
  preview: jsonb("preview"),
  result: jsonb("result"),
  error: jsonb("error"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  ...auditColumns
}, (table) => [uniqueIndex("import_jobs_tenant_idempotency_uq").on(table.tenantId, table.idempotencyKey)]);

export const businessCustomerMappings = marketing.table("business_customer_mappings", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  department: varchar("department", { length: 200 }).notNull(),
  section: varchar("section", { length: 200 }).notNull(),
  customerCode: varchar("customer_code", { length: 120 }).notNull(),
  salespersonUserIds: uuid("salesperson_user_ids").array().notNull().default(sql`'{}'::uuid[]`),
  ...auditColumns
}, (table) => [
  uniqueIndex("business_customer_mappings_tenant_customer_uq").on(table.tenantId, table.customerCode),
  index("business_customer_mappings_tenant_department_idx").on(table.tenantId, table.department, table.section)
]);

export const orderSchedules = marketing.table("order_schedules", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  customerCode: varchar("customer_code", { length: 120 }).notNull(),
  orderNumber: varchar("order_number", { length: 120 }).notNull(),
  itemNumber: varchar("item_number", { length: 160 }).notNull(),
  itemName: varchar("item_name", { length: 320 }).notNull(),
  customerDueDate: date("customer_due_date"),
  orderTotalQuantity: numeric("order_total_quantity", { precision: 18, scale: 4 }).notNull().default("0"),
  productionUnit: varchar("production_unit", { length: 200 }),
  completionRatio: numeric("completion_ratio", { precision: 7, scale: 4 }).notNull().default("0"),
  sourcePlanItemId: uuid("source_plan_item_id"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  ...auditColumns
}, (table) => [
  uniqueIndex("two_week_schedules_tenant_order_item_uq").on(table.tenantId, table.orderNumber, table.itemNumber),
  index("order_schedules_tenant_order_idx").on(table.tenantId, table.orderNumber, table.itemNumber),
  check("order_schedules_completion_ck", sql`${table.completionRatio} between 0 and 100`)
]);

export const weeklyPlanPeriods = planning.table("weekly_plan_periods", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  sequence: integer("sequence").notNull(), name: varchar("name", { length: 120 }).notNull(), startDate: date("start_date").notNull(), endDate: date("end_date").notNull(), ...auditColumns
}, (table) => [uniqueIndex("weekly_plan_periods_tenant_start_uq").on(table.tenantId, table.startDate)]);

export const weeklyPlanItems = planning.table("weekly_plan_items", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`), tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  weeklyPlanPeriodId: uuid("weekly_plan_period_id").notNull().references(() => weeklyPlanPeriods.id, { onDelete: "cascade" }),
  sourceOrderScheduleId: uuid("source_order_schedule_id").references(() => orderSchedules.id, { onDelete: "set null" }),
  customerCode: varchar("customer_code", { length: 120 }), orderNumber: varchar("order_number", { length: 120 }).notNull(), itemNumber: varchar("item_number", { length: 160 }).notNull(), itemName: varchar("item_name", { length: 320 }),
  orderTotalQuantity: numeric("order_total_quantity", { precision: 18, scale: 4 }).notNull().default("0"), productionUnit: varchar("production_unit", { length: 200 }), completionRatio: numeric("completion_ratio", { precision: 7, scale: 4 }).notNull().default("0"),
  customerDueDate: date("customer_due_date"), reviewDueDate: date("review_due_date"), ...auditColumns
}, (table) => [uniqueIndex("weekly_plan_items_period_order_item_uq").on(table.weeklyPlanPeriodId, table.orderNumber, table.itemNumber), index("weekly_plan_items_period_idx").on(table.tenantId, table.weeklyPlanPeriodId)]);

export const workReports = planning.table("work_reports", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`), tenantId: uuid("tenant_id").notNull().references(() => tenants.id), workDate: date("work_date").notNull(), sourcePlanItemId: uuid("source_plan_item_id").references(() => planItems.id, { onDelete: "set null" }),
  customer: varchar("customer", { length: 240 }), orderNumber: varchar("order_number", { length: 120 }).notNull(), itemNumber: varchar("item_number", { length: 160 }).notNull(), itemName: varchar("item_name", { length: 320 }), requiredQuantity: numeric("required_quantity", { precision: 18, scale: 4 }).notNull().default("0"), reportedQuantity: numeric("reported_quantity", { precision: 18, scale: 4 }).notNull().default("0"), ...auditColumns
}, (table) => [
  uniqueIndex("work_reports_tenant_date_source_uq").on(table.tenantId, table.workDate, table.sourcePlanItemId),
  uniqueIndex("work_reports_tenant_date_order_item_uq").on(table.tenantId, table.workDate, table.orderNumber, table.itemNumber),
  index("work_reports_tenant_date_idx").on(table.tenantId, table.workDate)
]);

export const schema = {
  tenants, organizations, departments, positions, employees, iamUsers, identities, roles, permissions, rolePermissions, roleBindings, fieldPolicies,
  planPeriods, planVersions, salesOrders, salesOrderLines, planItems,
  processDefinitions, processProgress, planSnapshots, planChanges,
  auditLogs, importJobs, businessCustomerMappings, orderSchedules, weeklyPlanPeriods, weeklyPlanItems, workReports
};

export type KdosSchema = typeof schema;
