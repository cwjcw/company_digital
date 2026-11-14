/** Allocation approval belongs to KDOS, independently of ERP status, quantities or dates.
 * Every physical active approved row contributes once, including separate import batches.
 * There is no persisted month key in the current model: calendar filters keep order_date.
 */
export const allocationDemandCtesSql = `allocations AS MATERIALIZED (
  SELECT a.tenant_id,a.order_number,a.item_code,a.division_id,
    (array_agg(a.id ORDER BY a.created_at,a.id))[1] allocation_id,
    min(a.customer_code) customer_code,min(a.order_date) order_date,max(a.item_name) item_name,
    sum(a.allocated_quantity) quantity,count(*) allocation_count,
    min(to_jsonb(a)->>'monthly_plan_id') demand_parent_id,count(DISTINCT to_jsonb(a)->>'monthly_plan_id') demand_parent_count,
    count(*) FILTER(WHERE a.order_date IS NULL) missing_order_dates,
    count(*) FILTER(WHERE nullif(btrim(a.item_name),'') IS NULL) missing_item_names,
    count(DISTINCT a.customer_code) customer_count,
    bool_and(a.manually_maintained AND a.division_id IS NOT NULL
      AND nullif(btrim(a.order_number),'') IS NOT NULL AND nullif(btrim(a.item_code),'') IS NOT NULL
      AND nullif(btrim(a.customer_code),'') IS NOT NULL AND a.allocated_quantity>=0) valid
  FROM mps_order_allocations a WHERE a.tenant_id=$1 AND a.archived_at IS NULL AND a.order_status='已审核'
  GROUP BY a.tenant_id,a.order_number,a.item_code,a.division_id
), joined AS MATERIALIZED (
  SELECT a.*,p.id existing_id,p.allocation_id existing_allocation_id,p.order_number existing_order_number,
    p.item_code existing_item_code,p.division_id existing_division_id,p.customer_code existing_customer_code,
    parent.archived_at parent_archived_at,parent.order_number parent_order_number,parent.item_code parent_item_code,
    parent.division_id parent_division_id,parent.customer_code parent_customer_code,parent.allocated_quantity parent_quantity,parent.monthly_plan_id parent_monthly_plan_id,
    o.id enabled_division_id,
    (p.id IS NOT NULL AND parent.archived_at IS NOT NULL
      AND (parent.order_number,parent.item_code,parent.division_id,parent.customer_code)
        IS NOT DISTINCT FROM (a.order_number,a.item_code,a.division_id,a.customer_code)) archived_parent_matches,
    (p.id IS NOT NULL AND parent.archived_at IS NULL
      AND (parent.order_number,parent.item_code,parent.division_id,parent.customer_code)
        IS NOT DISTINCT FROM (a.order_number,a.item_code,a.division_id,a.customer_code)) active_parent_matches
  FROM allocations a LEFT JOIN organization_units o ON o.id=a.division_id AND o.enabled=true
  LEFT JOIN mps_monthly_plans p ON p.tenant_id=a.tenant_id AND (p.id=a.demand_parent_id::uuid OR (a.demand_parent_id IS NULL AND p.order_number=a.order_number
    AND p.item_code=a.item_code AND p.division_id IS NOT DISTINCT FROM a.division_id))
  LEFT JOIN mps_order_allocations parent ON parent.tenant_id=p.tenant_id AND parent.id=p.allocation_id
), classified AS MATERIALIZED (
  SELECT j.*,(j.archived_parent_matches AND j.valid AND j.customer_count=1
      AND j.existing_customer_code IS NOT DISTINCT FROM j.customer_code
      AND j.demand_parent_count<=1 AND (j.demand_parent_id IS NULL OR j.demand_parent_id=j.existing_id::text)
      AND coalesce(j.parent_quantity,0)=0 AND (j.parent_monthly_plan_id IS NULL OR j.parent_monthly_plan_id=j.existing_id)
      AND NOT EXISTS(SELECT 1 FROM mps_order_allocations linked WHERE linked.tenant_id=j.tenant_id AND linked.monthly_plan_id=j.existing_id
        AND (linked.order_number,linked.item_code,linked.division_id,linked.customer_code) IS DISTINCT FROM (j.order_number,j.item_code,j.division_id,j.customer_code))
      AND NOT EXISTS(SELECT 1 FROM mps_base_plans linked WHERE linked.tenant_id=j.tenant_id AND
        ((linked.monthly_plan_id=j.existing_id AND (linked.order_number,linked.item_code,linked.division_id,linked.customer_code)
          IS DISTINCT FROM (j.order_number,j.item_code,j.division_id,j.customer_code))
        OR (linked.monthly_plan_id IS NULL AND (linked.order_number,linked.item_code,linked.division_id) IS NOT DISTINCT FROM (j.order_number,j.item_code,j.division_id) AND linked.customer_code IS NOT NULL AND linked.customer_code IS DISTINCT FROM j.customer_code)
        OR ((linked.order_number,linked.item_code,linked.division_id) IS NOT DISTINCT FROM (j.order_number,j.item_code,j.division_id)
          AND linked.monthly_plan_id IS NOT NULL AND linked.monthly_plan_id<>j.existing_id)))) recover_archived_source
  FROM joined j
), candidates AS MATERIALIZED (
  SELECT j.*,
    (j.valid AND j.customer_count=1
      AND (SELECT count(DISTINCT x.customer_code) FROM allocations x WHERE x.order_number=j.order_number)=1
      AND NOT EXISTS(SELECT 1 FROM mps_group_plans g WHERE g.tenant_id=j.tenant_id AND g.order_number=j.order_number
        AND g.customer_code IS NOT NULL AND g.customer_code IS DISTINCT FROM j.customer_code)
      AND j.enabled_division_id IS NOT NULL
      AND (j.existing_id IS NULL OR j.recover_archived_source OR j.active_parent_matches)) group_source_safe,
    CASE WHEN j.demand_parent_count>1 OR (j.demand_parent_id IS NOT NULL AND (j.existing_id IS NULL OR
        (j.existing_order_number,j.existing_item_code,j.existing_division_id) IS DISTINCT FROM (j.order_number,j.item_code,j.division_id))) THEN '显式需求父关系冲突，禁止文本回退'
      WHEN NOT j.valid OR j.customer_count<>1 THEN '分配客户或数量无效'
      WHEN (SELECT count(DISTINCT x.customer_code) FROM allocations x WHERE x.order_number=j.order_number)<>1
        THEN '同订单有效分配客户不一致'
      WHEN EXISTS(SELECT 1 FROM mps_group_plans g WHERE g.tenant_id=j.tenant_id AND g.order_number=j.order_number
        AND g.customer_code IS NOT NULL AND g.customer_code IS DISTINCT FROM j.customer_code) THEN '集团历史客户归属冲突'
      WHEN j.enabled_division_id IS NULL THEN '承接事业部无效'
      WHEN j.existing_id IS NOT NULL AND NOT j.archived_parent_matches AND
        (j.parent_archived_at IS NOT NULL OR j.parent_order_number IS DISTINCT FROM j.order_number OR
          j.parent_item_code IS DISTINCT FROM j.item_code OR j.parent_division_id IS DISTINCT FROM j.division_id OR
          j.existing_customer_code IS DISTINCT FROM j.customer_code) THEN '保留历史计划或人工归属'
      WHEN j.archived_parent_matches AND NOT j.recover_archived_source
        THEN CASE WHEN coalesce(j.parent_quantity,0)<>0 THEN '归档来源仍承载非零历史需求，保留独立来源'
          ELSE '正式父关系或客户身份冲突，不能恢复归档来源' END
      ELSE NULL END skip_reason
  FROM classified j
)`;

/** The existing order completion rule is the average of item completion fractions.
 * Combine a split item's divisions before averaging; retained historical rows never inflate demand.
 * Any unresolved matching conflict preserves the entire existing order summary.
 */
export const allocationOrderTotalsSql = `WITH ${allocationDemandCtesSql}, items AS (
  SELECT a.order_number,a.item_code,sum(a.quantity) required_quantity,
    least(sum(greatest(coalesce(p.cumulative_inbound_quantity,0),0)),sum(a.quantity)) completed_quantity
  FROM candidates a LEFT JOIN mps_monthly_plans p ON p.tenant_id=a.tenant_id AND p.id=a.existing_id
  WHERE a.group_source_safe AND NOT EXISTS(SELECT 1 FROM candidates blocked WHERE blocked.order_number=a.order_number AND NOT blocked.group_source_safe)
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

/** One-off audited corrections can point a restored legacy allocation alias at an
 * already-existing group plan. The underlying allocation/monthly identity remains
 * untouched; only the group summary is rolled up under the selected existing order.
 */
export function allocationOrderTotalsSqlWithAliases() {
  return `WITH ${allocationDemandCtesSql}, mapped AS MATERIALIZED (
    SELECT c.*,COALESCE((SELECT x."targetOrderNumber" FROM jsonb_to_recordset($2::jsonb)
      x("sourceOrderNumber" text,"targetOrderNumber" text) WHERE x."sourceOrderNumber"=c.order_number),c.order_number) group_order_number
    FROM candidates c
  ), items AS (
    SELECT a.group_order_number order_number,a.item_code,sum(a.quantity) required_quantity,
      least(sum(greatest(coalesce(p.cumulative_inbound_quantity,0),0)),sum(a.quantity)) completed_quantity
    FROM mapped a LEFT JOIN mps_monthly_plans p ON p.tenant_id=a.tenant_id AND p.id=a.existing_id
    WHERE a.group_source_safe AND NOT EXISTS(SELECT 1 FROM mapped blocked WHERE blocked.group_order_number=a.group_order_number AND NOT blocked.group_source_safe)
    GROUP BY a.group_order_number,a.item_code
  ), orders AS (
    SELECT order_number,sum(required_quantity) required_quantity,sum(completed_quantity) completed_quantity,
      sum(greatest(required_quantity-completed_quantity,0)) pending_quantity,
      round(avg(CASE WHEN required_quantity<=0 THEN 0 ELSE least(completed_quantity/required_quantity,1) END),4) completion_rate
    FROM items GROUP BY order_number
  ), metadata AS (
    SELECT group_order_number order_number,min(customer_code) customer_code,
      CASE WHEN count(DISTINCT order_date)=1 THEN min(order_date) END order_date,
      CASE WHEN count(DISTINCT division_id)=1 THEN (array_agg(division_id))[1] END primary_division_id
    FROM mapped GROUP BY group_order_number
  ) SELECT orders.*,metadata.customer_code,metadata.order_date,metadata.primary_division_id
    FROM orders JOIN metadata USING(order_number)`;
}
