import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToOne,
  PrimaryGeneratedColumn, Unique, UpdateDateColumn
} from "typeorm";

export abstract class AuditedEntity {
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
  @Column({ name: "updated_by", type: "varchar", default: "system" }) updatedBy!: string;
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
  @Column({ name: "department_paths", type: "jsonb", default: () => "'[]'" }) departmentPaths!: string[][];
  @Column({ name: "must_change_password", default: true }) mustChangePassword!: boolean;
  @Column({ name: "last_login_at", type: "timestamptz", nullable: true }) lastLoginAt!: Date | null;
}

@Entity("roles")
export class Role extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index({ unique: true }) @Column() name!: string;
  @Column({ type: "varchar", nullable: true }) description!: string | null;
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
  @Column({ default: false }) update!: boolean;
  @Column({ default: false }) delete!: boolean;
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
  @Column() name!: string;
  @Column({ type: "smallint" }) level!: number;
  @Column({ name: "parent_id", type: "uuid", nullable: true }) parentId!: string | null;
  @Column({ name: "division", type: "varchar", nullable: true }) division!: string | null;
  @Column({ default: true }) enabled!: boolean;
  @Column({ name: "sort_order", type: "integer", default: 0 }) sortOrder!: number;
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
  @Column({ default: 1 }) version!: number;
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
  @Column({ default: 1 }) version!: number;
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
  @Column({ default: 1 }) version!: number;
}

@Entity("daily_process_progress")
@Unique(["orderItemId", "processDefinitionId", "workDate"])
@Index(["workDate"])
export class DailyProcessProgress extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "order_item_id", type: "uuid" }) orderItemId!: string;
  @Column({ name: "process_definition_id", type: "uuid" }) processDefinitionId!: string;
  @Column({ name: "work_date", type: "date" }) workDate!: string;
  @Column({ type: "numeric", precision: 18, scale: 4 }) quantity!: string;
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

@Entity("suppliers")
export class Supplier extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index({ unique: true }) @Column({ type: "varchar", nullable: true }) code!: string | null;
  @Index({ unique: true }) @Column() name!: string;
  @Column({ default: true }) enabled!: boolean;
  @Column({ type: "varchar", nullable: true }) remark!: string | null;
}

@Entity("sales_orders")
@Unique(["orderNumber", "itemNumber"])
export class SalesOrder extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index() @Column({ name: "order_number" }) orderNumber!: string;
  @Index() @Column({ name: "item_number" }) itemNumber!: string;
  @Column({ name: "item_name", type: "varchar", nullable: true }) itemName!: string | null;
  @Column({ name: "order_date", type: "date", nullable: true }) orderDate!: string | null;
  @Column({ name: "review_due_date", type: "date", nullable: true }) reviewDueDate!: string | null;
  @Column({ type: "numeric", precision: 18, scale: 4, nullable: true }) quantity!: string | null;
  @Column({ type: "text", nullable: true }) remark!: string | null;
}

@Entity("finished_goods_inbound")
@Unique(["documentNumber", "inventoryCode", "relationInfo"])
export class FinishedGoodsInbound extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Index() @Column({ name: "sales_order_number", type: "varchar", nullable: true }) salesOrderNumber!: string | null;
  @Column({ name: "document_date", type: "date", nullable: true }) documentDate!: string | null;
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
  @Column({ name: "inventory_name", type: "varchar", nullable: true }) inventoryName!: string | null;
  @Column({ type: "varchar", nullable: true }) specification!: string | null;
  @Column({ type: "varchar", nullable: true }) unit!: string | null;
  @Index() @Column({ name: "relation_info" }) relationInfo!: string;
  @Column({ name: "received_quantity", type: "numeric", precision: 18, scale: 4, nullable: true }) receivedQuantity!: string | null;
  @Column({ name: "unit_price", type: "numeric", precision: 18, scale: 6, nullable: true }) unitPrice!: string | null;
  @Column({ name: "total_amount", type: "numeric", precision: 18, scale: 6, nullable: true }) totalAmount!: string | null;
  @Column({ name: "voucher_word", type: "varchar", nullable: true }) voucherWord!: string | null;
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

@Entity("import_jobs")
export class ImportJob extends AuditedEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "file_name" }) fileName!: string;
  @Column({ name: "file_hash" }) fileHash!: string;
  @Column() status!: string;
  @Column({ type: "jsonb", nullable: true }) summary!: unknown;
  @Column({ name: "preview_payload", type: "jsonb", nullable: true }) previewPayload!: unknown;
  @Column({ name: "created_by", type: "uuid", nullable: true }) createdBy!: string | null;
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
  User, Role, UserRole, Permission, RoleDataScope, RoleOrganizationScope, OrganizationUnit, Contact, PlanPeriod, Order, OrderItem,
  OutsourcingDetail, ProcessDefinitionEntity, ItemProcessProgress, DailyProcessProgress, DictionaryType,
  DictionaryValue, Supplier, SalesOrder, FinishedGoodsInbound, AuditLog, ApiKey,
  RefreshToken, ImportJob, ImportJobError, IdempotencyRecord
];
