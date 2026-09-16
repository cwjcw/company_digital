import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToOne,
  PrimaryGeneratedColumn, Unique, UpdateDateColumn
} from "typeorm";

export abstract class AuditedEntity {
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @Column({ name: "created_by", type: "uuid", nullable: true }) createdBy!: string | null;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
  @Column({ name: "updated_by", type: "varchar", default: "system" }) updatedBy!: string;
  @Column({ name: "version", type: "integer", default: 1 }) version!: number;
}

@Entity("users")
export class User extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index({ unique: true }) @Column() username!: string;
  @Column({ name: "display_name" }) displayName!: string;
  @Column({ name: "password_hash" }) passwordHash!: string;
  @Column({ default: true }) enabled!: boolean;
  @Column({ name: "division", type: "varchar", nullable: true }) division!: string | null;
  @Index({ unique: true }) @Column({ name: "employee_no", type: "varchar", nullable: true }) employeeNo!: string | null;
  @Column({ name: "wechat_user_id", type: "varchar", nullable: true }) wechatUserId!: string | null;
  @Column({ type: "varchar", nullable: true }) position!: string | null;
  @Column({ type: "varchar", nullable: true }) alias!: string | null;
  @Column({ type: "varchar", nullable: true }) gender!: string | null;
  @Column({ type: "varchar", nullable: true }) mobile!: string | null;
  @Column({ type: "varchar", nullable: true }) email!: string | null;
  @Column({ name: "department_paths", type: "jsonb", default: () => "'[]'" }) departmentPaths!: string[][];
  @Column({ name: "portal_module_order", type: "jsonb", default: () => "'[]'" }) portalModuleOrder!: string[];
  @Column({ name: "must_change_password", default: true }) mustChangePassword!: boolean;
  @Column({ name: "last_login_at", type: "timestamptz", nullable: true }) lastLoginAt!: Date | null;
  @Column({ name: "password_reset_failures", type: "integer", default: 0 }) passwordResetFailures!: number;
  @Column({ name: "password_reset_locked_at", type: "timestamptz", nullable: true }) passwordResetLockedAt!: Date | null;
}

@Entity("administrator_grants")
@Unique(["tenantId", "userId"])
export class AdministratorGrant extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "tenant_id", type: "varchar", length: 64 }) tenantId!: string;
  @Column({ name: "user_id", type: "uuid" }) userId!: string;
  @Column({ name: "system_admin", default: false }) systemAdmin!: boolean;
  @Column({ name: "module_codes", type: "jsonb", default: () => "'[]'" }) moduleCodes!: string[];
}

@Entity("role_groups")
export class RoleGroup extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index({ unique: true }) @Column() name!: string;
  @Column({ name: "sort_order", type: "integer", default: 0 }) sortOrder!: number;
}

@Entity("roles")
export class Role extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index({ unique: true }) @Column() name!: string;
  @Column({ type: "varchar", nullable: true }) description!: string | null;
  @Column({ name: "role_group_id", type: "uuid", nullable: true }) roleGroupId!: string | null;
  @Column({ name: "permission_group_resource", type: "varchar", nullable: true }) permissionGroupResource!: string | null;
  @Column({ name: "permission_group_type", type: "varchar", nullable: true }) permissionGroupType!: string | null;
  @Column({ name: "permission_group_display_name", type: "varchar", nullable: true }) permissionGroupDisplayName!: string | null;
  @Column({ name: "permission_group_enabled", default: true }) permissionGroupEnabled!: boolean;
  @Column({ name: "permission_group_scope", type: "varchar", nullable: true }) permissionGroupScope!: string | null;
  @Column({ name: "permission_group_condition_match", type: "varchar", default: "ALL" }) permissionGroupConditionMatch!: string;
  @Column({ name: "permission_group_data_rules", type: "jsonb", default: () => "'[]'" }) permissionGroupDataRules!: Array<Record<string, unknown>>;
}

@Entity("permission_group_subjects")
@Unique(["roleId", "subjectType", "subjectId"])
export class PermissionGroupSubject extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "role_id", type: "uuid" }) roleId!: string;
  @Column({ name: "subject_type", type: "varchar" }) subjectType!: "USER" | "ORGANIZATION" | "ROLE";
  @Column({ name: "subject_id", type: "uuid" }) subjectId!: string;
}

@Entity("user_roles")
@Unique(["userId", "roleId"])
export class UserRole extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "user_id", type: "uuid" }) userId!: string;
  @Column({ name: "role_id", type: "uuid" }) roleId!: string;
}

@Entity("permissions")
@Unique(["roleId", "resource", "fieldKey"])
export class Permission extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "role_id", type: "uuid" }) roleId!: string;
  @Column() resource!: string;
  @Column({ name: "field_key", default: "*" }) fieldKey!: string;
  @Column({ default: false }) read!: boolean;
  @Column({ default: false }) create!: boolean;
  @Column({ default: false }) copy!: boolean;
  @Column({ default: false }) update!: boolean;
  @Column({ default: false }) delete!: boolean;
  @Column({ name: "batch_print", default: false }) batchPrint!: boolean;
  @Column({ name: "batch_update", default: false }) batchUpdate!: boolean;
  @Column({ default: false }) import!: boolean;
  @Column({ default: false }) export!: boolean;
}

@Entity("role_data_scopes")
@Unique(["roleId", "division"])
export class RoleDataScope extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "role_id", type: "uuid" }) roleId!: string;
  @Column() division!: string;
}

@Entity("role_organization_scopes")
@Unique(["roleId", "organizationUnitId"])
export class RoleOrganizationScope extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "role_id", type: "uuid" }) roleId!: string;
  @Column({ name: "organization_unit_id", type: "uuid" }) organizationUnitId!: string;
}

@Entity("organization_units")
@Unique(["parentId", "name"])
export class OrganizationUnit extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index({ unique: true }) @Column({ name: "wechat_department_id", type: "varchar", nullable: true }) wechatDepartmentId!: string | null;
  @Column() name!: string;
  @Column({ type: "smallint" }) level!: number;
  @Column({ name: "parent_id", type: "uuid", nullable: true }) parentId!: string | null;
  @Column({ name: "division", type: "varchar", nullable: true }) division!: string | null;
  @Column({ default: true }) enabled!: boolean;
  @Column({ name: "sort_order", type: "integer", default: 0 }) sortOrder!: number;
  @Column({ name: "leader_user_ids", type: "jsonb", default: () => "'[]'" }) leaderUserIds!: string[];
}

@Entity("contacts")
export class Contact extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index({ unique: true }) @Column({ name: "wechat_user_id" }) wechatUserId!: string;
  @Column({ name: "employee_no", type: "varchar", nullable: true }) employeeNo!: string | null;
  @Column() name!: string;
  @Column({ type: "varchar", nullable: true }) position!: string | null;
  @Column({ type: "varchar", nullable: true }) telephone!: string | null;
  @Column({ name: "direct_leaders", type: "jsonb", default: () => "'[]'" }) directLeaders!: string[];
  @Column({ name: "department_paths", type: "jsonb", default: () => "'[]'" }) departmentPaths!: string[][];
  @Column({ default: true }) enabled!: boolean;
  @CreateDateColumn({ name: "imported_at", type: "timestamptz" }) importedAt!: Date;
}

@Entity("development_requests")
@Index(["status", "updatedAt"])
export class DevelopmentRequest extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index({ unique: true }) @Column({ name: "request_number" }) requestNumber!: string;
  @Column({ type: "varchar", length: 200, nullable: true }) title!: string | null;
  @Column({ type: "varchar", length: 50, nullable: true }) category!: string | null;
  @Column({ type: "text", nullable: true }) description!: string | null;
  @Column({ name: "business_value", type: "text", nullable: true }) businessValue!: string | null;
  @Column({ length: 20, default: "NORMAL" }) urgency!: string;
  @Column({ name: "desired_date", type: "date", nullable: true }) desiredDate!: string | null;
  @Index() @Column({ length: 50 }) status!: string;
  @Index() @Column({ name: "requester_id", type: "uuid" }) requesterId!: string;
  @Index() @Column({ name: "requester_manager_id", type: "uuid", nullable: true }) requesterManagerId!: string | null;
  @Index() @Column({ name: "handler_id", type: "uuid", nullable: true }) handlerId!: string | null;
  @Index() @Column({ name: "handler_manager_id", type: "uuid", nullable: true }) handlerManagerId!: string | null;
  @Column({ name: "required_resources", type: "text", nullable: true }) requiredResources!: string | null;
  @Column({ name: "estimated_workdays", type: "numeric", precision: 8, scale: 2, nullable: true }) estimatedWorkdays!: string | null;
  @Column({ name: "planned_completion_date", type: "date", nullable: true }) plannedCompletionDate!: string | null;
  @Column({ name: "requester_approved_at", type: "timestamptz", nullable: true }) requesterApprovedAt!: Date | null;
  @Column({ name: "assigned_at", type: "timestamptz", nullable: true }) assignedAt!: Date | null;
  @Column({ name: "plan_submitted_at", type: "timestamptz", nullable: true }) planSubmittedAt!: Date | null;
  @Column({ name: "handler_manager_approved_at", type: "timestamptz", nullable: true }) handlerManagerApprovedAt!: Date | null;
}

@Entity("development_request_events")
@Index(["requestId", "createdAt"])
export class DevelopmentRequestEvent extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "request_id", type: "uuid" }) requestId!: string;
  @Column({ name: "actor_id", type: "uuid" }) actorId!: string;
  @Column({ name: "actor_name" }) actorName!: string;
  @Column({ length: 50 }) action!: string;
  @Column({ name: "from_status", type: "varchar", nullable: true }) fromStatus!: string | null;
  @Column({ name: "to_status", type: "varchar" }) toStatus!: string;
  @Column({ type: "text", nullable: true }) comment!: string | null;
  @Column({ type: "jsonb", nullable: true }) snapshot!: unknown;
}

@Entity("approval_flow_configs")
export class ApprovalFlowConfig extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index({ unique: true }) @Column({ name: "flow_key", length: 100 }) flowKey!: string;
  @Column({ length: 100 }) name!: string;
  @Column({ default: true }) enabled!: boolean;
  @Column({ name: "allow_draft", default: true }) allowDraft!: boolean;
  @Column({ name: "allow_withdraw", default: true }) allowWithdraw!: boolean;
  @Column({ name: "return_mode", length: 30, default: "ANY_PREVIOUS" }) returnMode!: "ANY_PREVIOUS" | "PREVIOUS_ONLY";
  @Column({ name: "reject_target_mode", length: 30, default: "DRAFT" }) rejectTargetMode!: "DRAFT" | "PREVIOUS";
  @Column({ name: "approval_comment_required", default: false }) approvalCommentRequired!: boolean;
  @Column({ name: "admin_role_names", type: "jsonb", default: () => "'[\"系统管理员\",\"集团管理员\"]'" }) adminRoleNames!: string[];
  @Column({ name: "node_labels", type: "jsonb", default: () => "'{}'" }) nodeLabels!: Record<string, string>;
}

@Entity("plan_periods")
@Unique(["year", "month"])
export class PlanPeriod extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ type: "smallint" }) year!: number;
  @Column({ type: "smallint" }) month!: number;
  @Column({ default: "active" }) status!: string;
}

@Entity("orders")
@Index(["orderNumber"])
export class Order extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "order_number" }) orderNumber!: string;
  @Column({ name: "order_date", type: "date", nullable: true }) orderDate!: string | null;
  @Column({ name: "customer_due_date", type: "date", nullable: true }) customerDueDate!: string | null;
  @Column({ name: "review_due_date", type: "date", nullable: true }) reviewDueDate!: string | null;
  @Column({ name: "exception_due_date", type: "date", nullable: true }) exceptionDueDate!: string | null;
  @Column({ name: "exception_delivery_method", type: "varchar", nullable: true }) exceptionDeliveryMethod!: string | null;
  @Column({ type: "varchar", nullable: true }) customer!: string | null;
  @Column({ type: "varchar", nullable: true }) salesperson!: string | null;
  @Column({ name: "order_type", type: "varchar", nullable: true }) orderType!: string | null;
  @Column({ name: "order_amount", type: "numeric", precision: 18, scale: 4, nullable: true }) orderAmount!: string | null;
  @Column({ name: "actual_completion_date", type: "date", nullable: true }) actualCompletionDate!: string | null;
  @Column({ name: "shipping_date", type: "date", nullable: true }) shippingDate!: string | null;
  @Column({ name: "delivery_score", type: "numeric", precision: 8, scale: 2, nullable: true }) deliveryScore!: string | null;
  @Column({ name: "quality_score", type: "numeric", precision: 8, scale: 2, nullable: true }) qualityScore!: string | null;
  @Index() @Column({ name: "source_system", type: "varchar", nullable: true }) sourceSystem!: string | null;
  @Index() @Column({ name: "source_database", type: "varchar", nullable: true }) sourceDatabase!: string | null;
  @Column({ name: "source_account_name", type: "varchar", nullable: true }) sourceAccountName!: string | null;
  @Column({ name: "source_total_quantity", type: "numeric", precision: 28, scale: 6, nullable: true }) sourceTotalQuantity!: string | null;
  @Column({ name: "source_active", default: true }) sourceActive!: boolean;
  @Index() @Column({ type: "varchar", nullable: true }) division!: string | null;
}

@Entity("order_items")
@Unique(["periodId", "orderId", "itemNumber"])
@Index(["periodId", "orderId"])
export class OrderItem extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "order_id", type: "uuid" }) orderId!: string;
  @ManyToOne(() => Order, { onDelete: "CASCADE" }) @JoinColumn({ name: "order_id" }) order!: Order;
  @Column({ name: "period_id", type: "uuid" }) periodId!: string;
  @ManyToOne(() => PlanPeriod, { onDelete: "RESTRICT" }) @JoinColumn({ name: "period_id" }) period!: PlanPeriod;
  @Column({ name: "item_number" }) itemNumber!: string;
  @Column({ name: "relation_key" }) relationKey!: string;
  @Column({ name: "item_name", type: "varchar", nullable: true }) itemName!: string | null;
  @Column({ name: "customer_due_date", type: "date", nullable: true }) customerDueDate!: string | null;
  @Column({ name: "review_due_date", type: "date", nullable: true }) reviewDueDate!: string | null;
  @Column({ name: "exception_due_date", type: "date", nullable: true }) exceptionDueDate!: string | null;
  @Column({ name: "exception_delivery_method", type: "varchar", nullable: true }) exceptionDeliveryMethod!: string | null;
  @Column({ type: "varchar", nullable: true }) customer!: string | null;
  @Index() @Column({ type: "varchar", nullable: true }) division!: string | null;
  @Column({ name: "container_date", type: "date", nullable: true }) containerDate!: string | null;
  @Column({ name: "model_age", type: "varchar", nullable: true }) modelAge!: string | null;
  @Column({ name: "image_refs", type: "jsonb", nullable: true }) imageRefs!: string[] | null;
  @Column({ name: "product_attribute", type: "varchar", nullable: true }) productAttribute!: string | null;
  @Column({ name: "surface_nature", type: "varchar", nullable: true }) surfaceNature!: string | null;
  @Column({ name: "special_item", type: "varchar", nullable: true }) specialItem!: string | null;
  @Column({ name: "production_quantity", type: "numeric", precision: 18, scale: 4, nullable: true }) productionQuantity!: string | null;
  @Column({ name: "historical_inbound_quantity", type: "numeric", precision: 18, scale: 4, nullable: true }) historicalInboundQuantity!: string | null;
  @Column({ name: "today_inbound_quantity", type: "numeric", precision: 18, scale: 4, nullable: true }) todayInboundQuantity!: string | null;
  @Column({ name: "handling_method", type: "varchar", nullable: true }) handlingMethod!: string | null;
  @Column({ name: "plan_page", type: "numeric", nullable: true }) planPage!: string | null;
  @Column({ name: "order_exception", type: "varchar", nullable: true }) orderException!: string | null;
  @Column({ type: "varchar", nullable: true }) inspection!: string | null;
  @Column({ name: "inspection_quantity", type: "numeric", nullable: true }) inspectionQuantity!: string | null;
  @Column({ type: "varchar", nullable: true }) remark!: string | null;
  @Column({ name: "order_weeks", type: "numeric", nullable: true }) orderWeeks!: string | null;
  @Column({ name: "source_month", type: "smallint", nullable: true }) month!: number | null;
  @Column({ name: "unit_price", type: "numeric", precision: 18, scale: 4, nullable: true }) unitPrice!: string | null;
  @Column({ default: true }) active!: boolean;
}

@Entity("outsourcing_details")
export class OutsourcingDetail extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index({ unique: true }) @Column({ name: "order_item_id", type: "uuid" }) orderItemId!: string;
  @OneToOne(() => OrderItem, { onDelete: "CASCADE" }) @JoinColumn({ name: "order_item_id" }) orderItem!: OrderItem;
  @Column({ type: "varchar", nullable: true }) supplier!: string | null;
  @Column({ type: "varchar", nullable: true }) method!: string | null;
  @Column({ name: "due_date", type: "date", nullable: true }) dueDate!: string | null;
  @Column({ name: "exception_due_date", type: "date", nullable: true }) exceptionDueDate!: string | null;
}

@Entity("process_definitions")
export class ProcessDefinitionEntity extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index({ unique: true }) @Column() code!: string;
  @Column() name!: string;
  @Column({ name: "sort_order", type: "smallint" }) sortOrder!: number;
  @Column({ name: "enable_required_days", default: false }) enableRequiredDays!: boolean;
  @Column({ name: "enable_due_date", default: true }) enableDueDate!: boolean;
  @Column({ name: "enable_status", default: true }) enableStatus!: boolean;
  @Column({ name: "enable_exception", default: false }) enableException!: boolean;
  @Column({ default: true }) enabled!: boolean;
}

@Entity("item_process_progress")
@Unique(["orderItemId", "processDefinitionId"])
export class ItemProcessProgress extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "order_item_id", type: "uuid" }) orderItemId!: string;
  @Column({ name: "process_definition_id", type: "uuid" }) processDefinitionId!: string;
  @Column({ name: "required_days", type: "numeric", precision: 8, scale: 2, nullable: true }) requiredDays!: string | null;
  @Column({ name: "due_date", type: "date", nullable: true }) dueDate!: string | null;
  @Column({ type: "numeric", precision: 12, scale: 2, nullable: true }) quantity!: string | null;
  @Column({ type: "varchar", nullable: true }) status!: string | null;
  @Column({ type: "varchar", nullable: true }) exception!: string | null;
}

@Entity("dictionary_types")
export class DictionaryType extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index({ unique: true }) @Column() code!: string;
  @Column() name!: string;
}

@Entity("dictionary_values")
@Unique(["typeId", "value"])
export class DictionaryValue extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "type_id", type: "uuid" }) typeId!: string;
  @Column() value!: string;
  @Column({ name: "sort_order", default: 0 }) sortOrder!: number;
  @Column({ default: true }) enabled!: boolean;
}

@Entity("supply_chain_suppliers")
@Unique(["tenantId", "sourceSystem", "sourceDatabase", "sourceId"])
@Index(["tenantId", "code"])
@Index(["tenantId", "name"])
export class SupplyChainSupplier extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "tenant_id", type: "varchar", length: 64 }) tenantId!: string;
  @Column({ name: "source_system", type: "varchar", length: 32 }) sourceSystem!: string;
  @Column({ name: "source_database", type: "varchar", length: 128 }) sourceDatabase!: string;
  @Column({ name: "source_account_name", type: "varchar", length: 128 }) sourceAccountName!: string;
  @Column({ name: "source_id", type: "varchar", length: 128 }) sourceId!: string;
  @Column({ type: "varchar", length: 128 }) code!: string;
  @Column({ type: "varchar", length: 500 }) name!: string;
  @Column({ type: "varchar", length: 500, nullable: true }) abbreviation!: string | null;
  @Column({ type: "varchar", length: 255, nullable: true }) shorthand!: string | null;
  @Column({ name: "category_code", type: "varchar", length: 128, nullable: true }) categoryCode!: string | null;
  @Column({ name: "category_name", type: "varchar", length: 500, nullable: true }) categoryName!: string | null;
  @Column({ name: "partner_type", type: "integer" }) partnerType!: number;
  @Column({ name: "partner_type_label", type: "varchar", length: 64 }) partnerTypeLabel!: string;
  @Column({ type: "varchar", length: 255, nullable: true }) representative!: string | null;
  @Column({ type: "varchar", length: 255, nullable: true }) contact!: string | null;
  @Column({ name: "mobile_phone", type: "varchar", length: 255, nullable: true }) mobilePhone!: string | null;
  @Column({ type: "varchar", length: 255, nullable: true }) telephone!: string | null;
  @Column({ type: "varchar", length: 255, nullable: true }) fax!: string | null;
  @Column({ type: "varchar", length: 500, nullable: true }) email!: string | null;
  @Column({ type: "text", nullable: true }) address!: string | null;
  @Column({ default: true }) enabled!: boolean;
  @Column({ name: "source_updated_at", type: "varchar", length: 40, nullable: true }) sourceUpdatedAt!: string | null;
}

@Entity("sales_orders")
export class SalesOrder extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index() @Column({ name: "source_system", type: "varchar", nullable: true }) sourceSystem!: string | null;
  @Index() @Column({ name: "source_database", type: "varchar", nullable: true }) sourceDatabase!: string | null;
  @Column({ name: "source_key", type: "varchar", nullable: true }) sourceKey!: string | null;
  @Column({ name: "document_date", type: "date", nullable: true }) documentDate!: string | null;
  @Index() @Column({ name: "order_number" }) orderNumber!: string;
  @Column({ name: "document_name", type: "varchar", nullable: true }) documentName!: string | null;
  @Column({ name: "close_status", type: "varchar", nullable: true }) closeStatus!: string | null;
  @Index() @Column({ name: "customer_code", type: "varchar", nullable: true }) customerCode!: string | null;
  @Column({ name: "ship_to_customer_code", type: "varchar", nullable: true }) shipToCustomerCode!: string | null;
  @Column({ name: "invoice_customer_code", type: "varchar", nullable: true }) invoiceCustomerCode!: string | null;
  @Column({ name: "employee_name", type: "varchar", nullable: true }) employeeName!: string | null;
  @Column({ name: "tax_included", type: "varchar", nullable: true }) taxIncluded!: string | null;
  @Column({ name: "currency_code", type: "varchar", nullable: true }) currencyCode!: string | null;
  @Column({ name: "exchange_rate", type: "numeric", precision: 18, scale: 6, nullable: true }) exchangeRate!: string | null;
  @Column({ name: "sequence_number", type: "integer", nullable: true }) sequenceNumber!: number | null;
  @Index() @Column({ name: "item_number" }) itemNumber!: string;
  @Column({ name: "item_name", type: "varchar", nullable: true }) itemName!: string | null;
  @Column({ type: "varchar", nullable: true }) specification!: string | null;
  @Column({ name: "unit_name", type: "varchar", nullable: true }) unitName!: string | null;
  @Column({ name: "business_quantity", type: "numeric", precision: 18, scale: 4, nullable: true }) businessQuantity!: string | null;
  @Column({ name: "price_quantity", type: "numeric", precision: 18, scale: 4, nullable: true }) priceQuantity!: string | null;
  @Column({ type: "numeric", precision: 18, scale: 6, nullable: true }) price!: string | null;
  @Column({ name: "rmb_price", type: "numeric", precision: 18, scale: 6, nullable: true }) rmbPrice!: string | null;
  @Column({ name: "rmb_tax_included_amount", type: "numeric", precision: 20, scale: 6, nullable: true }) rmbTaxIncludedAmount!: string | null;
  @Column({ name: "delivered_business_quantity", type: "numeric", precision: 18, scale: 4, nullable: true }) deliveredBusinessQuantity!: string | null;
  @Column({ name: "planned_delivery_date", type: "date", nullable: true }) plannedDeliveryDate!: string | null;
  @Column({ name: "tax_rate", type: "numeric", precision: 10, scale: 4, nullable: true }) taxRate!: string | null;
  @Column({ name: "amount_excluding_tax_bc", type: "numeric", precision: 20, scale: 6, nullable: true }) amountExcludingTaxBc!: string | null;
  @Column({ name: "tax_bc", type: "numeric", precision: 20, scale: 6, nullable: true }) taxBc!: string | null;
  @Column({ name: "creator_user_id", type: "varchar", nullable: true }) creatorUserId!: string | null;
  @Column({ name: "creator_user_name", type: "varchar", nullable: true }) creatorUserName!: string | null;
  @Column({ name: "admin_unit_name", type: "varchar", nullable: true }) adminUnitName!: string | null;
  @Column({ name: "owner_department", type: "varchar", nullable: true }) ownerDepartment!: string | null;
  @Column({ name: "owner_employee", type: "varchar", nullable: true }) ownerEmployee!: string | null;
  @Column({ name: "owner_division", type: "varchar", nullable: true }) ownerDivision!: string | null;
  @Column({ name: "order_date", type: "date", nullable: true }) orderDate!: string | null;
  @Column({ name: "review_due_date", type: "date", nullable: true }) reviewDueDate!: string | null;
  @Column({ type: "numeric", precision: 18, scale: 4, nullable: true }) quantity!: string | null;
  @Column({ type: "text", nullable: true }) remark!: string | null;
}

@Entity("finished_goods_inbound")
@Unique(["documentNumber", "inventoryCode", "relationInfo"])
export class FinishedGoodsInbound extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index() @Column({ name: "source_system", type: "varchar", nullable: true }) sourceSystem!: string | null;
  @Index() @Column({ name: "source_database", type: "varchar", nullable: true }) sourceDatabase!: string | null;
  @Column({ name: "source_key", type: "varchar", nullable: true }) sourceKey!: string | null;
  @Column({ name: "category_number", type: "varchar", nullable: true }) categoryNumber!: string | null;
  @Index() @Column({ name: "sales_order_number", type: "varchar", nullable: true }) salesOrderNumber!: string | null;
  @Column({ name: "document_full_name", type: "varchar", nullable: true }) documentFullName!: string | null;
  @Column({ name: "document_date", type: "date", nullable: true }) documentDate!: string | null;
  @Index() @Column({ name: "inbound_date", type: "date", nullable: true }) inboundDate!: string | null;
  @Column({ name: "line_number", type: "integer", nullable: true }) lineNumber!: number | null;
  @Index() @Column({ name: "work_order_number", type: "varchar", nullable: true }) workOrderNumber!: string | null;
  @Column({ name: "created_time", type: "timestamptz", nullable: true }) createdTime!: Date | null;
  @Index() @Column({ name: "document_number" }) documentNumber!: string;
  @Column({ name: "business_type", type: "varchar", nullable: true }) businessType!: string | null;
  @Column({ name: "warehouse_code", type: "varchar", nullable: true }) warehouseCode!: string | null;
  @Column({ type: "varchar", nullable: true }) warehouse!: string | null;
  @Column({ name: "inbound_category", type: "varchar", nullable: true }) inboundCategory!: string | null;
  @Column({ name: "workshop_code", type: "varchar", nullable: true }) workshopCode!: string | null;
  @Column({ type: "varchar", nullable: true }) workshop!: string | null;
  @Column({ name: "handler_code", type: "varchar", nullable: true }) handlerCode!: string | null;
  @Column({ type: "varchar", nullable: true }) handler!: string | null;
  @Column({ type: "text", nullable: true }) remark!: string | null;
  @Column({ type: "varchar", nullable: true }) creator!: string | null;
  @Column({ type: "varchar", nullable: true }) auditor!: string | null;
  @Index() @Column({ name: "inventory_code" }) inventoryCode!: string;
  @Column({ name: "quick_code", type: "varchar", nullable: true }) quickCode!: string | null;
  @Column({ name: "inventory_name", type: "varchar", nullable: true }) inventoryName!: string | null;
  @Column({ type: "varchar", nullable: true }) specification!: string | null;
  @Column({ type: "varchar", nullable: true }) unit!: string | null;
  @Index() @Column({ name: "relation_info" }) relationInfo!: string;
  @Column({ name: "received_quantity", type: "numeric", precision: 18, scale: 4, nullable: true }) receivedQuantity!: string | null;
  @Column({ name: "unit_price", type: "numeric", precision: 18, scale: 6, nullable: true }) unitPrice!: string | null;
  @Column({ name: "total_amount", type: "numeric", precision: 18, scale: 6, nullable: true }) totalAmount!: string | null;
  @Column({ name: "voucher_word", type: "varchar", nullable: true }) voucherWord!: string | null;
  @Column({ type: "varchar", nullable: true }) category!: string | null;
}

@Entity("finished_goods_outbound")
@Unique(["sourceSystem", "sourceDatabase", "sourceKey"])
export class FinishedGoodsOutbound extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index() @Column({ name: "source_system" }) sourceSystem!: string;
  @Index() @Column({ name: "source_database" }) sourceDatabase!: string;
  @Column({ name: "source_key" }) sourceKey!: string;
  @Column({ name: "document_date", type: "date", nullable: true }) documentDate!: string | null;
  @Index() @Column({ name: "document_number" }) documentNumber!: string;
  @Column({ name: "document_status", type: "varchar", nullable: true }) documentStatus!: string | null;
  @Column({ name: "direction_value", type: "smallint", nullable: true }) directionValue!: number | null;
  @Column({ name: "voucher_type", type: "varchar", nullable: true }) voucherType!: string | null;
  @Column({ name: "business_type", type: "varchar", nullable: true }) businessType!: string | null;
  @Column({ name: "customer_code", type: "varchar", nullable: true }) customerCode!: string | null;
  @Column({ name: "customer_name", type: "varchar", nullable: true }) customerName!: string | null;
  @Index() @Column({ name: "sales_order_number", type: "varchar", nullable: true }) salesOrderNumber!: string | null;
  @Index() @Column({ name: "item_number" }) itemNumber!: string;
  @Column({ name: "item_name", type: "varchar", nullable: true }) itemName!: string | null;
  @Column({ type: "varchar", nullable: true }) specification!: string | null;
  @Column({ type: "numeric", precision: 18, scale: 4, nullable: true }) quantity!: string | null;
  @Column({ type: "varchar", nullable: true }) unit!: string | null;
  @Column({ name: "unit_price", type: "numeric", precision: 18, scale: 6, nullable: true }) unitPrice!: string | null;
  @Column({ name: "total_amount", type: "numeric", precision: 20, scale: 6, nullable: true }) totalAmount!: string | null;
  @Column({ name: "warehouse_code", type: "varchar", nullable: true }) warehouseCode!: string | null;
  @Column({ type: "varchar", nullable: true }) warehouse!: string | null;
  @Column({ name: "source_document_number", type: "varchar", nullable: true }) sourceDocumentNumber!: string | null;
  @Column({ type: "varchar", nullable: true }) creator!: string | null;
  @Column({ type: "varchar", nullable: true }) auditor!: string | null;
  @Column({ type: "text", nullable: true }) remark!: string | null;
}

@Entity("audit_logs")
@Index(["createdAt"])
export class AuditLog extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "actor_id", type: "uuid", nullable: true }) actorId!: string | null;
  @Column({ name: "actor_name", type: "varchar", nullable: true }) actorName!: string | null;
  @Column() resource!: string;
  @Column({ name: "record_id", type: "varchar", nullable: true }) recordId!: string | null;
  @Column() action!: string;
  @Column({ name: "before_json", type: "jsonb", nullable: true }) beforeJson!: unknown;
  @Column({ name: "after_json", type: "jsonb", nullable: true }) afterJson!: unknown;
  @Column({ name: "request_id" }) requestId!: string;
  @Column() source!: string;
}

@Entity("api_keys")
export class ApiKey extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column() name!: string;
  @Index({ unique: true }) @Column({ name: "key_hash" }) keyHash!: string;
  @Column({ type: "jsonb" }) scopes!: string[];
  @Column({ name: "expires_at", type: "timestamptz", nullable: true }) expiresAt!: Date | null;
  @Column({ name: "last_used_at", type: "timestamptz", nullable: true }) lastUsedAt!: Date | null;
  @Column({ default: true }) enabled!: boolean;
  @Column({ name: "user_id", type: "uuid", nullable: true }) userId!: string | null;
  @Column({ name: "role_id", type: "uuid", nullable: true }) roleId!: string | null;
}

@Entity("refresh_tokens")
export class RefreshToken extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "user_id", type: "uuid" }) userId!: string;
  @Index({ unique: true }) @Column({ name: "token_hash" }) tokenHash!: string;
  @Column({ name: "expires_at", type: "timestamptz" }) expiresAt!: Date;
  @Column({ name: "revoked_at", type: "timestamptz", nullable: true }) revokedAt!: Date | null;
}

@Entity("password_reset_requests")
@Index(["userId", "createdAt"])
export class PasswordResetRequest extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "user_id", type: "uuid" }) userId!: string;
  @Column({ name: "code_hash" }) codeHash!: string;
  @Column({ name: "expires_at", type: "timestamptz" }) expiresAt!: Date;
  @Column({ name: "consumed_at", type: "timestamptz", nullable: true }) consumedAt!: Date | null;
  @Column({ type: "integer", default: 0 }) attempts!: number;
  @Column({ name: "request_ip", type: "varchar", nullable: true }) requestIp!: string | null;
}

@Entity("equipment_assets")
@Unique(["tenantId", "divisionOrganizationUnitId", "equipmentCode"])
@Index(["tenantId", "divisionOrganizationUnitId"])
export class EquipmentAsset extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "tenant_id", type: "varchar", length: 64 }) tenantId!: string;
  @Column({ name: "division_organization_unit_id", type: "uuid" }) divisionOrganizationUnitId!: string;
  @Column({ name: "division_name_snapshot", type: "varchar" }) divisionNameSnapshot!: string;
  @Column({ name: "usage_department_organization_unit_id", type: "uuid", nullable: true }) usageDepartmentOrganizationUnitId!: string | null;
  @Column({ name: "usage_department_name_snapshot", type: "varchar" }) usageDepartmentNameSnapshot!: string;
  @Column({ name: "equipment_code", type: "varchar" }) equipmentCode!: string;
  @Column({ name: "equipment_name", type: "varchar" }) equipmentName!: string;
  @Column({ name: "purchase_date", type: "date", nullable: true }) purchaseDate!: string | null;
  @Column({ name: "planned_startup_minutes", type: "integer", default: 0 }) plannedStartupMinutes!: number;
  @Column({ default: false }) monitored!: boolean;
  @Column({ default: true }) active!: boolean;
  @Column({ name: "source_sheet_row", type: "integer", nullable: true }) sourceSheetRow!: number | null;
}

@Entity("equipment_responsibles")
@Unique(["tenantId", "equipmentId", "userId"])
@Index(["tenantId", "userId"])
export class EquipmentResponsible extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "tenant_id", type: "varchar", length: 64 }) tenantId!: string;
  @Column({ name: "equipment_id", type: "uuid" }) equipmentId!: string;
  @Column({ name: "user_id", type: "uuid" }) userId!: string;
}

@Entity("equipment_status_reports")
@Unique(["tenantId", "equipmentId", "reportDate"])
@Index(["tenantId", "reportDate"])
@Index(["tenantId", "equipmentId"])
export class EquipmentStatusReport extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "tenant_id", type: "varchar", length: 64 }) tenantId!: string;
  @Column({ name: "equipment_id", type: "uuid" }) equipmentId!: string;
  @Column({ name: "division_organization_unit_id", type: "uuid" }) divisionOrganizationUnitId!: string;
  @Column({ name: "usage_department_organization_unit_id", type: "uuid", nullable: true }) usageDepartmentOrganizationUnitId!: string | null;
  @Column({ name: "equipment_code_snapshot", type: "varchar" }) equipmentCodeSnapshot!: string;
  @Column({ name: "equipment_name_snapshot", type: "varchar" }) equipmentNameSnapshot!: string;
  @Column({ name: "division_name_snapshot", type: "varchar" }) divisionNameSnapshot!: string;
  @Column({ name: "usage_department_name_snapshot", type: "varchar" }) usageDepartmentNameSnapshot!: string;
  @Column({ name: "report_date", type: "date" }) reportDate!: string;
  @Column({ name: "runtime_minutes", type: "integer", default: 0 }) runtimeMinutes!: number;
  @Column({ name: "fault_minutes", type: "integer", default: 0 }) faultMinutes!: number;
  @Column({ name: "fault_reason", type: "varchar", nullable: true }) faultReason!: string | null;
  @Column({ default: true }) active!: boolean;
}

@Entity("import_jobs")
export class ImportJob extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "file_name" }) fileName!: string;
  @Column({ name: "file_hash" }) fileHash!: string;
  @Column() status!: string;
  @Column({ type: "jsonb", nullable: true }) summary!: unknown;
  @Column({ name: "preview_payload", type: "jsonb", nullable: true }) previewPayload!: unknown;
}

@Entity("import_job_errors")
export class ImportJobError extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "job_id", type: "uuid" }) jobId!: string;
  @Column({ name: "sheet_name" }) sheetName!: string;
  @Column({ name: "row_number", type: "integer", nullable: true }) rowNumber!: number | null;
  @Column({ name: "field_key", type: "varchar", nullable: true }) fieldKey!: string | null;
  @Column() level!: string;
  @Column() message!: string;
}

@Entity("idempotency_keys")
export class IdempotencyRecord extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index({ unique: true }) @Column() key!: string;
  @Column({ name: "request_hash" }) requestHash!: string;
  @Column({ name: "response_json", type: "jsonb" }) responseJson!: unknown;
}

export const entities = [
  User, AdministratorGrant, RoleGroup, Role, PermissionGroupSubject, UserRole, Permission, RoleDataScope, RoleOrganizationScope, OrganizationUnit, Contact,
  DevelopmentRequest, DevelopmentRequestEvent, ApprovalFlowConfig, PlanPeriod, Order, OrderItem,
  OutsourcingDetail, ProcessDefinitionEntity, ItemProcessProgress, DictionaryType,
  DictionaryValue, SupplyChainSupplier, SalesOrder, FinishedGoodsInbound, FinishedGoodsOutbound, AuditLog, ApiKey,
  RefreshToken, PasswordResetRequest, EquipmentAsset, EquipmentResponsible, EquipmentStatusReport,
  ImportJob, ImportJobError, IdempotencyRecord
];
