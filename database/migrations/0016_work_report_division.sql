BEGIN;

ALTER TABLE planning.work_reports ADD COLUMN division_id uuid;

UPDATE planning.work_reports report
SET division_id=item.responsible_org_id
FROM planning.plan_items item
WHERE item.tenant_id=report.tenant_id
  AND item.id=report.source_plan_item_id
  AND report.division_id IS NULL;

UPDATE planning.work_reports report
SET division_id=(
  SELECT item.responsible_org_id
  FROM planning.plan_items item
  WHERE item.tenant_id=report.tenant_id
    AND item.order_number=report.order_number
    AND item.item_number=report.item_number
    AND item.responsible_org_id IS NOT NULL
  ORDER BY item.updated_at DESC,item.id DESC
  LIMIT 1
)
WHERE report.division_id IS NULL
  AND EXISTS (
    SELECT 1 FROM planning.plan_items item
    WHERE item.tenant_id=report.tenant_id
      AND item.order_number=report.order_number
      AND item.item_number=report.item_number
      AND item.responsible_org_id IS NOT NULL
  );

CREATE INDEX work_reports_tenant_division_idx
  ON planning.work_reports(tenant_id,division_id);

COMMIT;
