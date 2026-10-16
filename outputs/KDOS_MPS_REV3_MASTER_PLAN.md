# 主计划大屏 REV3 总控

当前任务：KDOS-MPS-DASHBOARD-REV3C-001。日期：2026-10-16（Asia/Shanghai）。
REV3-A起始HEAD、Web、API均d6e6e8ad8d6fa6b17db493196653314071dda69a，工作区干净。

| 阶段 | 范围 | 状态 |
|---|---|---|
| REV3-B | 在制订单进度 Demo | PASS |
| REV3-A | 待处理事项独立大屏 | PASS |
| REV3-C | PMC 综合驾驶舱 | WAITING_MANUAL_ACCEPTANCE |
| REV3-D | 集成及验收 | NOT_STARTED |

## REV3-B 人工验收

用户于2026-10-16明确确认 KDOS-MPS-ORDER-PROGRESS-REV3B-001：PASS。
真实多周计划场景已通过隔离PostgreSQL测试，后续取得真实样本时补充业务复核。这属于补充验证事项，不改变已确认的PASS。
人工验收记录已独立提交e806509并push github/main，与REV3-A代码提交分开。原功能提交bbefc6d、最终基线发布d6e6e8a；原始起点4ece1df/线上08f9195保留于B验收记录。

## REV3-A 范围与边界

新增 `/master-plan-gaps`，PMC中心 → 大屏报表 → 主计划大屏 → 待处理事项大屏。复用既有overview资源read/export/字段/CUSTOM scope，原querySql的同一gap_rows生成轻量count，清单和Excel复用原链路。9类定义、稳定关联键、REV2顶部筛选语义不变；已访问清单分页/排序/搜索独立保留。
原 `/master-plan-dashboard` 及已PASS的 `/master-plan-order-progress` 继续正常运行。不改业务数据、历史计划、报工、入库、6项flags和生产授权；不需要migration。3天工单窗口无正式规则，继续不展示。
用户已于2026-10-16正式确认REV3-A真实人工验收PASS；REV3-C本轮独立实施，D不启动。

恢复入口：`outputs/CODEX_PROGRESS.md`。
B指标及验收：`outputs/KDOS_MPS_ORDER_PROGRESS_METRICS.md`、`outputs/KDOS_MPS_ORDER_PROGRESS_DEMO_ACCEPTANCE.md`。
A定义与验收：`outputs/KDOS_MPS_GAP_AUDIT.md`、`outputs/KDOS_MPS_OVERVIEW_DASHBOARD_METRICS.md`、`outputs/KDOS_MPS_GAPS_REV3A_ACCEPTANCE.md`。

## REV3-A 交付

功能13c2a1e已推送并标准部署，Repository/Web/API一致、健康通过。API1011、启用PG18、Web400、Contracts25、全仓typecheck/lint/build、本地及部署后Chrome各28均通过；生产三组Scope×9类count/summary/detail一致，9类Excel全量验证通过。无需migration或本任务生产授权变更。最终记录提交亦按统一SHA标准发布，具体最终SHA见交付回复/健康版本及私有运行证据。验收报告outputs/KDOS_MPS_GAPS_REV3A_ACCEPTANCE.md；2026-10-16用户人工验收PASS；新任务仅启动C，D保持NOT_STARTED。

## REV3-C 开始

起始真实HEAD/线上Web/API均50a518741dd77f9c476a5a1aa4e1f93af2babbc9，工作区干净。先独立提交A人工验收文档。A/B均PASS，C IN_PROGRESS，D NOT_STARTED。改造原/master-plan-dashboard为PMC综合驾驶舱，保留三表访问入口与正式指标/权限；不改业务数据、6flags、生产授权或migration。C最终只能WAITING_MANUAL_ACCEPTANCE。


## REV3-C 实现与验证

A验收独立提交1b4d9a4；C原URL驾驶舱、/master-plan-reports三张原独立报表与安全跨屏已实现；summary复用同一querySql且只省略风险行，9类差集和权限不变。API1012、Web407、Contracts29、相关HTTP/PG31、本地Chrome29及typecheck/lint/build通过。真实四组summary与起始Service完全一致，4事业部、56状态分布/120工序值/280趋势点及5种完整Excel通过，性能145–1363ms。报告outputs/KDOS_MPS_PMC_COCKPIT_ACCEPTANCE.md；规则outputs/KDOS_MPS_PMC_COCKPIT_METRICS.md。功能7b85aaf已普通push github/main并标准all/check部署，Repository/Web/API一致、四服务healthy，部署后Chrome29/29、运行容器真实四scope及9类count/detail验证通过；无本任务业务/权限/6flags写入或migration。工程交付完成，C严格WAITING_MANUAL_ACCEPTANCE，D不启动。最终记录提交也按统一SHA标准发布，结束SHA见交付回复/健康版本/私有final-state.json。
