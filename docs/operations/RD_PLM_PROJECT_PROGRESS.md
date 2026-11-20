# A1-PLM 项目进度报表

业务合同：`docskill/研发中心/报表/项目进度.md`。页面：研发中心模块中与原“研发中心”同级的“报表 → 项目进度”，`/rd/reports/project-progress`；原研发页面和权限保留。

数据仅由A1-PLM权威生成，无手工新增/编辑/删除/导入。系统总数和看板明细为不同范围；前端默认复用ZIP深色单屏八图，内部切换原浅色八图与明细，不公开源JSON或iframe。KdosChart负责图表生命周期。

## 配置与运行

在生产受限`.env`配置 `PLM_BASE_URL`（包含应用前缀，例如`https://plm.example.invalid/a1-kainice`）、`PLM_USERNAME`、`PLM_PASSWORD`。API容器沿用既有env_file，不新增服务/端口。不能提交配置或从日志打印认证响应。已验证Ubuntu原生HTTP可读取两个接口，无Edge/Playwright运行依赖。原始ZIP在本地受控审计目录，不进入镜像或Git。

严格迁移入口：`node dist/migrate-plm-progress.js`，仅Migration136。隔离数据库验证完成后执行；新增`rd_plm_snapshot`及`rd_plm_sync_runs`，不修改原业务表；强制tenant RLS。

受控命令（只允许宿主维护用户/n8n已有本机SSH凭据执行，未开放同步HTTP路由）：

```sh
docker exec knplan-api-1 sh -lc 'cd /app/apps/api && timeout --signal=TERM --kill-after=15s 240s env PLM_TENANT_ID=KAINAN node dist/plm-sync-cli.js'
```

登录及两个数据接口全部验证成功后Application事务整体更新单行快照；失败保留原raw/dashboard/id/last_success，仅更新失败状态/审计。请求单次20秒、最多3次；响应最大10MiB。tenant advisory lock防并发，中断的RUNNING在下次锁接管时补记失败。CLI失败非0且只输出固定错误码；成功输出UUIDv7快照ID、两个接口已获取及四类数量，无项目名/认证。

## 调度与观察

唯一调度：`automation/n8n/plm-project-progress-half-hourly.json`，工作流`RdPlmProjectProgressHalfHourlyV1`；`*/30 * * * *`，Asia/Shanghai，每小时00/30分。已有本机SSH触发上述CLI，后置节点强校验真实退出码/SUCCESS/两接口/UUIDv7/计数。手工重跑入口复用同一链路，非第二个自动调度。没有cron/timer/应用循环；原所有工作流保持不变。

前端每60秒只重取KDOS快照，不触发抓取；显示来源、最近成功和结果。失败沿用旧数据，成功时间超过60分钟提示过期，RUNNING超过5分钟提示异常。报表及n8n失败执行为本任务告警入口，不新增业务消息。漏跑可在n8n受控重跑，完整新快照补偿，无增量水位丢数据。

读取：`GET /api/v1/rd/project-progress`；明细导出：`GET /api/v1/rd/project-progress/export/projects?fields=...`，tableKey仅projects，字段白名单且read∩export，业务显示值，snapshot级导出审计。均用现有AuthGuard、tenant及资源/字段/数据范围；无全量范围的OWN/CUSTOM拒绝，不猜测上游项目与KDOS人的关联。原始源响应不返回。普通成员不自动新增授权，管理员在现有权限组中配置。

## 变更与回滚

备份按本次只新增表风险保存schema/迁移台账及现有镜像标记，n8n原工作流导出/SQLite备份用于本新增调度回退；不要求无关全量业务备份。回退旧API/Web镜像并停用本新增工作流，保留快照和日志；禁止自动drop或更改其他任务。源系统网络/认证异常是失败，不视为零项目。

真实运行版本、时间、接口数量、浏览器/权限和调度执行证据统一在本轮`outputs/plm_dashboard_release/`及`outputs/CODEX_PROGRESS.md`记录；不能用仓库active字段代替运行态证据。本轮用户明确要求仅本地提交，不自动push。
