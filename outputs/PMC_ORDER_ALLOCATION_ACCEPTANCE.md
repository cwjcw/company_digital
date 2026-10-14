# PMC 订单分配导入与企业微信通知交付验收

交付时间：2026-10-14T16:34:09+08:00。开发、数据库迁移、测试、备份、部署、线上验收及 GitHub 自动推送完成。

## 版本与入口

- GitHub `main` 与部署源码一致：`235cd16907be7d5f5cee5efb11dce94b9dbc91dc`（`235cd16`）。远端 SHA 实际复核通过。
- 功能提交：`ea666007cc62c314fe31ec2ce6c8d4b08107ec44`；最终精度与运维记录修正：`235cd16907be7d5f5cee5efb11dce94b9dbc91dc`。
- 独立回归修正：`78652eded7190c357d0a55290bb226c3c029c60d`，财务测试等待异步数据加载；用户根目录未提交的测试修改原样保留。
- 入口：PMC → 主计划系统 → 系统运维 → 订单分配通知配置。订单分配页面提供原始文件预览与确认；消息中心保留原有三个页签并显示文本/附件组件记录。
- Web、API 和 Dispatcher 发布版本 `235cd16`；API/Web/document-worker/PostgreSQL 四容器健康；已有 Dispatcher 服务 active。

## 真实文件与生产数据

`10.13.xlsx` 只读使用，SHA256：`d2f056153143ba9e6a584d8106131cb0672426b7cfa7bebd4308967cdc43d8f6`，交付结束复核相同。

- 实际 163 条、33 张订单；29 个物理列，其中 A 列空、28 个有表头。处理 24 个非金额业务字段，保留原中文名称；四个金额字段在解析、比较、审计和通知附件中均排除。
- 生产最新版本预览：新增163、变更0、无变化0、错误0、冲突0。预览显示6位预计接收人、3项单位接收配置提示；没有调用生产确认接口。
- 实际原文件在隔离 PostgreSQL18 中正式导入163条，再次导入全部163条无变化；订单/品项与订单/序号双键、空白不覆盖、原有人工作业量及非零金额保留、订单数量精度均通过验证。
- 原文件“已分配数量”“排产数量”均为空。未以订单数量推算分配量；既有值保留，新行遵循原默认值。
- 按用户选择，正式生产导入由用户在页面查看预览后点击确认。正式通知规则保持停用；未批量导入生产订单，未向其他员工发送测试。
- 最终生产只读比对：分配记录1684条，其业务键和金额哈希一致；财务品项106648条、财务客户对应140条、PMC客户对应3条和既有消息规则1条的整行哈希一致。

## 配置、权限和通知

五项精确映射及五个接收单位已初始化，重复初始化不覆盖人工配置：事业一部→事业一部、事业二部→事业二部、厦门凯南智能制造有限公司→事业三部、厦门科加智能制造有限公司→事业四部、供应链→采购部。接收人对应表初始为空，待管理员按实际职责配置。

业务员按完整姓名精确匹配，启用的同名员工全部参与；承接单位和业务员接收范围合并去重，跨租户、停用或缺少企业微信账号明确记录异常。批量和导入只对实际变更产生单个事务事件，无变化不写、不发。配置、字段/行范围、并发版本、审计和真实非owner FORCE RLS 均验证。

文本与每个 Excel 分片独立记录结果，成功组件不重发；文件失败重试使用原保存附件。共享 `WeChatPusher` 自建应用发送文件，私有附件与下载鉴权不暴露公开 URL，成功回执持久化后处理 API 确认。

## 企业微信实际收件验收

- 唯一接收人：崔玮杰08134，企业微信账号 `CuiWeiJie`，一个 KDOS 员工接收范围。
- 测试批次：`01a13961-107e-7d2f-be84-e82dc5388c6e`；一次文本和一次文件均 `SENT`、接口 `errcode=0`。
- 使用独立合成测试订单，没有写入真实订单；正式规则仍停用。
- 实际保存附件包含“新增订单”“变更后数据”“字段变更明细”，前两表24列，字段明细13列；前导零、筛选和冻结、金额字段排除校验通过。
- **用户已确认：“已收到文本和 Excel，三个工作表可打开”。收件与打开文件验收通过。**
- 真实普通员工访问配置403，匿名访问配置/私有附件401。

## 测试结果

| 验证 | 实际结果 |
| --- | --- |
| 完整 API | 105套、924项通过，1项既有跳过 |
| 最终 API 专项 | 6套、74项通过 |
| Web 回归覆盖 | 47文件361项通过；财务文件修正异步等待后6项通过，共48文件367项覆盖；没有将分次运行冒充单次全量 |
| 最终 Web 专项 | 3文件38项通过 |
| Contracts | 22项通过 |
| Dispatcher Python | 8项通过 |
| PostgreSQL18 | fresh全92迁移与14项业务场景，共15项检查通过；含真实163/33导入重放、四入口、回滚、权限/RLS与原ERP人工数据保护 |
| 构建/类型/lint | API/Web通过；保留既有Web fast-refresh与bundle大小提示 |
| 桌面真实 Chrome | 配置两页签、五单位、员工多选、真实文件预览后取消、通知文本/附件记录通过；无5xx；最终部署版本验收 |

Chrome验收使用已有管理员的限时维护会话，没有改变密码或角色，也不将其描述为密码登录测试。

## 备份与调度

生产已成功执行92迁移；升级前备份 `20261014_150723`，最终投递后备份 `20261014_162945`，位置为原运行根目录 `data/backups/`。双库使用 custom 格式并通过 `pg_restore --list`；文件0600，目录0700；附件归档包括私有上传与 provider 成功回执。SHA256记录于 `outputs/PMC_BACKUP_FINAL.txt`，操作核验见 `outputs/PMC_FINAL_OPERATIONS_VERIFIED.json`。

隔离测试容器已移除，临时维护token文件已清理；最后健康接口commit与GitHub main再次核对一致。

沿用原 `knplan` Compose 项目、PostgreSQL绑定路径和uploads路径，生产.env未复制至工作树。仅更新已有 Dispatcher 服务的版本化源码；没有新增计时器、cron、n8n任务，原KDOS timer启用状态与cron计数比对一致，当前10个n8n激活工作流。已有ERP同步与内置排程周期不变。

## 已知独立问题与使用前准备

- 既有 `plan-projections` 状态自2026-09-29残留 `RUNNING`，当时无活跃SQL；本次未擅自重置或更改调度。新业务确认通过既有outbox主动对账。该旧运行状态需要独立运维处理。
- PMC现有外壳最小宽1180px。桌面验收通过；390px移动视口仍显示桌面布局，不宣称移动端自适应通过。
- 正式通知启用前，请在专页配置五单位接收人并处理实际缺失账号提示；正式导入由用户确认。无需手工同步GitHub。

## 修改范围及证据

源码共38文件（含独立财务测试修正），未推送根目录真实财务outputs、凭据、业务原文件或私有截图。主要证据保存在本地 `outputs/PMC_*`，私有验收附件位于 `data/pmc-order-allocation/`，均未提交。

- apps/api/src/entities.ts
- apps/api/src/migrations/1722920092000-OrderAllocationImportNotifications.ts
- apps/api/src/modules/master-plan-system/master-plan-spreadsheet.service.spec.ts
- apps/api/src/modules/master-plan-system/master-plan-spreadsheet.service.ts
- apps/api/src/modules/master-plan-system/master-plan.application.service.ts
- apps/api/src/modules/master-plan-system/master-plan.controller.ts
- apps/api/src/modules/master-plan-system/master-plan.module.ts
- apps/api/src/modules/master-plan-system/master-plan.sync.service.ts
- apps/api/src/modules/master-plan-system/order-allocation-config.service.ts
- apps/api/src/modules/master-plan-system/order-allocation.domain.ts
- apps/api/src/modules/master-plan-system/order-allocation.spec.ts
- apps/api/src/modules/notifications/notification-admin.service.spec.ts
- apps/api/src/modules/notifications/notification-admin.service.ts
- apps/api/src/modules/notifications/notification-event.registry.spec.ts
- apps/api/src/modules/notifications/notification-event.registry.ts
- apps/api/src/modules/notifications/notification.internal.controller.ts
- apps/api/src/modules/notifications/notification.service.ts
- apps/api/src/modules/notifications/notification.types.ts
- apps/api/src/modules/notifications/notifications.module.ts
- apps/api/src/modules/notifications/order-allocation.delivery.service.ts
- apps/api/src/modules/notifications/order-allocation.routing.ts
- apps/web/src/App.tsx
- apps/web/src/modules/finance/FinanceOrders.spec.tsx
- apps/web/src/modules/master-plan-system/MasterPlanPages.spec.tsx
- apps/web/src/modules/master-plan-system/MasterPlanPages.tsx
- apps/web/src/modules/master-plan-system/OrderAllocationNotificationConfig.spec.tsx
- apps/web/src/modules/master-plan-system/OrderAllocationNotificationConfig.tsx
- apps/web/src/modules/notifications/NotificationCenterPage.tsx
- automation/wechat_push_projects/kdos-notification-dispatcher/dispatcher.py
- automation/wechat_push_projects/kdos-notification-dispatcher/test_dispatcher.py
- docs/operations/PMC_ORDER_ALLOCATION_NOTIFICATIONS.md
- docs/operations/TASK_REGISTRY.md
- docs/runbook.md
- packages/contracts/src/index.ts
- scripts/backup.sh
- scripts/deploy-common.sh
- scripts/deploy-notification-dispatcher.sh
- scripts/test-order-allocation-postgres.cjs
