import { Injectable } from "@nestjs/common";
import Decimal from "decimal.js";
import { DataSource, EntityManager } from "typeorm";
import type {
  CustomerImportActor, CustomerImportOrderLine, CustomerImportRepository,
  CustomerImportRepositoryResult, NormalizedCustomerImport
} from "./customer-import.types";

type HeaderRow = {
  orderNumber: string; orderDate: string | null; reviewDueDate: string | null; customer: string | null;
  salesperson: string | null; orderAmount: string | null; sourceTotalQuantity: string; sourceActive: boolean;
};

type MonthlyRow = {
  orderNumber: string; itemNumber: string; itemName: string | null; customer: string | null;
  reviewDueDate: string | null; productionQuantity: string; historicalInboundQuantity: string;
  todayInboundQuantity: string; unitPrice: string | null; year: number; month: number;
};

function decimal(value: unknown) { try { return new Decimal(String(value ?? 0)); } catch { return new Decimal(0); } }
function latest(left: string | null, right: string | null) { return !left ? right : !right ? left : left >= right ? left : right; }

@Injectable()
export class LegacyCustomerImportRepository implements CustomerImportRepository {
  constructor(private readonly dataSource: DataSource) {}

  private active(row: CustomerImportOrderLine, source: string) {
    return !row.isCancelled && !row.headerClosed && !row.lineClosed && decimal(row.quantity).greaterThan(0)
      && (source !== "tplus" || Boolean(row.auditedAt));
  }

  private summarize(snapshot: NormalizedCustomerImport) {
    const inboundByDetailItem = new Map<string, Decimal>();
    const todayInboundByDetailItem = new Map<string, Decimal>();
    const today = new Date().toISOString().slice(0, 10);
    for (const movement of snapshot.movements) {
      if (movement.direction !== "INBOUND" || !movement.salesOrderDetailId) continue;
      const key = `${movement.salesOrderDetailId}\u0000${movement.itemNumber}`;
      const quantity = decimal(movement.quantity);
      inboundByDetailItem.set(key, (inboundByDetailItem.get(key) ?? new Decimal(0)).plus(quantity));
      if (movement.documentDate === today) todayInboundByDetailItem.set(key, (todayInboundByDetailItem.get(key) ?? new Decimal(0)).plus(quantity));
    }

    const headers = new Map<string, HeaderRow>();
    const monthly = new Map<string, MonthlyRow>();
    const rawSalesOrders: Record<string, unknown>[] = [];
    const perOrderSequence = new Map<string, number>();
    for (const line of snapshot.orders) {
      const active = this.active(line, snapshot.source);
      const currentHeader = headers.get(line.orderNumber);
      const nextHeader: HeaderRow = currentHeader ?? {
        orderNumber: line.orderNumber, orderDate: line.orderDate, reviewDueDate: null,
        customer: line.customerCode ?? line.customerName, salesperson: line.salesperson,
        orderAmount: line.headerTaxAmount == null ? null : String(line.headerTaxAmount), sourceTotalQuantity: "0", sourceActive: false
      };
      nextHeader.sourceTotalQuantity = decimal(nextHeader.sourceTotalQuantity).plus(decimal(line.quantity)).toFixed(6);
      nextHeader.sourceActive ||= active;
      if (active) nextHeader.reviewDueDate = latest(nextHeader.reviewDueDate, line.deliveryDate);
      headers.set(line.orderNumber, nextHeader);

      const sequenceNumber = (perOrderSequence.get(line.orderNumber) ?? 0) + 1;
      perOrderSequence.set(line.orderNumber, sequenceNumber);
      rawSalesOrders.push({
        sourceSystem: snapshot.sourceSystem, sourceDatabase: snapshot.sourceDatabase, sourceKey: line.sourceDetailId,
        documentDate: line.orderDate, orderDate: line.orderDate, orderNumber: line.orderNumber,
        documentName: snapshot.sourceSystem === "TPLUS" ? "T+销售订单" : "E10销售订单",
        closeStatus: line.lineClosed || line.headerClosed ? "已关闭" : "未关闭", customerCode: line.customerCode,
        shipToCustomerCode: line.customerCode, invoiceCustomerCode: line.customerCode, employeeName: line.salesperson,
        taxIncluded: "含税", currencyCode: "CNY", exchangeRate: "1", sequenceNumber,
        itemNumber: line.itemNumber, itemName: line.itemName, specification: line.specification, unitName: line.unit,
        businessQuantity: String(line.quantity), priceQuantity: String(line.quantity), price: line.taxPrice,
        rmbPrice: line.taxPrice, rmbTaxIncludedAmount: line.taxAmount,
        deliveredBusinessQuantity: line.deliveredQuantity ?? line.saleOutQuantity, plannedDeliveryDate: line.deliveryDate,
        taxRate: null, amountExcludingTaxBc: null, taxBc: null, creatorUserId: null, creatorUserName: line.maker,
        adminUnitName: snapshot.sourceAccountName, ownerDepartment: snapshot.division, ownerEmployee: line.salesperson,
        ownerDivision: snapshot.division, reviewDueDate: line.deliveryDate, quantity: String(line.quantity), remark: line.memo
      });
      if (!active) continue;
      const planDate = line.deliveryDate ?? line.orderDate;
      if (!planDate) continue;
      const year = Number(planDate.slice(0, 4)); const month = Number(planDate.slice(5, 7));
      const key = `${line.orderNumber}\u0000${line.itemNumber}`;
      const current = monthly.get(key) ?? {
        orderNumber: line.orderNumber, itemNumber: line.itemNumber, itemName: line.itemName,
        customer: line.customerCode ?? line.customerName, reviewDueDate: line.deliveryDate,
        productionQuantity: "0", historicalInboundQuantity: "0", todayInboundQuantity: "0",
        unitPrice: line.taxPrice == null ? null : String(line.taxPrice), year, month
      };
      current.productionQuantity = decimal(current.productionQuantity).plus(decimal(line.quantity)).toFixed(4);
      const movementKey = `${line.sourceDetailId}\u0000${line.itemNumber}`;
      current.historicalInboundQuantity = decimal(current.historicalInboundQuantity).plus(inboundByDetailItem.get(movementKey) ?? 0).toFixed(4);
      current.todayInboundQuantity = decimal(current.todayInboundQuantity).plus(todayInboundByDetailItem.get(movementKey) ?? 0).toFixed(4);
      current.reviewDueDate = latest(current.reviewDueDate, line.deliveryDate);
      if (current.reviewDueDate) { current.year = Number(current.reviewDueDate.slice(0, 4)); current.month = Number(current.reviewDueDate.slice(5, 7)); }
      monthly.set(key, current);
    }
    return { headers: [...headers.values()], monthly: [...monthly.values()], rawSalesOrders };
  }

  private async clearDemo(manager: EntityManager) {
    await manager.query(`DELETE FROM daily_process_progress WHERE updated_by='demo-seed'`);
    await manager.query(`DELETE FROM item_process_progress WHERE updated_by='demo-seed'`);
    await manager.query(`DELETE FROM outsourcing_details WHERE updated_by='demo-seed'`);
    await manager.query(`DELETE FROM order_items WHERE updated_by='demo-seed' OR relation_key LIKE 'DEMO-%'`);
    await manager.query(`DELETE FROM orders WHERE source_system='DEMO' OR order_number LIKE 'DEMO-%' OR updated_by='demo-seed'`);
    await manager.query(`DELETE FROM sales_orders WHERE source_system='DEMO' OR order_number LIKE 'DEMO-%' OR updated_by='demo-seed'`);
    await manager.query(`DELETE FROM finished_goods_inbound WHERE source_system='DEMO' OR document_number LIKE 'DEMO-%' OR updated_by='demo-seed'`);
    await manager.query(`DELETE FROM finished_goods_outbound WHERE source_system='DEMO' OR document_number LIKE 'DEMO-%' OR updated_by='demo-seed'`);
    await manager.query(`DELETE FROM suppliers WHERE code='DEMO-SUPPLIER' OR updated_by='demo-seed'`);
    await manager.query(`DELETE FROM import_job_errors WHERE updated_by='demo-seed' OR job_id IN (SELECT id FROM import_jobs WHERE updated_by='demo-seed')`);
    await manager.query(`DELETE FROM import_jobs WHERE updated_by='demo-seed'`);
    await manager.query(`DELETE FROM plan_periods period WHERE updated_by='demo-seed' AND NOT EXISTS (SELECT 1 FROM order_items item WHERE item.period_id=period.id)`);
    await manager.query(`DELETE FROM audit_logs WHERE updated_by='demo-seed' OR request_id LIKE 'demo-seed-%'`);
  }

  private async clearScope(manager: EntityManager, snapshot: NormalizedCustomerImport) {
    const params = [snapshot.sourceSystem, snapshot.sourceDatabase, snapshot.customerCode];
    const customerPredicate = snapshot.scope.mode === "all" ? "TRUE" : "customer=$3";
    await manager.query(`CREATE TEMP TABLE customer_import_orders ON COMMIT DROP AS
      SELECT id,order_number FROM orders WHERE source_system=$1 AND source_database=$2 AND (${customerPredicate})`, snapshot.scope.mode === "all" ? params.slice(0, 2) : params);
    await manager.query(`DELETE FROM daily_process_progress WHERE order_item_id IN (SELECT item.id FROM order_items item JOIN customer_import_orders target ON target.id=item.order_id)`);
    await manager.query(`DELETE FROM item_process_progress WHERE order_item_id IN (SELECT item.id FROM order_items item JOIN customer_import_orders target ON target.id=item.order_id)`);
    await manager.query(`DELETE FROM outsourcing_details WHERE order_item_id IN (SELECT item.id FROM order_items item JOIN customer_import_orders target ON target.id=item.order_id)`);
    await manager.query(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM customer_import_orders)`);
    await manager.query(`DELETE FROM orders WHERE id IN (SELECT id FROM customer_import_orders)`);
    const sourceFilter = snapshot.scope.mode === "all" ? "TRUE" : "customer_code=$3";
    await manager.query(`DELETE FROM sales_orders WHERE source_system=$1 AND source_database=$2 AND (${sourceFilter})`, snapshot.scope.mode === "all" ? params.slice(0, 2) : params);
    const movementFilter = snapshot.scope.mode === "all" ? "TRUE" : "sales_order_number IN (SELECT order_number FROM customer_import_orders)";
    await manager.query(`DELETE FROM finished_goods_inbound WHERE source_system=$1 AND source_database=$2 AND (${movementFilter})`, params.slice(0, 2));
    await manager.query(`DELETE FROM finished_goods_outbound WHERE source_system=$1 AND source_database=$2 AND (${movementFilter})`, params.slice(0, 2));
  }

  async replace(snapshot: NormalizedCustomerImport, actor: CustomerImportActor): Promise<CustomerImportRepositoryResult> {
    const summary = this.summarize(snapshot);
    const inbound = snapshot.movements.filter((row) => row.direction === "INBOUND");
    const outbound = snapshot.movements.filter((row) => row.direction === "OUTBOUND");
    return this.dataSource.transaction(async (manager) => {
      if (snapshot.replaceDemoData) await this.clearDemo(manager);
      await this.clearScope(manager, snapshot);
      await manager.query(`INSERT INTO plan_periods(year,month,status,created_by,updated_by)
        SELECT DISTINCT year,month,'active',$2::uuid,$2::text FROM jsonb_to_recordset($1::jsonb) AS row(year int,month int)
        ON CONFLICT(year,month) DO UPDATE SET status='active',version=plan_periods.version+1,updated_at=now(),updated_by=$2::text`, [JSON.stringify(summary.monthly), actor.userId]);
      await manager.query(`INSERT INTO orders(order_number,order_date,review_due_date,customer,salesperson,order_type,order_amount,
          source_system,source_database,source_account_name,source_total_quantity,source_active,division,created_by,updated_by)
        SELECT row."orderNumber",row."orderDate",row."reviewDueDate",row.customer,row.salesperson,$3,row."orderAmount",
          $4,$5,$6,row."sourceTotalQuantity",row."sourceActive",$7,$2::uuid,$2::text
        FROM jsonb_to_recordset($1::jsonb) AS row("orderNumber" text,"orderDate" date,"reviewDueDate" date,customer text,salesperson text,"orderAmount" numeric,"sourceTotalQuantity" numeric,"sourceActive" boolean)
        ON CONFLICT(source_system,source_database,order_number) WHERE source_system IS NOT NULL AND source_database IS NOT NULL
        DO UPDATE SET order_date=EXCLUDED.order_date,review_due_date=EXCLUDED.review_due_date,customer=EXCLUDED.customer,
          salesperson=EXCLUDED.salesperson,order_amount=EXCLUDED.order_amount,source_total_quantity=EXCLUDED.source_total_quantity,
          source_active=EXCLUDED.source_active,division=EXCLUDED.division,version=orders.version+1,updated_at=now(),updated_by=$2::text`,
      [JSON.stringify(summary.headers), actor.userId, `${snapshot.sourceSystem}销售订单`, snapshot.sourceSystem, snapshot.sourceDatabase, snapshot.sourceAccountName, snapshot.division]);
      await manager.query(`INSERT INTO order_items(order_id,period_id,item_number,relation_key,item_name,review_due_date,customer,division,
          production_quantity,historical_inbound_quantity,today_inbound_quantity,source_month,unit_price,active,created_by,updated_by)
        SELECT orders.id,period.id,row."itemNumber",concat(row."orderNumber",'-',row."itemNumber"),row."itemName",row."reviewDueDate",row.customer,$3,
          row."productionQuantity",row."historicalInboundQuantity",row."todayInboundQuantity",row.month,row."unitPrice",true,$2::uuid,$2::text
        FROM jsonb_to_recordset($1::jsonb) AS row("orderNumber" text,"itemNumber" text,"itemName" text,customer text,"reviewDueDate" date,
          "productionQuantity" numeric,"historicalInboundQuantity" numeric,"todayInboundQuantity" numeric,"unitPrice" numeric,year int,month int)
        JOIN orders ON orders.source_system=$4 AND orders.source_database=$5 AND orders.order_number=row."orderNumber"
        JOIN plan_periods period ON period.year=row.year AND period.month=row.month
        ON CONFLICT(period_id,order_id,item_number) DO UPDATE SET item_name=EXCLUDED.item_name,review_due_date=EXCLUDED.review_due_date,
          customer=EXCLUDED.customer,division=EXCLUDED.division,production_quantity=EXCLUDED.production_quantity,
          historical_inbound_quantity=EXCLUDED.historical_inbound_quantity,today_inbound_quantity=EXCLUDED.today_inbound_quantity,
          unit_price=EXCLUDED.unit_price,active=true,version=order_items.version+1,updated_at=now(),updated_by=$2::text`,
      [JSON.stringify(summary.monthly), actor.userId, snapshot.division, snapshot.sourceSystem, snapshot.sourceDatabase]);
      await manager.query(`INSERT INTO sales_orders(source_system,source_database,source_key,document_date,order_date,order_number,document_name,close_status,
          customer_code,ship_to_customer_code,invoice_customer_code,employee_name,tax_included,currency_code,exchange_rate,sequence_number,item_number,item_name,
          specification,unit_name,business_quantity,price_quantity,price,rmb_price,rmb_tax_included_amount,delivered_business_quantity,planned_delivery_date,
          tax_rate,amount_excluding_tax_bc,tax_bc,creator_user_id,creator_user_name,admin_unit_name,owner_department,owner_employee,owner_division,
          review_due_date,quantity,remark,created_by,updated_by)
        SELECT row."sourceSystem",row."sourceDatabase",row."sourceKey",row."documentDate",row."orderDate",row."orderNumber",row."documentName",row."closeStatus",
          row."customerCode",row."shipToCustomerCode",row."invoiceCustomerCode",row."employeeName",row."taxIncluded",row."currencyCode",row."exchangeRate",row."sequenceNumber",
          row."itemNumber",row."itemName",row.specification,row."unitName",row."businessQuantity",row."priceQuantity",row.price,row."rmbPrice",row."rmbTaxIncludedAmount",
          row."deliveredBusinessQuantity",row."plannedDeliveryDate",row."taxRate",row."amountExcludingTaxBc",row."taxBc",row."creatorUserId",row."creatorUserName",
          row."adminUnitName",row."ownerDepartment",row."ownerEmployee",row."ownerDivision",row."reviewDueDate",row.quantity,row.remark,$2::uuid,$2::text
        FROM jsonb_to_recordset($1::jsonb) AS row("sourceSystem" text,"sourceDatabase" text,"sourceKey" text,"documentDate" date,"orderDate" date,"orderNumber" text,
          "documentName" text,"closeStatus" text,"customerCode" text,"shipToCustomerCode" text,"invoiceCustomerCode" text,"employeeName" text,"taxIncluded" text,
          "currencyCode" text,"exchangeRate" numeric,"sequenceNumber" int,"itemNumber" text,"itemName" text,specification text,"unitName" text,"businessQuantity" numeric,
          "priceQuantity" numeric,price numeric,"rmbPrice" numeric,"rmbTaxIncludedAmount" numeric,"deliveredBusinessQuantity" numeric,"plannedDeliveryDate" date,
          "taxRate" numeric,"amountExcludingTaxBc" numeric,"taxBc" numeric,"creatorUserId" text,"creatorUserName" text,"adminUnitName" text,"ownerDepartment" text,
          "ownerEmployee" text,"ownerDivision" text,"reviewDueDate" date,quantity numeric,remark text)`, [JSON.stringify(summary.rawSalesOrders), actor.userId]);
      await manager.query(`INSERT INTO finished_goods_inbound(source_system,source_database,source_key,category_number,sales_order_number,document_full_name,
          document_date,inbound_date,line_number,work_order_number,document_number,business_type,warehouse_code,warehouse,inbound_category,remark,creator,auditor,
          inventory_code,inventory_name,specification,unit,relation_info,received_quantity,unit_price,total_amount,voucher_word,category,created_by,updated_by)
        SELECT $3::text,$4::text,row."sourceDetailId",$3::text,row."salesOrderNumber",concat($3::text,' 入库单'),row."documentDate",row."documentDate",row."lineNumber",row."sourceDocumentNumber",
          row."documentNumber",row."businessType",row."warehouseCode",row."warehouseName",'方向值 '||row."directionValue",row.memo,row.maker,row.auditor,row."itemNumber",
          row."itemName",row.specification,row.unit,concat($4::text,'|',row."sourceDetailId"),row.quantity,row."unitPrice",row.amount,row."voucherType",concat($3::text,'入库'),$2::uuid,$2::text
        FROM jsonb_to_recordset($1::jsonb) AS row("sourceDetailId" text,"documentNumber" text,"documentDate" date,"businessType" text,"warehouseCode" text,
          "warehouseName" text,"directionValue" int,"salesOrderNumber" text,"sourceDocumentNumber" text,memo text,maker text,auditor text,"itemNumber" text,"itemName" text,
          specification text,unit text,quantity numeric,"unitPrice" numeric,amount numeric,"voucherType" text,"lineNumber" int)`,
      [JSON.stringify(inbound.map((row, index) => ({ ...row, lineNumber: index + 1 }))), actor.userId, snapshot.sourceSystem, snapshot.sourceDatabase]);
      await manager.query(`INSERT INTO finished_goods_outbound(source_system,source_database,source_key,document_date,document_number,document_status,direction_value,
          voucher_type,business_type,customer_code,customer_name,sales_order_number,item_number,item_name,specification,quantity,unit,unit_price,total_amount,
          warehouse_code,warehouse,source_document_number,creator,auditor,remark,created_by,updated_by)
        SELECT $3::text,$4::text,row."sourceDetailId",row."documentDate",row."documentNumber",row."voucherState",row."directionValue",row."voucherType",row."businessType",
          row."partnerCode",row."partnerName",row."salesOrderNumber",row."itemNumber",row."itemName",row.specification,row.quantity,row.unit,row."unitPrice",row.amount,
          row."warehouseCode",row."warehouseName",row."sourceDocumentNumber",row.maker,row.auditor,row.memo,$2::uuid,$2::text
        FROM jsonb_to_recordset($1::jsonb) AS row("sourceDetailId" text,"documentDate" date,"documentNumber" text,"voucherState" text,"directionValue" int,
          "voucherType" text,"businessType" text,"partnerCode" text,"partnerName" text,"salesOrderNumber" text,"itemNumber" text,"itemName" text,specification text,
          quantity numeric,unit text,"unitPrice" numeric,amount numeric,"warehouseCode" text,"warehouseName" text,"sourceDocumentNumber" text,maker text,auditor text,memo text)`,
      [JSON.stringify(outbound), actor.userId, snapshot.sourceSystem, snapshot.sourceDatabase]);
      const result = { orders: summary.headers.length, activePlanItems: summary.monthly.length, salesOrderLines: summary.rawSalesOrders.length,
        inboundRows: inbound.length, outboundRows: outbound.length, demoDataCleared: Boolean(snapshot.replaceDemoData) };
      await manager.query(`INSERT INTO audit_logs(actor_id,actor_name,resource,action,after_json,request_id,source,created_by,updated_by)
        VALUES($1::uuid,$2,'customer-data-import','replace-snapshot',$3,$4,$5,$1::uuid,$1::text)`, [actor.userId, actor.displayName, JSON.stringify({ ...result, source: snapshot.sourceSystem, sourceDatabase: snapshot.sourceDatabase, scope: snapshot.scope }), actor.requestId, actor.source.toLowerCase()]);
      return result;
    });
  }
}
