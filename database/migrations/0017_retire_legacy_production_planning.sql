BEGIN;

DELETE FROM iam.permissions
WHERE code LIKE ANY (ARRAY[
  'on-hand-summary-dashboard.%','rolling-plan.%','monthly-plan.%','rolling-plan-table.%',
  'division-order-review.%','weekly-plan.%','work-report.%'
]);

DROP TABLE IF EXISTS planning.work_reports;
DROP TABLE IF EXISTS planning.weekly_plan_items;
DROP TABLE IF EXISTS planning.weekly_plan_periods;
DROP TABLE IF EXISTS planning.division_order_reviews;
DROP TABLE IF EXISTS planning.rolling_plan_items;

COMMIT;
