import { BadRequestException, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

@Injectable()
export class SalesDashboardService {
  constructor(private readonly dataSource: DataSource) {}

  private unrestricted(user: any) {
    if (user.divisions === "*" || user.isSystemAdmin === true || user.moduleAdminCodes?.some((code: string) => code === "cockpit")) return true;
    return Array.isArray(user.tableDataScopes) && user.tableDataScopes.some((scope: any) => scope?.resource === "sales-summary-dashboard" && scope?.scope === "ALL" && (!Array.isArray(scope.actions) || scope.actions.includes("read")));
  }

  private range(dimension: "year" | "month" | "day", period: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) throw new BadRequestException("驾驶舱日期格式无效");
    const [year, month, day] = period.split("-").map(Number);
    const value = new Date(Date.UTC(year!, month! - 1, day!));
    if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month! - 1 || value.getUTCDate() !== day) throw new BadRequestException("驾驶舱日期无效");
    const start = dimension === "year" ? new Date(Date.UTC(year!, 0, 1)) : dimension === "month" ? new Date(Date.UTC(year!, month! - 1, 1)) : value;
    const end = new Date(start);
    if (dimension === "year") end.setUTCFullYear(end.getUTCFullYear() + 1);
    else if (dimension === "month") end.setUTCMonth(end.getUTCMonth() + 1);
    else end.setUTCDate(end.getUTCDate() + 1);
    return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)] as const;
  }

  async salesDashboard(input: { dimension: "year" | "month" | "day"; period: string; divisions?: string[]; customers?: string[] }, user: any) {
    if (!["year", "month", "day"].includes(input.dimension)) throw new BadRequestException("驾驶舱时间维度无效");
    const [start, end] = this.range(input.dimension, input.period);
    const params: unknown[] = [start, end];
    const clauses = ["o.source_active=true", "o.order_date>=$1::date", "o.order_date<$2::date"];
    const selected: string[] = [];
    if (!this.unrestricted(user)) {
      if (!Array.isArray(user.divisions) || !user.divisions.length) return { generatedAt: new Date().toISOString(), metrics: { orderCount: 0, orderAmount: "0", totalQuantity: "0", completedQuantity: "0", pendingQuantity: "0", completionRate: 0 }, statusCounts: { "已完成": 0, "进行中": 0, "即将延期": 0, "延期": 0 }, divisionRows: [], warningRows: [], filters: { divisions: [], customers: [] } };
      params.push(user.divisions); clauses.push(`o.division=ANY($${params.length}::varchar[])`);
    }
    const normalize = (values: string[] = []) => [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].slice(0, 100);
    const divisions = normalize(input.divisions); const customers = normalize(input.customers);
    if (divisions.length) { params.push(divisions); selected.push(`o.division=ANY($${params.length}::varchar[])`); }
    if (customers.length) { params.push(customers); selected.push(`o.customer=ANY($${params.length}::varchar[])`); }
    const [row] = await this.dataSource.query(`WITH scoped_orders AS MATERIALIZED (SELECT o.* FROM orders o WHERE ${clauses.join(" AND ")}), filtered_orders AS MATERIALIZED (SELECT o.* FROM scoped_orders o${selected.length ? ` WHERE ${selected.join(" AND ")}` : ""}), item_totals AS (SELECT i.order_id,COALESCE(sum(i.production_quantity),0) item_total,COALESCE(sum(COALESCE(i.historical_inbound_quantity,0)+COALESCE(i.today_inbound_quantity,0)),0) completed,COALESCE(sum(COALESCE(i.production_quantity,0)*COALESCE(i.unit_price,0)),0) item_amount FROM order_items i JOIN filtered_orders o ON o.id=i.order_id WHERE i.active=true GROUP BY i.order_id), base AS (SELECT o.id,o.order_number,o.order_date,o.customer,o.division,COALESCE(o.exception_due_date,o.review_due_date,o.customer_due_date) due_date,COALESCE(o.source_total_quantity,t.item_total,0) total_quantity,COALESCE(t.completed,0) completed_quantity,COALESCE(o.order_amount,t.item_amount,0) order_amount FROM filtered_orders o LEFT JOIN item_totals t ON t.order_id=o.id), decorated AS (SELECT base.*,GREATEST(total_quantity-completed_quantity,0) pending_quantity,CASE WHEN total_quantity<>0 AND completed_quantity>=total_quantity THEN '已完成' WHEN due_date<(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN '延期' WHEN due_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN '即将延期' ELSE '进行中' END status FROM base), division_summary AS (SELECT COALESCE(division,'未指定') division,count(*)::integer orders,sum(order_amount) amount,sum(total_quantity) total,sum(completed_quantity) completed,sum(pending_quantity) pending,CASE WHEN sum(total_quantity)=0 THEN 0 ELSE round(sum(completed_quantity)/sum(total_quantity)*100,2) END rate FROM decorated GROUP BY COALESCE(division,'未指定')), warnings AS (SELECT id,order_number,customer,COALESCE(division,'未指定') division,due_date,status,due_date-(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date remaining_days FROM decorated WHERE status<>'已完成' AND due_date IS NOT NULL AND due_date<=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date+3 ORDER BY due_date,order_number LIMIT 8) SELECT jsonb_build_object('generatedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'metrics',jsonb_build_object('orderCount',(SELECT count(*)::integer FROM decorated),'orderAmount',(SELECT COALESCE(sum(order_amount),0)::text FROM decorated),'totalQuantity',(SELECT COALESCE(sum(total_quantity),0)::text FROM decorated),'completedQuantity',(SELECT COALESCE(sum(completed_quantity),0)::text FROM decorated),'pendingQuantity',(SELECT COALESCE(sum(pending_quantity),0)::text FROM decorated),'completionRate',(SELECT CASE WHEN COALESCE(sum(total_quantity),0)=0 THEN 0 ELSE round(sum(completed_quantity)/sum(total_quantity)*100,2) END FROM decorated)),'statusCounts',jsonb_build_object('已完成',(SELECT count(*)::integer FROM decorated WHERE status='已完成'),'进行中',(SELECT count(*)::integer FROM decorated WHERE status='进行中'),'即将延期',(SELECT count(*)::integer FROM decorated WHERE status='即将延期'),'延期',(SELECT count(*)::integer FROM decorated WHERE status='延期')),'divisionRows',COALESCE((SELECT jsonb_agg(jsonb_build_object('division',division,'orders',orders,'amount',amount::text,'total',total::text,'completed',completed::text,'pending',pending::text,'rate',rate) ORDER BY pending DESC,division) FROM division_summary),'[]'::jsonb),'warningRows',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'orderNumber',order_number,'customer',customer,'division',division,'dueDate',due_date,'status',status,'remainingDays',remaining_days) ORDER BY due_date,order_number) FROM warnings),'[]'::jsonb),'filters',jsonb_build_object('divisions',COALESCE((SELECT to_jsonb(array_agg(DISTINCT division ORDER BY division)) FROM scoped_orders WHERE division IS NOT NULL),'[]'::jsonb),'customers',COALESCE((SELECT to_jsonb(array_agg(DISTINCT customer ORDER BY customer)) FROM scoped_orders WHERE customer IS NOT NULL),'[]'::jsonb))) payload`, params);
    return row.payload;
  }
}
