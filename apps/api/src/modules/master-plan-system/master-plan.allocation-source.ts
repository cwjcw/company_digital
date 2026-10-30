/** Allocation approval belongs to KDOS, independently of ERP status, quantities or dates.
 * Every physical active approved row contributes once, including separate import batches.
 * There is no persisted month key in the current model: calendar filters keep order_date.
 */
export const allocationDemandCtesSql = `allocations AS MATERIALIZED (
  SELECT a.tenant_id,a.order_number,a.item_code,a.division_id,
    (array_agg(a.id ORDER BY a.created_at,a.id))[1] allocation_id,
    min(a.customer_code) customer_code,min(a.order_date) order_date,max(a.item_name) item_name,
    sum(a.allocated_quantity) quantity,count(*) allocation_count,
    count(*) FILTER(WHERE a.order_date IS NULL) missing_order_dates,
    count(*) FILTER(WHERE nullif(btrim(a.item_name),'') IS NULL) missing_item_names,
    count(DISTINCT a.customer_code) customer_count,
    bool_and(a.manually_maintained AND a.division_id IS NOT NULL
      AND nullif(btrim(a.order_number),'') IS NOT NULL AND nullif(btrim(a.item_code),'') IS NOT NULL
      AND nullif(btrim(a.customer_code),'') IS NOT NULL AND a.allocated_quantity>=0) valid
  FROM mps_order_allocations a WHERE a.tenant_id=$1 AND a.archived_at IS NULL AND a.order_status='已审核'
  GROUP BY a.tenant_id,a.order_number,a.item_code,a.division_id
), candidates AS MATERIALIZED (
  SELECT a.*,p.id existing_id,p.allocation_id existing_allocation_id,
    CASE WHEN NOT a.valid OR a.customer_count<>1 THEN '分配客户或数量无效'
      WHEN (SELECT count(DISTINCT x.customer_code) FROM allocations x WHERE x.order_number=a.order_number)<>1
        THEN '同订单有效分配客户不一致'
      WHEN EXISTS(SELECT 1 FROM mps_group_plans g WHERE g.tenant_id=a.tenant_id AND g.order_number=a.order_number
        AND g.customer_code IS NOT NULL AND g.customer_code IS DISTINCT FROM a.customer_code) THEN '集团历史客户归属冲突'
      WHEN o.id IS NULL THEN '承接事业部无效'
      WHEN p.id IS NOT NULL AND (parent.archived_at IS NOT NULL OR parent.id IS NULL
        OR parent.order_number IS DISTINCT FROM a.order_number OR parent.item_code IS DISTINCT FROM a.item_code
        OR parent.division_id IS DISTINCT FROM a.division_id OR p.customer_code IS DISTINCT FROM a.customer_code)
        THEN '保留历史计划或人工归属'
      ELSE NULL END skip_reason
  FROM allocations a LEFT JOIN organization_units o ON o.id=a.division_id AND o.enabled=true
  LEFT JOIN mps_monthly_plans p ON p.tenant_id=a.tenant_id AND p.order_number=a.order_number
    AND p.item_code=a.item_code AND p.division_id IS NOT DISTINCT FROM a.division_id
  LEFT JOIN mps_order_allocations parent ON parent.tenant_id=p.tenant_id AND parent.id=p.allocation_id
)`;

/** The existing order completion rule is the average of item completion fractions.
 * Combine a split item's divisions before averaging; retained historical rows never inflate demand.
 * Any unresolved matching conflict preserves the entire existing order summary.
 */
export const allocationOrderTotalsSql = `WITH ${allocationDemandCtesSql}, items AS (
  SELECT a.order_number,a.item_code,sum(a.quantity) required_quantity,
    least(sum(greatest(p.cumulative_inbound_quantity,0)),sum(a.quantity)) completed_quantity
  FROM candidates a JOIN mps_monthly_plans p ON p.tenant_id=a.tenant_id AND p.id=a.existing_id
  WHERE NOT EXISTS(SELECT 1 FROM candidates blocked WHERE blocked.order_number=a.order_number AND blocked.skip_reason IS NOT NULL)
  GROUP BY a.order_number,a.item_code
), orders AS (
  SELECT order_number,sum(required_quantity) required_quantity,sum(completed_quantity) completed_quantity,
    sum(greatest(required_quantity-completed_quantity,0)) pending_quantity,
    round(avg(CASE WHEN required_quantity<=0 THEN 0 ELSE least(completed_quantity/required_quantity,1) END),4) completion_rate
  FROM items GROUP BY order_number
), metadata AS (
  SELECT order_number,min(customer_code) customer_code,
    CASE WHEN count(DISTINCT order_date)=1 THEN min(order_date) END order_date,
    CASE WHEN count(DISTINCT division_id)=1 THEN (array_agg(division_id))[1] END primary_division_id
  FROM candidates GROUP BY order_number
) SELECT orders.*,metadata.customer_code,metadata.order_date,metadata.primary_division_id
  FROM orders JOIN metadata USING(order_number)`;
