import { Injectable, type OnModuleInit } from "@nestjs/common";
import { tablePermissionFieldsFor, type TableResourceCode } from "@kdos/contracts";
import { TableFilterRegistry } from "../../common/filtering/table-filter.registry";

/**
 * KN-FILTER-001 数据中心筛选数据源：三张 ERP 镜像表（订单/成品入库/成品出库）。
 * 这些表没有 `tenant_id` 列，租户边界由资源权限与数据范围承担，因此显式声明 `tenantColumn: null`，
 * 平台不得伪造租户条件；行级范围与现有列表一致（只有资源级读权限，无行级过滤）。
 */
const dataCenterSources: Array<{ code: TableResourceCode; table: string; columns: Record<string, string> }> = [
  {
    code: "sales-orders",
    table: "sales_orders",
    columns: {
      sourceSystem: "source_system", sourceDatabase: "source_database", sourceKey: "source_key",
      documentDate: "document_date", orderDate: "order_date", orderNumber: "order_number",
      documentName: "document_name", closeStatus: "close_status", customerCode: "customer_code",
      shipToCustomerCode: "ship_to_customer_code", invoiceCustomerCode: "invoice_customer_code", employeeName: "employee_name",
      taxIncluded: "tax_included", currencyCode: "currency_code", exchangeRate: "exchange_rate",
      sequenceNumber: "sequence_number", itemNumber: "item_number", itemName: "item_name", specification: "specification",
      unitName: "unit_name", businessQuantity: "business_quantity", priceQuantity: "price_quantity", price: "price",
      rmbPrice: "rmb_price", rmbTaxIncludedAmount: "rmb_tax_included_amount", deliveredBusinessQuantity: "delivered_business_quantity",
      plannedDeliveryDate: "planned_delivery_date", taxRate: "tax_rate", amountExcludingTaxBc: "amount_excluding_tax_bc",
      taxBc: "tax_bc", creatorUserId: "creator_user_id", creatorUserName: "creator_user_name", adminUnitName: "admin_unit_name",
      ownerDepartment: "owner_department", ownerEmployee: "owner_employee", ownerDivision: "owner_division",
      reviewDueDate: "review_due_date", quantity: "quantity", remark: "remark",
      createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
    }
  },
  {
    code: "finished-goods-inbound",
    table: "finished_goods_inbound",
    columns: {
      sourceSystem: "source_system", sourceDatabase: "source_database", sourceKey: "source_key",
      categoryNumber: "category_number", documentNumber: "document_number", documentFullName: "document_full_name",
      documentDate: "document_date", inboundDate: "inbound_date", lineNumber: "line_number",
      workOrderNumber: "work_order_number", salesOrderNumber: "sales_order_number", inventoryCode: "inventory_code",
      quickCode: "quick_code", inventoryName: "inventory_name", specification: "specification", unit: "unit",
      receivedQuantity: "received_quantity", warehouseCode: "warehouse_code", warehouse: "warehouse",
      inboundCategory: "inbound_category", workshopCode: "workshop_code", workshop: "workshop",
      handlerCode: "handler_code", handler: "handler", businessType: "business_type", voucherWord: "voucher_word",
      category: "category", creator: "creator", auditor: "auditor", relationInfo: "relation_info",
      unitPrice: "unit_price", totalAmount: "total_amount", remark: "remark",
      createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
    }
  },
  {
    code: "finished-goods-outbound",
    table: "finished_goods_outbound",
    columns: {
      sourceSystem: "source_system", sourceDatabase: "source_database", sourceKey: "source_key",
      documentDate: "document_date", documentNumber: "document_number", documentStatus: "document_status",
      directionValue: "direction_value", voucherType: "voucher_type", businessType: "business_type",
      customerCode: "customer_code", customerName: "customer_name", salesOrderNumber: "sales_order_number",
      itemNumber: "item_number", itemName: "item_name", specification: "specification", quantity: "quantity",
      unit: "unit", unitPrice: "unit_price", totalAmount: "total_amount",
      warehouseCode: "warehouse_code", warehouse: "warehouse", sourceDocumentNumber: "source_document_number",
      creator: "creator", auditor: "auditor", remark: "remark",
      createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
    }
  }
];

@Injectable()
export class MasterDataFilterSourceProvider implements OnModuleInit {
  constructor(private readonly registry: TableFilterRegistry) {}

  onModuleInit() {
    for (const source of dataCenterSources) {
      const columns = source.columns;
      this.registry.register({
        code: source.code,
        table: source.table,
        columns,
        tenantColumn: null,
        fields: tablePermissionFieldsFor(source.code),
        buildScope: () => "1=1"
      });
    }
  }
}
