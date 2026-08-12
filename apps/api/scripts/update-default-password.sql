UPDATE users SET password_hash='$2b$12$MtmiHvPQoO81c8XiUaKbn.vOb6YqHIJDcvqYZ.AkLytztdGVNWZky',must_change_password=true
WHERE username <> '09432' AND display_name <> convert_from(decode('e5b494e4bc89e69db0','hex'),'utf8');
