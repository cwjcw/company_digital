import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { KdosDatabaseClient } from "@kdos/database";
import Decimal from "decimal.js";
import type { PoolClient } from "pg";
import { KDOS_DATABASE } from "../../modules/planning/drizzle-planning.repository";
import type {
  CustomerImportActor, CustomerImportOrderLine, CustomerImportRepository,
  CustomerImportRepositoryResult, NormalizedCustomerImport
} from "./customer-import.types";

type KdosHeader = {
  orderNumber: string; customerCode: string | null; customerName: string | null; orderDate: string | null;
  sourceKey: string; enabled: boolean;
};
type KdosLine = {
  orderNumber: string; itemNumber: string; itemName: string | null; specification: string | null;
  orderQuantity: string; deliveryDate: string | null; sourcePayload: Record<string, unknown>;
  customerCode: string | null; customerName: string | null; productionQuantity: string;
  historicalInboundQuantity: string; currentInboundQuantity: string; unitPrice: string;
  completedQuantity: string; year: number; month: number;
};

function decimal(value: unknown) { try { return new Decimal(String(value ?? 0)); } catch { return new Decimal(0); } }
function latest(left: string | null, right: string | null) { return !left ? right : !right ? left : left >= right ? left : right; }

@Injectable()
export class KdosCustomerImportRepository implements CustomerImportRepository {
  constructor(@Inject(KDOS_DATABASE) private readonly database: KdosDatabaseClient) {}

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
      inboundByDetailItem.set(key, (inboundByDetailItem.get(key) ?? new Decimal(0)).plus(decimal(movement.quantity)));
      if (movement.documentDate === today) todayInboundByDetailItem.set(key, (todayInboundByDetailItem.get(key) ?? new Decimal(0)).plus(decimal(movement.quantity)));
    }
    const headers = new Map<string, KdosHeader>();
    const lines = new Map<string, KdosLine & { detailIds: string[]; delivered: Decimal }>();
    for (const row of snapshot.orders) {
      const isActive = this.active(row, snapshot.source);
      const header = headers.get(row.orderNumber) ?? {
        orderNumber: row.orderNumber, customerCode: row.customerCode, customerName: row.customerName,
        orderDate: row.orderDate, sourceKey: `${snapshot.sourceDatabase}:${row.sourceOrderId}`, enabled: false
      };
      header.enabled ||= isActive; headers.set(row.orderNumber, header);
      if (!isActive) continue;
      const key = `${row.orderNumber}\u0000${row.itemNumber}`;
      const planDate = row.deliveryDate ?? row.orderDate;
      if (!planDate) continue;
      const current = lines.get(key) ?? {
        orderNumber: row.orderNumber, itemNumber: row.itemNumber, itemName: row.itemName, specification: row.specification,
        orderQuantity: "0", deliveryDate: row.deliveryDate, sourcePayload: {}, customerCode: row.customerCode, customerName: row.customerName,
        productionQuantity: "0", historicalInboundQuantity: "0", currentInboundQuantity: "0", unitPrice: String(row.taxPrice ?? 0),
        completedQuantity: "0", year: Number(planDate.slice(0, 4)), month: Number(planDate.slice(5, 7)), detailIds: [], delivered: new Decimal(0)
      };
      current.orderQuantity = decimal(current.orderQuantity).plus(decimal(row.quantity)).toFixed(4);
      current.productionQuantity = current.orderQuantity;
      current.delivered = current.delivered.plus(decimal(row.saleOutQuantity ?? row.deliveredQuantity));
      current.completedQuantity = current.delivered.toFixed(4);
      const movementKey = `${row.sourceDetailId}\u0000${row.itemNumber}`;
      current.historicalInboundQuantity = decimal(current.historicalInboundQuantity).plus(inboundByDetailItem.get(movementKey) ?? 0).toFixed(4);
      current.currentInboundQuantity = decimal(current.currentInboundQuantity).plus(todayInboundByDetailItem.get(movementKey) ?? 0).toFixed(4);
      current.deliveryDate = latest(current.deliveryDate, row.deliveryDate);
      if (current.deliveryDate) { current.year = Number(current.deliveryDate.slice(0, 4)); current.month = Number(current.deliveryDate.slice(5, 7)); }
      current.detailIds.push(row.sourceDetailId);
      current.sourcePayload = { source: snapshot.sourceSystem, sourceDatabase: snapshot.sourceDatabase, sourceDetailIds: current.detailIds,
        unit: row.unit, salesperson: row.salesperson, voucherState: row.voucherState, executedQuantity: row.executedQuantity,
        manufactureQuantity: row.manufactureQuantity, completedQuantity: current.completedQuantity };
      lines.set(key, current);
    }
    return { headers: [...headers.values()], lines: [...lines.values()].map(({ detailIds, delivered, ...row }, index) => {
      void detailIds; void delivered;
      return { ...row, lineNumber: index + 1 };
    }) };
  }

  private async tenantId(client: PoolClient) {
    const result = await client.query("SELECT id FROM iam.tenants WHERE code='KAINAN' AND enabled=true");
    if (!result.rowCount) throw new NotFoundException("租户 KAINAN 不存在或已停用");
    return String(result.rows[0].id);
  }

  private async clearDemo(client: PoolClient, tenantId: string) {
    await client.query(`DELETE FROM planning.weekly_plan_items WHERE tenant_id=$1 AND order_number LIKE 'DEMO-%'`, [tenantId]);
    await client.query(`DELETE FROM planning.work_reports WHERE tenant_id=$1 AND order_number LIKE 'DEMO-%'`, [tenantId]);
    await client.query(`DELETE FROM marketing.order_schedules WHERE tenant_id=$1 AND order_number LIKE 'DEMO-%'`, [tenantId]);
    await client.query(`DELETE FROM marketing.business_customer_mappings WHERE tenant_id=$1 AND (customer_code LIKE 'DEMO-%' OR department LIKE '演示%')`, [tenantId]);
    await client.query(`DELETE FROM planning.process_progress WHERE tenant_id=$1 AND plan_item_id IN (SELECT id FROM planning.plan_items WHERE tenant_id=$1 AND (legacy_data->>'demo'='true' OR order_number LIKE 'DEMO-%'))`, [tenantId]);
    await client.query(`DELETE FROM planning.plan_items WHERE tenant_id=$1 AND (legacy_data->>'demo'='true' OR order_number LIKE 'DEMO-%')`, [tenantId]);
    await client.query(`DELETE FROM planning.sales_order_lines WHERE tenant_id=$1 AND (source_payload->>'demo'='true' OR sales_order_id IN (SELECT id FROM planning.sales_orders WHERE tenant_id=$1 AND (source_system='DEMO' OR order_number LIKE 'DEMO-%')))`, [tenantId]);
    await client.query(`DELETE FROM planning.sales_orders WHERE tenant_id=$1 AND (source_system='DEMO' OR order_number LIKE 'DEMO-%')`, [tenantId]);
    await client.query(`UPDATE planning.plan_periods period SET current_version_id=NULL,updated_at=now()
      WHERE period.tenant_id=$1 AND period.current_version_id IN (
        SELECT version.id FROM planning.plan_versions version WHERE version.tenant_id=$1 AND version.name LIKE '%演示%'
      )`, [tenantId]);
    await client.query(`DELETE FROM planning.plan_snapshots snapshot USING planning.plan_versions version WHERE snapshot.tenant_id=$1 AND snapshot.version_id=version.id AND version.tenant_id=$1 AND version.name LIKE '%演示%'`, [tenantId]);
    await client.query(`DELETE FROM planning.plan_changes change USING planning.plan_versions version WHERE change.tenant_id=$1 AND change.version_id=version.id AND version.tenant_id=$1 AND (change.after->>'demo'='true' OR version.name LIKE '%演示%')`, [tenantId]);
    await client.query(`DELETE FROM planning.plan_versions version WHERE version.tenant_id=$1 AND version.name LIKE '%演示%' AND NOT EXISTS (SELECT 1 FROM planning.plan_items item WHERE item.plan_version_id=version.id)`, [tenantId]);
    await client.query(`DELETE FROM planning.plan_periods period WHERE period.tenant_id=$1 AND NOT EXISTS (SELECT 1 FROM planning.plan_versions version WHERE version.period_id=period.id)`, [tenantId]);
    await client.query(`DELETE FROM audit.audit_logs WHERE tenant_id=$1 AND (request_id LIKE 'demo-seed-%' OR resource_type='DemoDataSet')`, [tenantId]);
    await client.query(`DELETE FROM integration.import_jobs WHERE tenant_id=$1 AND (idempotency_key LIKE 'DEMO:%' OR file_name LIKE '%演示%')`, [tenantId]);
  }

  private async clearScope(client: PoolClient, tenantId: string, snapshot: NormalizedCustomerImport) {
    const customerPredicate = snapshot.scope.mode === "all" ? "TRUE" : "customer_code=$4";
    const params = [tenantId, snapshot.sourceSystem, snapshot.sourceDatabase, snapshot.customerCode];
    await client.query(`CREATE TEMP TABLE customer_import_kdos_orders ON COMMIT DROP AS
      SELECT id,order_number FROM planning.sales_orders
      WHERE tenant_id=$1 AND source_system=$2 AND source_key LIKE $3||':%' AND (${customerPredicate})`,
    snapshot.scope.mode === "all" ? params.slice(0, 3) : params);
    await client.query(`DELETE FROM planning.plan_items item WHERE item.tenant_id=$1 AND item.sales_order_line_id IN
      (SELECT line.id FROM planning.sales_order_lines line JOIN customer_import_kdos_orders target ON target.id=line.sales_order_id)`, [tenantId]);
    await client.query(`DELETE FROM planning.sales_order_lines line WHERE line.tenant_id=$1 AND line.sales_order_id IN (SELECT id FROM customer_import_kdos_orders)`, [tenantId]);
    await client.query(`DELETE FROM planning.sales_orders WHERE tenant_id=$1 AND id IN (SELECT id FROM customer_import_kdos_orders)`, [tenantId]);
  }

  private async ensureProcessProgress(client: PoolClient, tenantId: string, snapshot: NormalizedCustomerImport, actor: CustomerImportActor) {
    const result = await client.query(`INSERT INTO planning.process_progress
      (tenant_id,plan_item_id,process_definition_id,created_by,updated_by)
      SELECT $1::uuid,item.id,definition.id,$5::uuid,$5::uuid
      FROM planning.plan_items item
      CROSS JOIN planning.process_definitions definition
      WHERE item.tenant_id=$1::uuid AND definition.tenant_id=$1::uuid AND definition.enabled=true
        AND item.legacy_data->>'source'=$2::text AND item.legacy_data->>'sourceDatabase'=$3::text
        AND ($4::text IS NULL OR item.customer_code=$4::text)
      ON CONFLICT(plan_item_id,process_definition_id) DO NOTHING
      RETURNING id`, [tenantId, snapshot.sourceSystem, snapshot.sourceDatabase, snapshot.customerCode, actor.userId]);
    const initialized = result.rowCount ?? 0;
    if (initialized) await client.query(`INSERT INTO audit.audit_logs
      (tenant_id,user_id,action,resource_type,after,reason,source,request_id,created_by,updated_by)
      VALUES($1::uuid,$2::uuid,'integration.customer_process_links.initialized','ProcessProgress',$3,$4,$5,$6,$2::uuid,$2::uuid)`, [
      tenantId, actor.userId, JSON.stringify({ initialized, source: snapshot.sourceSystem, sourceDatabase: snapshot.sourceDatabase, scope: snapshot.scope }),
      "根据主计划初始化工序关联空记录，不填造业务进度", actor.source, actor.requestId
    ]);
    return initialized;
  }

  async replace(snapshot: NormalizedCustomerImport, actor: CustomerImportActor): Promise<CustomerImportRepositoryResult> {
    const summarized = this.summarize(snapshot);
    const client = await this.database.pool.connect();
    let stage = "begin";
    try {
      await client.query("BEGIN");
      stage = "resolve-tenant";
      const tenantId = await this.tenantId(client);
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
      const previous = await client.query(`SELECT status,result FROM integration.import_jobs WHERE tenant_id=$1 AND idempotency_key=$2 FOR UPDATE`, [tenantId, snapshot.idempotencyKey]);
      if (previous.rowCount && previous.rows[0].status === "CONFIRMED") {
        const processProgressRows = await this.ensureProcessProgress(client, tenantId, snapshot, actor);
        await client.query("COMMIT");
        return { ...(previous.rows[0].result ?? {}), processProgressRows, repeated: true };
      }
      if (previous.rowCount) await client.query(`UPDATE integration.import_jobs SET status='RUNNING',error=NULL,updated_at=now(),updated_by=$3::uuid,version=version+1 WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantId, snapshot.idempotencyKey, actor.userId]);
      else await client.query(`INSERT INTO integration.import_jobs(tenant_id,type,idempotency_key,file_name,status,preview,created_by,updated_by)
        VALUES($1::uuid,'CUSTOMER_DATA_SNAPSHOT',$2,$3,'RUNNING',$4,$5::uuid,$5::uuid)`, [tenantId, snapshot.idempotencyKey, `${snapshot.sourceSystem}:${snapshot.sourceDatabase}:${snapshot.customerCode ?? 'ALL'}`, JSON.stringify({ orders: snapshot.orders.length, movements: snapshot.movements.length }), actor.userId]);
      if (snapshot.replaceDemoData) await this.clearDemo(client, tenantId);
      await this.clearScope(client, tenantId, snapshot);

      stage = "sales-orders";
      await client.query(`INSERT INTO planning.sales_orders(tenant_id,order_number,customer_code,customer_name,order_date,source_system,source_key,source_updated_at,enabled,created_by,updated_by)
        SELECT $1::uuid,row."orderNumber",row."customerCode",row."customerName",row."orderDate",$4,row."sourceKey",$5,row.enabled,$2::uuid,$2::uuid
        FROM jsonb_to_recordset($3::jsonb) AS row("orderNumber" text,"customerCode" text,"customerName" text,"orderDate" date,"sourceKey" text,enabled boolean)
        ON CONFLICT(tenant_id,order_number) DO UPDATE SET customer_code=EXCLUDED.customer_code,customer_name=EXCLUDED.customer_name,order_date=EXCLUDED.order_date,
          source_system=EXCLUDED.source_system,source_key=EXCLUDED.source_key,source_updated_at=EXCLUDED.source_updated_at,enabled=EXCLUDED.enabled,
          version=planning.sales_orders.version+1,updated_at=now(),updated_by=$2::uuid`,
      [tenantId, actor.userId, JSON.stringify(summarized.headers), snapshot.sourceSystem, snapshot.extractedAt]);
      stage = "sales-order-lines";
      await client.query(`INSERT INTO planning.sales_order_lines(tenant_id,sales_order_id,line_number,item_number,item_name,specification,order_quantity,delivery_date,source_payload,created_by,updated_by)
        SELECT $1::uuid,orders.id,row."lineNumber",row."itemNumber",row."itemName",row.specification,row."orderQuantity",row."deliveryDate",row."sourcePayload",$2::uuid,$2::uuid
        FROM jsonb_to_recordset($3::jsonb) AS row("orderNumber" text,"itemNumber" text,"itemName" text,specification text,"orderQuantity" numeric,
          "deliveryDate" date,"sourcePayload" jsonb,"customerCode" text,"customerName" text,"productionQuantity" numeric,"historicalInboundQuantity" numeric,
          "currentInboundQuantity" numeric,"unitPrice" numeric,"completedQuantity" numeric,year int,month int,"lineNumber" int)
        JOIN planning.sales_orders orders ON orders.tenant_id=$1 AND orders.order_number=row."orderNumber"
        ON CONFLICT(sales_order_id,item_number) DO UPDATE SET item_name=EXCLUDED.item_name,specification=EXCLUDED.specification,
          order_quantity=EXCLUDED.order_quantity,delivery_date=EXCLUDED.delivery_date,source_payload=EXCLUDED.source_payload,
          version=planning.sales_order_lines.version+1,updated_at=now(),updated_by=$2::uuid`, [tenantId, actor.userId, JSON.stringify(summarized.lines)]);
      stage = "plan-periods";
      await client.query(`INSERT INTO planning.plan_periods(tenant_id,year,month,status,created_by,updated_by)
        SELECT DISTINCT $1::uuid,row.year,row.month,'OPEN',$2::uuid,$2::uuid FROM jsonb_to_recordset($3::jsonb) AS row(year int,month int)
        ON CONFLICT(tenant_id,year,month) DO UPDATE SET updated_at=now(),updated_by=$2::uuid`, [tenantId, actor.userId, JSON.stringify(summarized.lines)]);
      stage = "plan-versions";
      await client.query(`INSERT INTO planning.plan_versions(tenant_id,period_id,version_number,name,status,created_by,updated_by)
        SELECT $1::uuid,period.id,COALESCE((SELECT max(existing.version_number)+1 FROM planning.plan_versions existing WHERE existing.period_id=period.id),1),
          concat(period.year,'年',period.month,'月客户数据导入草稿'),'DRAFT',$2::uuid,$2::uuid
        FROM planning.plan_periods period
        WHERE period.tenant_id=$1 AND (period.year,period.month) IN (SELECT DISTINCT year,month FROM jsonb_to_recordset($3::jsonb) AS row(year int,month int))
          AND NOT EXISTS (SELECT 1 FROM planning.plan_versions draft WHERE draft.period_id=period.id AND draft.status='DRAFT')`,
      [tenantId, actor.userId, JSON.stringify(summarized.lines)]);
      stage = "plan-items";
      await client.query(`INSERT INTO planning.plan_items(tenant_id,plan_version_id,sales_order_line_id,order_number,item_number,customer_code,customer_name,item_name,
          specification,order_quantity,production_quantity,historical_inbound_quantity,current_inbound_quantity,unit_price,delivery_date,priority,sequence,status,
          remark,image_refs,legacy_data,created_by,updated_by)
        SELECT $1::uuid,version.id,line.id,row."orderNumber",row."itemNumber",row."customerCode",row."customerName",row."itemName",row.specification,row."orderQuantity",
          row."productionQuantity",row."historicalInboundQuantity",row."currentInboundQuantity",row."unitPrice",row."deliveryDate",50,row."lineNumber",
          CASE WHEN row."orderQuantity"<>0 AND row."completedQuantity">=row."orderQuantity" THEN 'COMPLETED' ELSE 'PENDING' END,NULL,'[]'::jsonb,
          jsonb_build_object('source',$4::text,'sourceDatabase',$5::text,'sourceAccountName',$6::text,'division',$7::text,'completedQuantity',row."completedQuantity",
            'orderDate',orders.order_date,'reviewDueDate',row."deliveryDate"),$2::uuid,$2::uuid
        FROM jsonb_to_recordset($3::jsonb) AS row("orderNumber" text,"itemNumber" text,"itemName" text,specification text,"orderQuantity" numeric,
          "deliveryDate" date,"sourcePayload" jsonb,"customerCode" text,"customerName" text,"productionQuantity" numeric,"historicalInboundQuantity" numeric,
          "currentInboundQuantity" numeric,"unitPrice" numeric,"completedQuantity" numeric,year int,month int,"lineNumber" int)
        JOIN planning.plan_periods period ON period.tenant_id=$1 AND period.year=row.year AND period.month=row.month
        JOIN planning.plan_versions version ON version.period_id=period.id AND version.status='DRAFT'
        JOIN planning.sales_orders orders ON orders.tenant_id=$1 AND orders.order_number=row."orderNumber"
        JOIN planning.sales_order_lines line ON line.sales_order_id=orders.id AND line.item_number=row."itemNumber"
        ON CONFLICT(plan_version_id,order_number,item_number) DO UPDATE SET sales_order_line_id=EXCLUDED.sales_order_line_id,customer_code=EXCLUDED.customer_code,
          customer_name=EXCLUDED.customer_name,item_name=EXCLUDED.item_name,specification=EXCLUDED.specification,order_quantity=EXCLUDED.order_quantity,
          production_quantity=EXCLUDED.production_quantity,historical_inbound_quantity=EXCLUDED.historical_inbound_quantity,
          current_inbound_quantity=EXCLUDED.current_inbound_quantity,unit_price=EXCLUDED.unit_price,delivery_date=EXCLUDED.delivery_date,status=EXCLUDED.status,
          legacy_data=EXCLUDED.legacy_data,version=planning.plan_items.version+1,updated_at=now(),updated_by=$2::uuid`,
      [tenantId, actor.userId, JSON.stringify(summarized.lines), snapshot.sourceSystem, snapshot.sourceDatabase, snapshot.sourceAccountName, snapshot.division]);

      stage = "process-progress";
      const processProgressRows = await this.ensureProcessProgress(client, tenantId, snapshot, actor);

      await client.query(`DELETE FROM marketing.order_schedules schedule WHERE schedule.tenant_id=$1 AND schedule.customer_code=$2
        AND schedule.source_plan_item_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM planning.plan_items item WHERE item.id=schedule.source_plan_item_id AND item.tenant_id=$1
        )`, [tenantId, snapshot.customerCode]);
      stage = "order-schedules";
      const schedules = await client.query(`WITH selected AS (
          SELECT DISTINCT ON(item.order_number,item.item_number) item.* FROM planning.plan_items item
          WHERE item.tenant_id=$1 AND item.order_number IN (SELECT "orderNumber" FROM jsonb_to_recordset($3::jsonb) AS row("orderNumber" text))
          ORDER BY item.order_number,item.item_number,item.updated_at DESC
        )
        INSERT INTO marketing.order_schedules(tenant_id,customer_code,order_number,item_number,item_name,order_total_quantity,production_unit,completion_ratio,
          source_plan_item_id,last_synced_at,created_by,updated_by)
        SELECT $1::uuid,COALESCE(item.customer_code,''),item.order_number,item.item_number,COALESCE(item.item_name,''),item.order_quantity,$4,
          CASE WHEN item.order_quantity=0 THEN 0 ELSE LEAST(100,ROUND((COALESCE((item.legacy_data->>'completedQuantity')::numeric,0)/item.order_quantity*100)::numeric,4)) END,
          item.id,now(),$2::uuid,$2::uuid FROM selected item
        ON CONFLICT(tenant_id,order_number,item_number) DO UPDATE SET customer_code=EXCLUDED.customer_code,item_name=EXCLUDED.item_name,
          order_total_quantity=EXCLUDED.order_total_quantity,production_unit=EXCLUDED.production_unit,completion_ratio=EXCLUDED.completion_ratio,
          source_plan_item_id=EXCLUDED.source_plan_item_id,last_synced_at=now(),version=marketing.order_schedules.version+1,updated_at=now(),updated_by=$2::uuid
        RETURNING id`, [tenantId, actor.userId, JSON.stringify(summarized.lines), snapshot.division ?? snapshot.sourceAccountName]);

      const result = { salesOrders: summarized.headers.length, salesOrderLines: summarized.lines.length, planItems: summarized.lines.length,
        processProgressRows, orderSchedules: schedules.rowCount ?? 0, weeklyPlanItems: 0, workReports: 0,
        demoDataCleared: Boolean(snapshot.replaceDemoData), repeated: false };
      await client.query(`UPDATE integration.import_jobs SET status='CONFIRMED',result=$3,confirmed_at=now(),updated_at=now(),updated_by=$4::uuid,version=version+1
        WHERE tenant_id=$1 AND idempotency_key=$2`, [tenantId, snapshot.idempotencyKey, JSON.stringify(result), actor.userId]);
      await client.query(`INSERT INTO audit.audit_logs(tenant_id,user_id,action,resource_type,after,reason,source,request_id,created_by,updated_by)
        VALUES($1::uuid,$2::uuid,'integration.customer_snapshot.imported','CustomerDataSnapshot',$3,$4,$5,$6,$2::uuid,$2::uuid)`, [tenantId, actor.userId,
        JSON.stringify({ ...result, source: snapshot.sourceSystem, sourceDatabase: snapshot.sourceDatabase, scope: snapshot.scope }),
        "从外部系统导入客户订单及关联出入库数据", actor.source, actor.requestId]);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${stage}: ${message}`);
    } finally { client.release(); }
  }
}
