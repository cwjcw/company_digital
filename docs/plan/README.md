# 事业部计划同步脚本

脚本读取四个固定模板，并生成计划中心 2026 年 9 月草稿可识别的 84 列标准化文件：

- 事业一部：`事业一部.xlsx` / `周生产计划`
- 事业二部：`事业二部.xlsx` / `订单`
- 事业三部：`事业三部.xlsx` / `在制订单汇总`
- 事业四部：`事业四部.xlsx` / `主计划`

工作表名称匹配会忽略首尾空格。四个源文件始终只读；程序不直接连接或写入 PostgreSQL，正式写入只能通过计划中心的导入预览与确认接口完成。

## 运行

在项目根目录执行干跑：

```bash
pnpm --filter @tracker/api plan:sync:september
```

输出位于 `.codex-tmp/september-plan-sync/`：

- `2026-09-事业部计划-标准化.xlsx`
- `2026-09-同步测试报告.json`
- `2026-09-重复键复核.csv`

调用计划中心导入预览前，应通过运行环境提供专用凭证（不要写入本项目文件）：

```bash
export KDOS_PLAN_SYNC_API_KEY='由系统管理员创建、关联有效用户且包含 planning.plan.import 权限的密钥'
pnpm --filter @tracker/api plan:sync:september -- --preview
```

确认写入 9 月 DRAFT 版本：

```bash
pnpm --filter @tracker/api plan:sync:september -- --confirm
```

若报告存在非完全一致的重复键，确认操作会被阻止。业务审核 `2026-09-重复键复核.csv` 后，才可显式接受脚本记录的归并结果：

```bash
pnpm --filter @tracker/api plan:sync:september -- --confirm --accept-reconciled-duplicates
```

也可以使用短期登录令牌 `KDOS_PLAN_SYNC_TOKEN`，或通过 `--version-id` 指定目标草稿版本。脚本不会读取或记录 Excel 密码；当前事业四部文件已是标准、可直接只读解析的 `.xlsx`。

## 重复键保护

目标计划表以“订单号 + 品号”为唯一业务键。脚本将完全一致的重复行折叠；对于同源拆分、同源合计行以及跨来源不一致，都会写入复核 CSV。存在此类记录时，未经显式确认不得写入计划中心。

## 测试

```bash
pnpm --filter @tracker/api plan:sync:september:test
```
