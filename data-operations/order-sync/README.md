# ERP订单正式staging同步

三个来源必须作为三个独立任务运行；E10来源列表由 `sources.json` 驱动，未来新增账套时只增加来源项，并把凭据继续保留在 `basic_code/.env`。

```bash
automation/customer_import/.venv/bin/python data-operations/order-sync/sync.py run --source e10-main
automation/customer_import/.venv/bin/python data-operations/order-sync/sync.py run --source tplus-kainan
automation/customer_import/.venv/bin/python data-operations/order-sync/sync.py run --source tplus-kejia
```

日常任务只把单行结构化摘要写入 journal，避免每30分钟重复生成百万行 CSV/JSON。需要人工验收文件时显式增加 `--save-report`；历史报告按运维保留策略清理，不由同步任务自动删除。

首次 `run` 执行2026-01-01起全量及遗留未结订单初始化，自动按1000条循环，随后执行 `source_snapshot_at-2分钟` 补偿。初始化成功后，同一命令执行增量。生产调度每30分钟分别调用三条命令；任一来源失败不影响其他来源。

SQL Server查询由代码级只读守卫限制为单条SELECT，显式使用READ COMMITTED并拒绝NOLOCK。目标端只通过KDOS批次Application Command写入 `erp_staging_*` / `erp_sync_*`，满1000条时游标停在最后实际记录；扫描上界单独保存。

E10 的 `LastModifiedDate` 为 `datetime2(7)`，增量分页必须在投影、比较和排序中统一转换为 `datetime2(6)`，与 Python/pytds 游标精度保持一致。任何非空分页返回后游标未推进时必须立即失败并停止，禁止继续提交重复批次；已经完成初始化的来源在增量失败后只能从上一成功扫描边界恢复增量，不得重新执行全量初始化。

生产使用 `systemd-user/kdos-erp-order-sync@.service` 与 `.timer`，分别启用 `e10-main`、`tplus-kainan`、`tplus-kejia` 三个 timer。模板为每个来源使用独立进程和独立锁，任一来源失败不会阻塞另外两个；服务器用户必须保持 linger，以保证未登录时和重启后仍能调度。

staging 的每次真实新增或内容变化会在同一 PostgreSQL 事务写入 `erp_change_events`。`erp_projection_consumers` 为订单、入库、出库和未来目标表保存彼此独立的事件游标、1000条批次上限、10分钟租约和指数退避状态。下游只有完成自身幂等事务后才能调用 complete 推进游标；失败调用 fail，不推进游标。重叠窗口内内容未变化的记录不会产生物理 UPDATE 或重复事件。

正式切换后，`sales-orders-v1`、`finished-goods-inbound-v1`、`finished-goods-outbound-v1` 分别把变更幂等投影到现有业务表；不得另建同义订单或出入库表。三个 `kdos-erp-projection@.timer` 在每小时 `05/35` 分运行，确保先等待 `00/30` 分的源采集提交，再独立消费各自游标。初始化使用 `initialize-formal` Application Command 为现有 staging 补齐事件，然后循环运行 `project.py --consumer <key>` 直至返回零记录。切换过程必须先备份并验证原有 UUID、人工字段和下游关联仍然保留。
