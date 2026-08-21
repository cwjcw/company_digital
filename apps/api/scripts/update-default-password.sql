UPDATE users SET password_hash='$2b$12$sdk44B5kupswkF/YEGXg0uo4XNGsB09jyPE/.Ac0.VQdnfocn4q4K',must_change_password=true
WHERE lower(trim(username)) <> 'admin';
