# 畅捷通 T+ 双账套订单同步

本目录专门放置外部数据的读取、转换和 API 写入代码。当前任务读取
`50_双账套有效订单统一报表.sql`，固定从 `2026-01-01` 开始，只把 SQL 判定为有效的订单写入“销售接单明细”。

同步链路：

1. `tplus-reader.mjs` 经 SSH 隧道的本地 SQL Server 端口读取两个账套；
2. 源 SQL 的有效性判断保持不变，只在运行时注入开始日期并打开诊断结果；
3. `api-writer.mjs` 使用 `X-API-Key` 调用 knweb API；
4. API 以“源数据库 + 订单号”为业务键事务更新完整快照，并停用已不再有效的源订单。

配置放在项目根目录的 `.env`，完整变量示例见 `.env.example`。API Key 必须关联一个启用用户，权限范围需要包含：

```text
tplus-sales-orders:*:import
```

先只读验证源连接和 SQL：

```bash
pnpm sync:tplus:dry-run
```

确认无误后同步：

```bash
pnpm sync:tplus
```

需要保留一次本地快照用于排查时可执行：

```bash
node data-operations/tplus/sync.mjs --dry-run --output data/tplus-snapshots/latest.json
```

快照含业务数据，文件会以 `0600` 权限创建，不应提交到 Git。
