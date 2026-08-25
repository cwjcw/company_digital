# 企业微信通讯录同步

所有脚本统一通过 `main.py` 启动，并使用 `basic_code` 自己的虚拟环境和 `.env`：

```bash
/data/automation/code/work/basci/basic_code/.venv/bin/python automation/wecom_sync/main.py provision
/data/automation/code/work/basci/basic_code/.venv/bin/python automation/wecom_sync/main.py dry-run --source /data/work/DataBase/Contacts_wechat.xlsx
/data/automation/code/work/basci/basic_code/.venv/bin/python automation/wecom_sync/main.py sync
```

- `provision`：生成只具备通讯录同步权限的 API Key，写入被 Git 忽略的 `data/contact-sync/api-key`。
- `backup`：只备份同步涉及的本地人员、通讯录和组织数据。
- `dry-run`：生成差异摘要但不修改数据。
- `sync`：先备份，再实时读取企业微信并提交同步；备份仅保留最近 3 天。

“厦门凯南展示制品有限公司 > 其他”及其子部门不会进入同步。本地多余部门会删除；企业微信缺少的本地人员会停用并撤销刷新令牌，不能继续登录。

当前主机使用用户级 systemd timer（`Jerry` 已启用 linger，因此无需登录也会随系统启动）：

```bash
systemctl --user status kdos-wecom-contact-sync.timer
systemctl --user list-timers kdos-wecom-contact-sync.timer --all
journalctl --user -u kdos-wecom-contact-sync.service
```

定时器会在开机后触发一次，并在 Asia/Shanghai 时区每天 03:00 执行。仓库同时保留 `systemd/` 下的系统级 unit 模板，具备 sudo 权限时可改为系统级安装。
