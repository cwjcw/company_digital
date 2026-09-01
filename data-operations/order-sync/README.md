# ERP订单正式staging同步

三个来源必须作为三个独立任务运行；E10来源列表由 `sources.json` 驱动，未来新增账套时只增加来源项，并把凭据继续保留在 `basic_code/.env`。

```bash
automation/customer_import/.venv/bin/python data-operations/order-sync/sync.py run --source e10-main
automation/customer_import/.venv/bin/python data-operations/order-sync/sync.py run --source tplus-kainan
automation/customer_import/.venv/bin/python data-operations/order-sync/sync.py run --source tplus-kejia
```

首次 `run` 执行2026-01-01起全量及遗留未结订单初始化，自动按1000条循环，随后执行 `source_snapshot_at-2分钟` 补偿。初始化成功后，同一命令执行增量。生产调度每30分钟分别调用三条命令；任一来源失败不影响其他来源。

SQL Server查询由代码级只读守卫限制为单条SELECT，显式使用READ COMMITTED并拒绝NOLOCK。目标端只通过KDOS批次Application Command写入 `erp_staging_*` / `erp_sync_*`，满1000条时游标停在最后实际记录；扫描上界单独保存。

验收通过并确认保持 staging 增量后，再安装 `systemd-user/kdos-erp-order-sync@.service` 与 `.timer`，分别启用 `e10-main`、`tplus-kainan`、`tplus-kejia` 三个 timer。模板为每个来源使用独立进程和独立锁，任一来源失败不会阻塞另外两个。正式业务表切换仍需另行确认；启用 timer 不会写入现有 `sales_orders`、`finished_goods_inbound` 或 `finished_goods_outbound`。
