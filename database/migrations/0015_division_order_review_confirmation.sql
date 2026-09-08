BEGIN;

ALTER TABLE planning.division_order_reviews
  ADD COLUMN division_review_due_date date,
  ADD COLUMN delivery_confirmed_at timestamptz,
  ADD COLUMN delivery_confirmed_by uuid;

CREATE INDEX division_order_reviews_review_due_idx
  ON planning.division_order_reviews(tenant_id, division_review_due_date);

INSERT INTO iam.permissions(tenant_id,code,description)
SELECT tenant.id, permission.code, permission.description
FROM iam.tenants tenant CROSS JOIN (VALUES
  ('division-order-review.update','填写事业部评审交期并确认交期')
) permission(code,description)
ON CONFLICT(tenant_id,code) DO UPDATE SET description=EXCLUDED.description;

COMMIT;
