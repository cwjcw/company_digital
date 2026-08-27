BEGIN;

-- Preserve any explicitly granted daily-progress role permissions by mapping
-- them to the report that replaces it. Existing work-report grants win.
INSERT INTO iam.role_permissions(tenant_id,role_id,permission_id,created_by,updated_by)
SELECT old_binding.tenant_id,old_binding.role_id,new_permission.id,old_binding.created_by,old_binding.updated_by
FROM iam.role_permissions old_binding
JOIN iam.permissions old_permission ON old_permission.id=old_binding.permission_id
JOIN iam.permissions new_permission
  ON new_permission.tenant_id=old_permission.tenant_id
 AND new_permission.code='work-report.'||split_part(old_permission.code,'.',2)
WHERE old_permission.code LIKE 'daily-progress.%'
ON CONFLICT(role_id,permission_id) DO NOTHING;

INSERT INTO iam.field_policies(tenant_id,role_id,resource,field_code,access,mask_pattern,created_by,updated_by)
SELECT tenant_id,role_id,'work-report',field_code,access,mask_pattern,created_by,updated_by
FROM iam.field_policies
WHERE resource='daily-progress'
ON CONFLICT(role_id,resource,field_code) DO NOTHING;

DELETE FROM iam.field_policies WHERE resource='daily-progress';
DELETE FROM iam.permissions WHERE code LIKE 'daily-progress.%';
DROP TABLE IF EXISTS planning.daily_progress;

COMMIT;
