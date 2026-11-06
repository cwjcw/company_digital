/** LEGACY_RETAINED keeps historical read/report compatibility; paused/cancelled ancestry stops ordinary execution. */
// The uncorrelated catalog InitPlan runs once. Without120, do not scan ancestors
// for each pending task; if even one lifecycle column exists, retain all checks.
export const weeklyLifecycleExecutableSql=(alias:string)=>`CASE WHEN EXISTS(
    SELECT 1 FROM pg_catalog.pg_attribute lifecycle_schema
    WHERE lifecycle_schema.attrelid IN (to_regclass('mps_weekly_plans'),to_regclass('mps_base_plans'),to_regclass('mps_monthly_plans'))
      AND lifecycle_schema.attname='lifecycle_status' AND NOT lifecycle_schema.attisdropped
  ) THEN (COALESCE(to_jsonb(${alias})->>'lifecycle_status','ACTIVE') NOT IN ('ON_HOLD','CANCELLED')
  AND NOT EXISTS(SELECT 1 FROM mps_base_plans lifecycle_base WHERE lifecycle_base.tenant_id=${alias}.tenant_id AND lifecycle_base.id=${alias}.base_plan_id AND COALESCE(to_jsonb(lifecycle_base)->>'lifecycle_status','ACTIVE') IN ('ON_HOLD','CANCELLED'))
  AND NOT EXISTS(SELECT 1 FROM mps_monthly_plans lifecycle_month
    LEFT JOIN mps_base_plans lifecycle_parent ON lifecycle_parent.tenant_id=${alias}.tenant_id AND lifecycle_parent.id=${alias}.base_plan_id
    LEFT JOIN mps_shipping_plans lifecycle_shipping ON lifecycle_shipping.tenant_id=lifecycle_parent.tenant_id AND lifecycle_shipping.id=lifecycle_parent.shipping_plan_id
    WHERE lifecycle_month.tenant_id=${alias}.tenant_id AND
      (lifecycle_month.id=lifecycle_shipping.monthly_plan_id OR (lifecycle_shipping.monthly_plan_id IS NULL
        AND lifecycle_month.order_number=${alias}.order_number AND lifecycle_month.item_code=${alias}.item_code AND lifecycle_month.division_id IS NOT DISTINCT FROM ${alias}.division_id))
      AND COALESCE(to_jsonb(lifecycle_month)->>'lifecycle_status','ACTIVE') IN ('ON_HOLD','CANCELLED')))
  ELSE true END`;
