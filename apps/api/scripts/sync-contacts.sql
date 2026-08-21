INSERT INTO users (username,display_name,password_hash,enabled,division,employee_no,wechat_user_id,position,department_paths,must_change_password,last_login_at)
SELECT COALESCE(c.employee_no,c.wechat_user_id),c.name,'$2b$12$sdk44B5kupswkF/YEGXg0uo4XNGsB09jyPE/.Ac0.VQdnfocn4q4K',c.enabled,NULL,c.employee_no,c.wechat_user_id,c.position,c.department_paths,true,NULL
FROM (SELECT c.*,row_number() OVER (PARTITION BY COALESCE(c.employee_no,c.wechat_user_id) ORDER BY c.employee_no NULLS LAST,c.wechat_user_id) AS rn FROM contacts c) c
WHERE c.rn=1
  AND lower(trim(COALESCE(c.employee_no,c.wechat_user_id))) <> 'admin'
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.username=COALESCE(c.employee_no,c.wechat_user_id) OR (c.employee_no IS NOT NULL AND u.employee_no=c.employee_no));
INSERT INTO user_roles (user_id,role_id)
SELECT u.id,r.id FROM users u CROSS JOIN roles r
WHERE r.name=convert_from(decode('e799bde69dbf','hex'),'utf8')
  AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles rx ON rx.id=ur.role_id WHERE ur.user_id=u.id AND rx.name IN (convert_from(decode('e7b3bbe7bb9fe7aea1e79086e59198','hex'),'utf8'),convert_from(decode('e99b86e59ba2e7aea1e79086e59198','hex'),'utf8')))
ON CONFLICT DO NOTHING;
UPDATE users SET password_hash='$2b$12$sdk44B5kupswkF/YEGXg0uo4XNGsB09jyPE/.Ac0.VQdnfocn4q4K',must_change_password=true
WHERE lower(trim(username)) <> 'admin';
