# KDOS-MPS-ORDER-PROGRESS-REV3B-001 验收记录

当前状态：WAITING_MANUAL_ACCEPTANCE（等待人工验收）；开发、自动验证与功能发布核验完成，不自动PASS。
日期：2026-10-16，Asia/Shanghai。

## 交付范围

- 起始真实 HEAD：`4ece1df8435ad4c329e1be1d22ca9625459905a4`。起始线上为08f9195，差异仅上一轮outputs记录；未reset，初始工作区干净。
- 新页面 `/master-plan-order-progress`，导航 PMC中心 → 大屏报表 → 主计划大屏 → 在制订单进度。原综合大屏、9类待处理事项及其它REV3阶段保留。
- 独立资源 `mps-order-progress-dashboard`，编译期注册即可使用现有正式权限组管理，不需要permission seed/migration。本任务不写生产授权。
- 订单、品号、详情均服务端聚合/分页，默认100、可选50/100/200/500/1000；只有展开时请求该订单品项。订单与品号分页、排序互不影响。
- KdosDataTable compact、固定身份列、sticky、单纵向滚动和表内横向滚动；列宽沿用公共localStorage，按tenant/user/resource/viewKey/fieldKey隔离。没有第二套列宽系统。
- 默认只看未完成订单/品项；顶部远程事业部/客户/订单/品号、订单日期/交付日期。日期首次和重置遵守“按日＋上海昨天”，可切换不限日期。

## 业务口径与身份

指标合同：[KDOS_MPS_ORDER_PROGRESS_METRICS.md](KDOS_MPS_ORDER_PROGRESS_METRICS.md)。

- 集团四个正式存储字段原值展示；保留现有集团完成率语义，不能用工序平均、月计划可见行重算或数量加权率替换。
- 月计划需求/累计入库/欠数/完成率均正式存储值，页面明确称入库完成率；工序进度独立为实际累计报工/月计划需求。255/500=51%，525/500=105%，不封顶，已下达周计划数量不作分母。
- 技术、五金、木作、外协和工序定性状态复用正式SQL表达式。为集合聚合抽取共享表达式，不改变原月/周计划规则；人工异常来源和固定标签/顺序不变。
- 无记录显示无记录，无任务显示无工序任务；没有可靠适用性证据不显示不适用。实际累计0与没有准备记录区分，状态与进度不互推。
- 技术表没有独立图纸完成日期字段，未用更新时间伪造。图纸显示正式状态/交期，不制造图纸百分比。
- monthly按UUID一次展示；weekly优先正式base→shipping→monthly父链，并校验tenant/事业部；无父链时只用当前数据库证明唯一的tenant/order/item及同事业部关联。多个weekly先独立归属、报工先按weekly/process SUM再汇总，无多表乘法JOIN。
- 未关联月计划的独立allocation逐UUID保留，不因同订单/品号而消失；重复ERP源行无法一一归属时逐行保留待核实。其月计划需求/入库/进度为空，不将既有月计划事实复制到独立源行。
- 集团订单没有/未完整建立月计划时保留来源缺口或待核实提示；不凭缺数据认定完成。不伪造不存在的集团订单完成率。

## 权限及导出

- 新资源read/export/字段和数据范围独立，旧overview/monthly权限不串授。每条事实含tenant；CUSTOM只接稳定divisionId EQ/IN，OWN仍为created_by。派生百分比/数量/候选/筛选遵守字段依赖。
- Drawer先校验稳定orderId/itemId位于本看板当前筛选及数据范围，再交原表read/字段/数据范围。即使管理员也只返回本看板注册的可映射业务字段，不泄露审计键/内部关联键；工序任务计划提示不作为人工异常。
- 两个顶部全量服务端XLSX：`/export/orders`、`/export/items`。继承顶部条件及各自排序，read∩export与字段裁剪，不受分页/展开状态影响；英文日期文件名、中文业务值，无UUID/tenant/hash。
- 展开品号表的“导出本订单品号”额外按该正式订单号精确收窄，顶部品号导出仍覆盖全部顶部匹配范围。Drawer是临时受限原表查看结果，沿用详情导出豁免。
- 正式下载只通过Application记录导出审计；生产只读验证生成XLSX时审计为明确测试stub，文件仅留忽略目录，不写生产业务或审计假记录。

## 自动测试及真实数据证据

- API全量108套/1008项通过；默认跳过29项外部集成。本轮启用新旧Dashboard PostgreSQL及HTTP专项21项通过，包含重复来源、交期、多周计划、多次报工SUM、51%/105%、无记录、状态独立、分页、筛选、原表权限、CUSTOM/tenant/字段、两类全量导出。
- Web全量51套/393项通过；随后增加本订单导出范围回归，最终新页面8项专项通过。Contracts24项通过。
- Chrome新页面9项通过：1366/1920、按需展开、32px附近紧凑行/固定身份/横向滚动/单纵向滚动、两批次Drawer、远程多选及独立下载、父子分页、列宽持久化、权限、空错加载。浏览器为明确合成响应，不冒充真实账号业务验收。
- 另有真实生产数据只读对账：101条月计划、1010项工序数量/进度核验；原月计划100条×66个表达式、周计划100条×60个表达式，对比提取共享表达式前后零差异。
- 真实订单列表约237ms，单订单品项约26–63ms；全范围品号聚合约2s，实际两类完整Excel生成/读回及无UUID检查通过。没有索引、缓存事实表或全局DB参数改动；所有只读事务设置tenant/Shanghai/timeout/jit。
- 12张业务表记录数/version哈希、6项flags、权限/角色/管理员授权哈希及migration台账与起始基线一致。敏感样本、实际订单号/业务行、Excel和详细计划仅存`data/order-progress-rev3b`，不入Git。
- 已修正首轮PostgreSQL函数参数上限、查询关联估计/逐字段扫描、测试异步等待/本地化定位与正式SQL文字兼容问题；没有删除失败用例或降低业务断言。

## 真实样本与人工验收边界

| 场景 | 真实只读核验 |
|---|---|
| A 多品号 | 已覆盖 |
| B 同品号多周计划 | 当前候选未发现可用真实样本；全租户正式集团订单再次核查，不制造记录。多周计划/多交期由隔离PG测试验证，真实场景待数据可用后人工复核 |
| C 实际报工 | 已覆盖 |
| D 图纸或主材未完成 | 已覆盖 |
| E 部分入库仍欠数 | 已覆盖 |
| F 未进入周计划 | 已覆盖 |

真实业务数据对账和合成UI测试是两类独立证据。用户真实账号人工视觉/业务验收尚未确认，不能判PASS。

## 发布及回滚

双库及附件标准备份20261016_092646已完成，pg_restore目录与3份SHA256全部通过；migration:show 93/93已应用，无新migration。全仓typecheck/lint/build最后通过；lint只保留既有ModulePortal fast-refresh警告，构建只保留既有chunk提示。GitHub仅本任务提交推送、`deploy.sh all/check`及部署后健康/Chrome/只读核验须完成；最终SHA和执行证据记录于交付回复及本地进度。无migration、生产权限初始化或同步配置变更；如发现需要这些改动应NO-GO。

回滚仅使用已保留的原应用代码/镜像走正式部署，不回滚覆盖业务数据库，不改变既有调度/6项flags。REV3-A/C/D继续NOT_STARTED，Demo交付后停止，不自动推进。


## 最终功能发布核验（2026-10-16）

功能提交bbefc6de739cb8140aa98c8eed63344df54cf953已推送github/main并all部署；Repository/Web/API一致，4容器healthy，原PG容器保留、Dispatcher active。部署后新旧Chrome21项全部通过；新/旧页面200，meta/orders/items/candidates/detail/两个export匿名401。运行容器实际只读调用新Service，订单266ms、品项54ms；独立真实数据对账和原表达式对比再次全部通过，业务/权限/flags/migrations未变。

本最终验收记录提交同样推送并标准all/check发布；最终发布SHA为包含本节的Git提交，以`git log -1 --format=%H -- outputs/KDOS_MPS_ORDER_PROGRESS_DEMO_ACCEPTANCE.md`、build-info/health和交付回复定位。私有证据data/order-progress-rev3b/{check,health,chrome-deployed,verify-deployed,formal-regression-deployed,container-check}；最终状态final-state.json。文件内不写自引用SHA，不提交真实业务数据。
