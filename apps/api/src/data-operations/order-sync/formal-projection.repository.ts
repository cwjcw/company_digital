import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import type { ProjectionRecord, SyncActor } from "./order-sync.types";

const tenant = () => process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN";
const supportedConsumers = new Set(["sales-orders-v1", "finished-goods-inbound-v1", "finished-goods-outbound-v1"]);

@Injectable()
export class FormalProjectionRepository {
  constructor(private readonly dataSource: DataSource) {}

  private async scope(manager: EntityManager) {
    await manager.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenant()]);
  }

  async initialize(actor: SyncActor) {
    return this.dataSource.transaction(async (manager) => {
      await this.scope(manager);
      const inserted = await manager.query(`WITH inserted AS (
        INSERT INTO erp_change_events(tenant_id,raw_record_id,source_system,source_database,source_table,source_id,record_type,
          operation,record_version,content_hash,source_modified_at,created_at)
        SELECT tenant_id,id,source_system,source_database,source_table,source_id,record_type,'UPSERT',version,content_hash,modified_at,
          clock_timestamp()
        FROM erp_staging_raw_records
        WHERE tenant_id=$1 AND record_type=ANY($2::varchar[])
        ON CONFLICT(tenant_id,raw_record_id,record_version) DO NOTHING
        RETURNING record_type
      ) SELECT record_type,count(*)::integer count FROM inserted GROUP BY record_type ORDER BY record_type`, [tenant(),
        ["ORDER_HEADER", "ORDER_LINE", "DELIVERY_PLAN", "INBOUND_LINE", "OUTBOUND_LINE"]]);
      await manager.query(`UPDATE erp_projection_consumers SET enabled=true,status='IDLE',last_event_created_at=NULL,last_event_id=NULL,
        lease_token=NULL,lease_expires_at=NULL,in_flight_event_created_at=NULL,in_flight_event_id=NULL,retry_count=0,next_retry_at=NULL,
        last_error=NULL,updated_by=$2,updated_at=now(),version=version+1
        WHERE tenant_id=$1 AND consumer_key=ANY($3::varchar[])`, [tenant(), actor.displayName, [...supportedConsumers]]);
      const totals = await manager.query(`SELECT record_type,count(*)::integer count FROM erp_change_events
        WHERE tenant_id=$1 AND record_type=ANY($2::varchar[]) GROUP BY record_type ORDER BY record_type`, [tenant(),
        ["ORDER_HEADER", "ORDER_LINE", "DELIVERY_PLAN", "INBOUND_LINE", "OUTBOUND_LINE"]]);
      await manager.query(`INSERT INTO audit_logs(actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1::uuid,$2,'erp-formal-projection',NULL,'projection.initialized',NULL,$3::jsonb,$4,$5,$1::uuid,$1::text)`,
      [actor.userId,actor.displayName,JSON.stringify({inserted,totals,consumers:[...supportedConsumers]}),actor.requestId,actor.source.toLowerCase()]);
      return { inserted, totals, consumers: [...supportedConsumers] };
    });
  }

  async apply(consumerKey: string, records: ProjectionRecord[], actor: SyncActor) {
    if (!supportedConsumers.has(consumerKey)) throw new Error(`不支持的正式投影 ${consumerKey}`);
    return this.dataSource.transaction(async (manager) => {
      await this.scope(manager);
      const result = consumerKey === "sales-orders-v1"
        ? await this.applySalesOrders(manager, records, actor)
        : consumerKey === "finished-goods-inbound-v1"
          ? await this.applyInbound(manager, records, actor)
          : await this.applyOutbound(manager, records, actor);
      await manager.query(`INSERT INTO audit_logs(actor_id,actor_name,resource,record_id,action,before_json,after_json,request_id,source,created_by,updated_by)
        VALUES($1::uuid,$2,'erp-formal-projection',$3,'projection.batch.committed',NULL,$4::jsonb,$5,$6,$1::uuid,$1::text)`,
      [actor.userId,actor.displayName,consumerKey,JSON.stringify({events:records.length,...result}),actor.requestId,actor.source.toLowerCase()]);
      return result;
    });
  }

  private async affectedOrders(manager: EntityManager, records: ProjectionRecord[]) {
    await manager.query(`CREATE TEMP TABLE projection_affected_orders ON COMMIT DROP AS
      SELECT DISTINCT "sourceSystem" source_system,"sourceDatabase" source_database,NULLIF("sourceOrderId",'') source_order_id,
        NULLIF("orderNumber",'') order_number
      FROM jsonb_to_recordset($1::jsonb) AS row("sourceSystem" varchar,"sourceDatabase" varchar,"sourceOrderId" varchar,"orderNumber" varchar)
      WHERE NULLIF("sourceOrderId",'') IS NOT NULL OR NULLIF("orderNumber",'') IS NOT NULL`, [JSON.stringify(records)]);
  }

  private async applySalesOrders(manager: EntityManager, records: ProjectionRecord[], actor: SyncActor) {
    await this.affectedOrders(manager, records);
    const orderResult = await manager.query(`WITH headers AS (
      SELECT DISTINCT ON(r.source_system,r.source_database,r.source_order_id)
        r.source_system,r.source_database,r.source_order_id,r.order_number,r.business_date,r.delivery_date,
        r.customer_code,r.customer_name,r.is_cancelled,r.is_closed,r.is_completed
      FROM erp_staging_raw_records r JOIN projection_affected_orders a
        ON a.source_database=r.source_database AND (a.source_order_id=r.source_order_id OR (a.source_order_id IS NULL AND a.order_number=r.order_number))
      WHERE r.tenant_id=$1 AND r.record_type='ORDER_HEADER'
      ORDER BY r.source_system,r.source_database,r.source_order_id,r.modified_at DESC NULLS LAST,r.id DESC
    ), line_summary AS (
      SELECT r.source_system,r.source_database,r.source_order_id,sum(COALESCE(r.quantity,0)) total_quantity,
        min(r.delivery_date) FILTER(WHERE r.delivery_date IS NOT NULL) due_date
      FROM erp_staging_raw_records r JOIN projection_affected_orders a
        ON a.source_database=r.source_database AND (a.source_order_id=r.source_order_id OR (a.source_order_id IS NULL AND a.order_number=r.order_number))
      WHERE r.tenant_id=$1 AND r.record_type='ORDER_LINE' GROUP BY r.source_system,r.source_database,r.source_order_id
    ), source_rows AS (
      SELECT h.*,COALESCE(lines.total_quantity,0) total_quantity,COALESCE(lines.due_date,h.delivery_date) due_date,
        source.source_account_name,
        CASE h.source_database WHEN 'UFTData741219_000012' THEN '事业三部' WHEN 'UFTData418971_000003' THEN '事业四部'
          ELSE source.source_account_name END division
      FROM headers h LEFT JOIN line_summary lines USING(source_system,source_database,source_order_id)
      LEFT JOIN erp_sync_sources source ON source.tenant_id=$1 AND source.source_database=h.source_database
      WHERE h.order_number IS NOT NULL
    ), upserted AS (
      INSERT INTO orders(order_number,order_date,customer_due_date,review_due_date,customer,order_type,source_system,source_database,
        source_account_name,source_total_quantity,source_active,division,created_by,updated_by)
      SELECT order_number,business_date,delivery_date,due_date,COALESCE(NULLIF(customer_name,''),customer_code),source_system||'销售订单',
        source_system,source_database,source_account_name,total_quantity,NOT(COALESCE(is_cancelled,false) OR COALESCE(is_closed,false) OR COALESCE(is_completed,false)),
        division,$2::uuid,$3 FROM source_rows
      ON CONFLICT(source_database,order_number) WHERE source_database IS NOT NULL DO UPDATE SET
        order_date=EXCLUDED.order_date,customer_due_date=COALESCE(EXCLUDED.customer_due_date,orders.customer_due_date),
        review_due_date=COALESCE(EXCLUDED.review_due_date,orders.review_due_date),customer=EXCLUDED.customer,order_type=EXCLUDED.order_type,
        source_system=EXCLUDED.source_system,source_account_name=EXCLUDED.source_account_name,source_total_quantity=EXCLUDED.source_total_quantity,
        source_active=EXCLUDED.source_active,division=COALESCE(orders.division,EXCLUDED.division),version=orders.version+1,updated_at=now(),updated_by=$3
      RETURNING id
    ) SELECT count(*)::integer count FROM upserted`, [tenant(),actor.userId,actor.displayName]);

    await manager.query(`INSERT INTO plan_periods(year,month,status,created_by,updated_by)
      SELECT DISTINCT EXTRACT(year FROM COALESCE(r.delivery_date,r.business_date))::smallint,
        EXTRACT(month FROM COALESCE(r.delivery_date,r.business_date))::smallint,'active',$2::uuid,$3
      FROM erp_staging_raw_records r JOIN projection_affected_orders a
        ON a.source_database=r.source_database AND (a.source_order_id=r.source_order_id OR (a.source_order_id IS NULL AND a.order_number=r.order_number))
      WHERE r.tenant_id=$1 AND r.record_type='ORDER_LINE' AND r.item_code IS NOT NULL AND COALESCE(r.delivery_date,r.business_date) IS NOT NULL
      ON CONFLICT(year,month) DO UPDATE SET status='active',updated_at=now(),updated_by=$3`, [tenant(),actor.userId,actor.displayName]);

    const lineResult = await manager.query(`WITH affected_lines AS (
      SELECT r.*,row_number() OVER(PARTITION BY r.source_system,r.source_database,r.source_order_id ORDER BY r.source_id)::integer sequence
      FROM erp_staging_raw_records r JOIN projection_affected_orders a
        ON a.source_database=r.source_database AND (a.source_order_id=r.source_order_id OR (a.source_order_id IS NULL AND a.order_number=r.order_number))
      WHERE r.tenant_id=$1 AND r.record_type='ORDER_LINE' AND r.order_number IS NOT NULL AND r.item_code IS NOT NULL
    ), upserted AS (
      INSERT INTO sales_orders(source_system,source_database,source_key,document_date,order_date,order_number,document_name,close_status,
        customer_code,ship_to_customer_code,invoice_customer_code,sequence_number,item_number,item_name,business_quantity,price_quantity,
        delivered_business_quantity,planned_delivery_date,admin_unit_name,owner_division,review_due_date,quantity,created_by,updated_by)
      SELECT line.source_system,line.source_database,line.source_id,line.business_date,line.business_date,line.order_number,line.source_system||'销售订单',
        CASE WHEN line.is_cancelled THEN '已作废' WHEN line.is_closed OR line.is_completed THEN '已关闭' ELSE '未关闭' END,
        line.customer_code,line.customer_code,line.customer_code,line.sequence,line.item_code,line.item_name,line.quantity,line.quantity,
        line.delivered_quantity,line.delivery_date,source.source_account_name,
        CASE line.source_database WHEN 'UFTData741219_000012' THEN '事业三部' WHEN 'UFTData418971_000003' THEN '事业四部' ELSE source.source_account_name END,
        line.delivery_date,line.quantity,$2::uuid,$3
      FROM affected_lines line LEFT JOIN erp_sync_sources source ON source.tenant_id=$1 AND source.source_database=line.source_database
      ON CONFLICT(source_system,source_database,source_key) WHERE source_key IS NOT NULL DO UPDATE SET
        document_date=EXCLUDED.document_date,order_date=EXCLUDED.order_date,order_number=EXCLUDED.order_number,document_name=EXCLUDED.document_name,
        close_status=EXCLUDED.close_status,customer_code=EXCLUDED.customer_code,ship_to_customer_code=EXCLUDED.ship_to_customer_code,
        invoice_customer_code=EXCLUDED.invoice_customer_code,sequence_number=EXCLUDED.sequence_number,item_number=EXCLUDED.item_number,item_name=EXCLUDED.item_name,
        business_quantity=EXCLUDED.business_quantity,price_quantity=EXCLUDED.price_quantity,delivered_business_quantity=EXCLUDED.delivered_business_quantity,
        planned_delivery_date=EXCLUDED.planned_delivery_date,admin_unit_name=EXCLUDED.admin_unit_name,owner_division=EXCLUDED.owner_division,
        review_due_date=EXCLUDED.review_due_date,quantity=EXCLUDED.quantity,version=sales_orders.version+1,updated_at=now(),updated_by=$3
      RETURNING id
    ) SELECT count(*)::integer count FROM upserted`, [tenant(),actor.userId,actor.displayName]);

    const itemResult = await manager.query(`WITH lines AS (
      SELECT r.*,date_trunc('month',COALESCE(r.delivery_date,r.business_date)::timestamp)::date period_date
      FROM erp_staging_raw_records r JOIN projection_affected_orders a
        ON a.source_database=r.source_database AND (a.source_order_id=r.source_order_id OR (a.source_order_id IS NULL AND a.order_number=r.order_number))
      WHERE r.tenant_id=$1 AND r.record_type='ORDER_LINE' AND r.item_code IS NOT NULL AND COALESCE(r.delivery_date,r.business_date) IS NOT NULL
    ), plans AS (
      SELECT source_system,source_database,source_order_line_id,sum(COALESCE(delivered_quantity,0)) delivered
      FROM erp_staging_raw_records WHERE tenant_id=$1 AND record_type='DELIVERY_PLAN'
        AND (source_database,source_order_id) IN (SELECT source_database,source_order_id FROM lines)
      GROUP BY source_system,source_database,source_order_line_id
    ), summarized AS (
      SELECT line.source_system,line.source_database,line.source_order_id,line.order_number,line.item_code,line.item_name,line.customer_code,line.customer_name,
        line.period_date,min(line.delivery_date) delivery_date,sum(COALESCE(line.quantity,0)) quantity,
        sum(CASE WHEN line.source_system='E10' THEN COALESCE(plan.delivered,0) ELSE COALESCE(line.delivered_quantity,0) END) completed
      FROM lines line LEFT JOIN plans plan ON plan.source_system=line.source_system AND plan.source_database=line.source_database
        AND plan.source_order_line_id=line.source_order_line_id
      GROUP BY line.source_system,line.source_database,line.source_order_id,line.order_number,line.item_code,line.item_name,
        line.customer_code,line.customer_name,line.period_date
    ), upserted AS (
      INSERT INTO order_items(order_id,period_id,item_number,relation_key,item_name,review_due_date,customer,division,production_quantity,
        historical_inbound_quantity,today_inbound_quantity,source_month,active,created_by,updated_by)
      SELECT orders.id,period.id,row.item_code,concat(row.source_database,'|',row.source_order_id,'|',row.item_code,'|',row.period_date),row.item_name,row.delivery_date,
        COALESCE(NULLIF(row.customer_name,''),row.customer_code),orders.division,row.quantity,row.completed,0,EXTRACT(month FROM row.period_date)::smallint,
        true,$2::uuid,$3
      FROM summarized row JOIN orders ON orders.source_database=row.source_database AND orders.order_number=row.order_number
      JOIN plan_periods period ON period.year=EXTRACT(year FROM row.period_date)::smallint AND period.month=EXTRACT(month FROM row.period_date)::smallint
      ON CONFLICT(period_id,order_id,item_number) DO UPDATE SET item_name=EXCLUDED.item_name,review_due_date=EXCLUDED.review_due_date,
        customer=EXCLUDED.customer,division=COALESCE(order_items.division,EXCLUDED.division),production_quantity=EXCLUDED.production_quantity,
        historical_inbound_quantity=EXCLUDED.historical_inbound_quantity,active=true,version=order_items.version+1,updated_at=now(),updated_by=$3
      RETURNING id
    ) SELECT count(*)::integer count FROM upserted`, [tenant(),actor.userId,actor.displayName]);
    return { orders:Number(orderResult[0]?.count??0), salesOrderLines:Number(lineResult[0]?.count??0), orderItems:Number(itemResult[0]?.count??0) };
  }

  private async applyInbound(manager: EntityManager, records: ProjectionRecord[], actor: SyncActor) {
    const result = await manager.query(`WITH requested AS (
      SELECT DISTINCT "sourceSystem" source_system,"sourceDatabase" source_database,"sourceTable" source_table,"sourceId" source_id
      FROM jsonb_to_recordset($1::jsonb) AS row("sourceSystem" varchar,"sourceDatabase" varchar,"sourceTable" varchar,"sourceId" varchar)
    ), source_rows AS (
      SELECT r.*,existing.id existing_id,existing.document_number existing_document_number,existing.relation_info existing_relation_info,
        existing.warehouse_code existing_warehouse_code,existing.warehouse existing_warehouse
      FROM requested q JOIN erp_staging_raw_records r ON r.tenant_id=$2 AND r.source_system=q.source_system AND r.source_database=q.source_database
        AND r.source_table=q.source_table AND r.source_id=q.source_id
      LEFT JOIN finished_goods_inbound existing ON existing.source_system=r.source_system AND existing.source_database=r.source_database AND existing.source_key=r.source_id
      WHERE r.record_type='INBOUND_LINE' AND r.item_code IS NOT NULL
    ), upserted AS (
      INSERT INTO finished_goods_inbound(source_system,source_database,source_key,category_number,sales_order_number,document_full_name,document_date,inbound_date,
        document_number,business_type,warehouse_code,warehouse,inbound_category,inventory_code,inventory_name,relation_info,received_quantity,category,created_by,updated_by)
      SELECT source_system,source_database,source_id,source_system,order_number,source_system||'入库单',business_date,business_date,
        COALESCE(existing_document_number,NULLIF(raw_payload->>'document_number',''),source_table||'-'||source_id),source_system||'入库',
        existing_warehouse_code,existing_warehouse,'ERP入库',item_code,item_name,
        COALESCE(existing_relation_info,source_database||'|'||source_table||'|'||source_id),quantity,source_system||'入库',$3::uuid,$4
      FROM source_rows
      ON CONFLICT(source_system,source_database,source_key) WHERE source_key IS NOT NULL DO UPDATE SET
        sales_order_number=EXCLUDED.sales_order_number,document_date=EXCLUDED.document_date,inbound_date=EXCLUDED.inbound_date,
        inventory_code=EXCLUDED.inventory_code,inventory_name=EXCLUDED.inventory_name,received_quantity=EXCLUDED.received_quantity,
        version=finished_goods_inbound.version+1,updated_at=now(),updated_by=$4 RETURNING id
    ) SELECT count(*)::integer count FROM upserted`, [JSON.stringify(records),tenant(),actor.userId,actor.displayName]);
    return { inboundRows:Number(result[0]?.count??0) };
  }

  private async applyOutbound(manager: EntityManager, records: ProjectionRecord[], actor: SyncActor) {
    const result = await manager.query(`WITH requested AS (
      SELECT DISTINCT "sourceSystem" source_system,"sourceDatabase" source_database,"sourceTable" source_table,"sourceId" source_id
      FROM jsonb_to_recordset($1::jsonb) AS row("sourceSystem" varchar,"sourceDatabase" varchar,"sourceTable" varchar,"sourceId" varchar)
    ), source_rows AS (
      SELECT r.*,existing.document_number existing_document_number,existing.warehouse_code existing_warehouse_code,existing.warehouse existing_warehouse,
        existing.unit existing_unit,existing.unit_price existing_unit_price,existing.total_amount existing_total_amount
      FROM requested q JOIN erp_staging_raw_records r ON r.tenant_id=$2 AND r.source_system=q.source_system AND r.source_database=q.source_database
        AND r.source_table=q.source_table AND r.source_id=q.source_id
      LEFT JOIN finished_goods_outbound existing ON existing.source_system=r.source_system AND existing.source_database=r.source_database AND existing.source_key=r.source_id
      WHERE r.record_type='OUTBOUND_LINE' AND r.item_code IS NOT NULL
    ), upserted AS (
      INSERT INTO finished_goods_outbound(source_system,source_database,source_key,document_date,document_number,document_status,direction_value,voucher_type,
        business_type,customer_code,customer_name,sales_order_number,item_number,item_name,quantity,unit,unit_price,total_amount,warehouse_code,warehouse,
        source_document_number,remark,created_by,updated_by)
      SELECT source_system,source_database,source_id,business_date,
        COALESCE(existing_document_number,NULLIF(raw_payload->>'document_number',''),source_table||'-'||source_id),status_code,0,source_system||'出库单',
        source_system||'出库',customer_code,customer_name,order_number,item_code,item_name,quantity,existing_unit,existing_unit_price,existing_total_amount,
        existing_warehouse_code,existing_warehouse,order_number,CASE WHEN order_link_stable=false THEN '未稳定关联订单明细' ELSE NULL END,$3::uuid,$4
      FROM source_rows
      ON CONFLICT(source_system,source_database,source_key) DO UPDATE SET document_date=EXCLUDED.document_date,document_status=EXCLUDED.document_status,
        customer_code=EXCLUDED.customer_code,customer_name=EXCLUDED.customer_name,sales_order_number=EXCLUDED.sales_order_number,
        item_number=EXCLUDED.item_number,item_name=EXCLUDED.item_name,quantity=EXCLUDED.quantity,source_document_number=EXCLUDED.source_document_number,
        remark=EXCLUDED.remark,version=finished_goods_outbound.version+1,updated_at=now(),updated_by=$4 RETURNING id
    ) SELECT count(*)::integer count FROM upserted`, [JSON.stringify(records),tenant(),actor.userId,actor.displayName]);
    return { outboundRows:Number(result[0]?.count??0) };
  }
}
